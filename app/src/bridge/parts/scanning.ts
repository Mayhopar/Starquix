/**
 * Bridge Part: Element Scanning
 *
 * DOM scanning for source-tracked elements, navigation detection
 * for SPA route changes, and MutationObserver for dynamic content.
 */
export const BRIDGE_SCANNING = `
  IFrameBridge.prototype.getContainerLayout = function(element) {
    var style = window.getComputedStyle(element);
    if (style.display === 'flex' || style.display === 'inline-flex') {
      return 'flex-' + (style.flexDirection || 'row');
    }
    if (style.display === 'grid' || style.display === 'inline-grid') {
      return (style.gridAutoFlow || '').indexOf('column') !== -1 ? 'grid-column' : 'grid-row';
    }
    return undefined;
  };

  IFrameBridge.prototype.setupNavigationDetection = function() {
    var self = this;

    window.addEventListener('popstate', function() { self.handleNavigation(); });

    var originalPushState = history.pushState;
    var originalReplaceState = history.replaceState;

    history.pushState = function() {
      originalPushState.apply(this, arguments);
      self.handleNavigation();
    };

    history.replaceState = function() {
      originalReplaceState.apply(this, arguments);
      self.handleNavigation();
    };

    var setupBodyObserver = function() {
      if (!document.body) {
        var bodyObserver = new MutationObserver(function() {
          if (document.body) {
            bodyObserver.disconnect();
            setupBodyObserver();
          }
        });
        bodyObserver.observe(document.documentElement, { childList: true });
        return;
      }

      var observer = new MutationObserver(function(mutations) {
        var significantChange = mutations.some(function(m) {
          return m.type === 'childList' &&
            (m.target === document.body || m.target === document.documentElement) &&
            m.addedNodes.length > 0;
        });
        if (significantChange && window.location.pathname !== self.currentPath) {
          self.handleNavigation();
        }
      });
      observer.observe(document.body, { childList: true, subtree: false });
    };

    setupBodyObserver();
  };

  IFrameBridge.prototype.handleNavigation = function() {
    if (window.location.pathname === this.currentPath) return;

    var wasObserving = this.mutationObserverStarted;
    this.stopMutationObserver();
    this.currentPath = window.location.pathname;
    this.lastHoveredKey = null;

    this.sendToParent({
      type: 'PAGE_CHANGED',
      payload: { path: this.currentPath }
    });

    if (!document.getElementById('sq-design-mode-styles')) {
      this.styleElement = null;
      this.injectDesignModeStyles();
    }

    if (wasObserving) this.startMutationObserver();
    var self = this;
    setTimeout(function() { self.scanElements(); }, NAVIGATION_SETTLE_MS);
  };

  /**
   * task-120 (5.4): scoped rect reuse. scanScope = the DOM nodes a RENDER
   * actually changed (null = full scan). The parent contract (full
   * ELEMENTS_SCANNED array) is preserved — only RECT reads are skipped, and
   * ONLY for elements that precede the first changed node in document order
   * (everything at/after it may have shifted). Removals/reorders force a
   * full scan at the call site.
   */
  IFrameBridge.prototype.scanElements = function(retryCount, scanScope) {
    if (this._performance) this._performance.record('scan', this._performanceOperation);
    retryCount = retryCount || 0;
    var self = this;

    try {
      var rectCache = this._lastRectByKey || (this._lastRectByKey = {});
      var boundary = null;
      if (scanScope && scanScope.length) {
        boundary = scanScope[0];
        for (var sb = 1; sb < scanScope.length; sb++) {
          if (scanScope[sb].compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING) {
            boundary = scanScope[sb];
          }
        }
      }
      // The element walk below is in document order, so "precedes the first
      // changed node" is a boolean that flips ONCE when the walk reaches the
      // boundary — no per-element compareDocumentPosition (that API tree-walks
      // and this loop runs at querySelectorAll('*') scale).
      var passedBoundary = false;
      var canReuse = function(element, key) {
        if (scanScope === null || scanScope === undefined) return false;
        if (element === boundary) passedBoundary = true;
        if (passedBoundary) return false;
        if (!rectCache[key]) return false;
        return true; // boundary null (empty scope): nothing changed
      };

      // ponytail: scope over allowlist. Page content lives in #sq-components —
      // when the wrapper exists, the scan universe is its subtree (wrapper
      // included). ANY body-level DOM (AI overlays, stream preview, selection
      // highlights, astro dev toolbar, future junk) is categorically not
      // content; without this the scanner stamped our own overlay divs with
      // dynamic: keys → phantom "div" roots in Layers on every AI run + a
      // broken wrapper auto-unwrap (live-caught 2026-07-23 as dynamic:div:3/4).
      // Body-wide fallback covers wrapper-less surfaces; the infra selector
      // guards overlays there too.
      var scanRoot = document.getElementById('sq-components');
      // Layout-element paradigm (2026-08-24): a layout-owned <body> IS the
      // Layout row — report it so it is selectable/stylable like any element.
      // Gated on the source file so WC bare-shell bodies never join the scan.
      // Body goes FIRST so its data-key exists when children compute parentKey.
      var bodyHead = this.layoutRootBody() ? [document.body] : [];
      var allElements = scanRoot
        ? bodyHead.concat(scanRoot, Array.prototype.slice.call(scanRoot.querySelectorAll('*')))
        : bodyHead.length
          ? bodyHead.concat(Array.prototype.slice.call(document.body.querySelectorAll('*')))
          : document.body.querySelectorAll('*');
      // Drag chrome too: a mid-drag rescan once listed the drag placeholder as a sibling → drops landed one slot off.
      // A predicted ⌘D copy is no layer until its write lands (no temporary key to select or stamp).
      var INFRA_SELECTOR = '[data-sq-ai-preview],[data-sq-ai-highlight],[data-sq-selection-highlight],[data-drag-ghost],[data-sq-drop-line],[data-sq-predicted]';
      var meaningfulElements = [];

      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        var tagName = el.tagName.toLowerCase();
        // svg is scannable ONLY as a content root: nested <svg> (ownerSVGElement
        // set) stays internal, and drawn-shape wrappers (data-drawn) own their
        // inline svg — keying it would break pen/shape editing.
        if (tagName === 'svg' && (el.ownerSVGElement ||
            (el.closest && el.closest('[data-drawn]')))) continue;
        // View-slot scenery: the placeholder ROOT is reported (as a slot row);
        // its inline-styled children are scenery and never rows.
        if (el.closest && el.closest('[data-sq-view-slot]') && !el.hasAttribute('data-sq-view-slot')) continue;
        // task-240: the bound page's card wrapper + BlogSlot's pagination
        // container are transparent chrome (utils.ts isBlogChrome) — no row,
        // no data-key, so findParentKey walks through them.
        if (this.isBlogChrome(el)) continue;
        if (SKIP_TAGS.indexOf(tagName) === -1 && !el.hasAttribute('data-slot-placeholder') &&
            !(el.closest && el.closest(INFRA_SELECTOR))) {
          meaningfulElements.push(el);
        }
      }

      var sourceTrackedCount = 0;
      for (var j = 0; j < meaningfulElements.length; j++) {
        var elem = meaningfulElements[j];
        if (elem.hasAttribute('data-sq-source') || elem.hasAttribute('data-astro-source-file') || elem.hasAttribute('data-key')) {
          sourceTrackedCount++;
        }
      }

      // Hydration settle: candidates exist but none carries source tracking
      // yet → the tagger has not run, try again shortly. A page with NO
      // candidates at all is simply empty (owner: a new project starts
      // blank) — report it now, or the route never vouches and every draw
      // refuses with "Still switching pages" for the whole retry window.
      if (meaningfulElements.length > 0 && sourceTrackedCount === 0 && retryCount < SCAN_MAX_RETRIES) {
        setTimeout(function() {
          self.scanElements(retryCount + 1);
        }, SCAN_RETRY_BASE_MS * (retryCount + 1));
        return;
      }

      // Re-assign proper keys to blog card children before scanning.
      // After HMR/DOM rebuilds, these elements may have lost their data-key
      // and would otherwise get dynamic: keys from the scanner.
      this._ensureBlogCardKeys();

      var elementTree = [];
      var sourceKeyCounts = {};
      // One page-level probe instead of two closest() walks per element.
      var hasUnits = !!document.querySelector('[data-sq-unit]');
      // task-207: post bodies wrap every component invocation; the sq/ check
      // below narrows it. Both gates keep the ancestor walk off ordinary pages.
      var hasBlocks = !!document.querySelector('[data-sq-block="component"]');

      meaningfulElements.forEach(function(element) {
        try {
          var sourceInfo = self.resolveSourceKey(element);
          var sourceKey = sourceInfo.sourceKey;
          var hasSourceTracking = sourceInfo.hasSourceTracking;

          var uniqueKey;
          // task-159/160: the SAME element's key under each TRANSITIONAL
          // placement chain, most recent first. The \`#N\` suffix REUSES
          // instanceIndex — never a second counter: every chain is computed
          // over the same tree, so they partition it identically, and a private
          // counter would silently miss every \`.map()\`-repeated element.
          var legacyUniqueKeys = [];
          if (sourceKey) {
            var instanceIndex = sourceKeyCounts[sourceKey] || 0;
            sourceKeyCounts[sourceKey] = instanceIndex + 1;
            uniqueKey = instanceIndex === 0 ? sourceKey : sourceKey + '#' + instanceIndex;
            for (var li = 0; li < sourceInfo.legacySourceKeys.length; li++) {
              legacyUniqueKeys.push(instanceIndex === 0
                ? sourceInfo.legacySourceKeys[li]
                : sourceInfo.legacySourceKeys[li] + '#' + instanceIndex);
            }
          } else {
            uniqueKey = self.getElementKey(element);
          }

          // The component-view slot placeholder lives in a wrapper temp dir, so
          // astro's dev source attrs would leak an absolute /var/folders path
          // into its key. Pin it — one per view, stable across reloads. Must
          // also stamp data-key: getElementKey pre-stamps its dynamic key, and
          // the existing-key branch below would otherwise win it back.
          if (element.hasAttribute('data-sq-view-slot')) {
            uniqueKey = 'sq-view-slot';
            element.setAttribute('data-key', uniqueKey);
          }

          // Only set if not already set (preserves keys from addKeysToMarkup)
          var existingKey = element.getAttribute('data-key');
          if (!existingKey) {
            element.setAttribute('data-key', uniqueKey);
          } else if (PLACEMENT_KEY_PATTERN.test(existingKey) && existingKey !== uniqueKey) {
            // task-149: a node persisted across an Astro View Transition or an
            // HMR partial patch keeps its old data-key — which, under placement
            // identity, can name a DIFFERENT placement. Re-stamp it. The
            // \`~p…\` guard is what keeps this narrow: a key with no placement
            // segment belongs to addKeysToMarkup / _ensureBlogCardKeys /
            // stream preview and must never be overwritten here.
            element.setAttribute('data-key', uniqueKey);
          } else {
            uniqueKey = existingKey;
            // task-159/160: every chain must describe ONE element. If a
            // pre-existing data-key wins, the transitional halves no longer
            // correspond to it and the migration must not be handed a
            // mismatched move.
            legacyUniqueKeys = [];
          }

          // Override tagName for slot elements
          var reportedTagName = element.tagName.toLowerCase();
          var slotTypeAttr = element.getAttribute('data-slot-type');
          var slotComponent = element.getAttribute('data-slot-component');
          if (slotTypeAttr === 'blog') reportedTagName = slotComponent ? 'Blog: ' + slotComponent : 'Blog Slot';
          else if (slotTypeAttr === 'slot') reportedTagName = 'Slot';
          // Instance-path blog slot (task-028 model): the BlogSlot component's
          // collection wrapper is a plain div carrying data-blog-source="posts"
          // (Phase 5 renders the cards into it). Label it like the drawn blog
          // slot so Layers shows the slot icon, not 'div'. The sibling
          // "pagination" wrapper is chrome, not the slot — keep its tag.
          else if (element.getAttribute('data-blog-source') === 'posts') reportedTagName = 'Blog Slot';

          // Filled drawn slot: emit a separate \`componentName\` for the slot's
          // first element child so layers can label it (e.g. "CTA") AND show
          // the component icon. We deliberately keep the raw tagName so the
          // icon decision and other tag-driven logic still see the underlying
          // HTML element ('a', 'section', …) rather than a component name
          // crammed into the tag field.
          var slotComponentName = null;
          if (!slotTypeAttr) {
            var slotParent = element.parentElement;
            if (slotParent
              && slotParent.getAttribute('data-slot-type') === 'slot'
              && slotParent.getAttribute('data-slot-component')
              && slotParent.firstElementChild === element) {
              slotComponentName = slotParent.getAttribute('data-slot-component');
            }
          }

          // Collect direct text-node children only (not subtree) so the AI
          // can see the literal text content of headings, paragraphs, buttons, etc.
          var directText = '';
          for (var tc = 0; tc < element.childNodes.length; tc++) {
            if (element.childNodes[tc].nodeType === 3) {
              directText += element.childNodes[tc].nodeValue;
            }
          }
          directText = directText.trim().slice(0, 200);

          // Check for blog post slug (element may be inside a blog card)
          var slugEl = element.closest ? element.closest('[data-sq-post-slug]') : null;

          // task-206: enclosing selection unit (data-sq-unit — system
          // components' roots, e.g. <Media/>). The rehype wrapper stamps the
          // invocation's body range on the component wrapper; any element
          // inside a unit reports it so the DesignBar can splice the
          // invocation. hasUnits gates the two ancestor walks off pages with
          // no system components (the scan universe is every element).
          // task-207: generalized from Media to ANY sq/ system component. The
          // D8 probe showed the rehype pass wraps every component invocation,
          // including ones that don't spread ...rest and so declare no
          // data-sq-unit — walking to the wrapper directly is what makes a
          // PROMOTED component editable on day one. Gated on the source being
          // under sq/, so a user's own SingleImage stays their markup.
          var mediaWrap = null;
          if ((hasUnits || hasBlocks) && element.closest) {
            var blockWrap = element.closest('[data-sq-block="component"]');
            if (blockWrap && self.isSystemComponentElement(element, blockWrap)) mediaWrap = blockWrap;
          }
          // Post body block (sq-source-plugin stamps each body block): where
          // the writing view puts the caret when this text is double-clicked.
          var bodyBlock = element.closest ? element.closest('[data-sq-body-line]') : null;

          // Layout slot: the filled \`<div data-sq-slot>\` or an empty chrome
          // \`<slot>\`. Stamp its name (''=default slot) so the editor can re-home
          // a dropped content root via SET_ELEMENT_SLOT_NAME (utils/slotDrop).
          // The component/layout view's placeholder root (data-sq-view-slot,
          // SqComponentView.astro) also reads as a slot row — its scenery
          // children are excluded from the scan, so Layers shows the layout's
          // authored shape (main ▸ slot) instead of phantom placeholder rows.
          var isLayoutSlot = element.hasAttribute('data-sq-slot') ||
            element.hasAttribute('data-sq-view-slot') ||
            (element.tagName.toLowerCase() === 'slot' && element.hasAttribute('data-sq-chrome'));

          var elementRect;
          if (canReuse(element, uniqueKey)) {
            elementRect = rectCache[uniqueKey];
          } else {
            elementRect = self.rectOf(element);
            rectCache[uniqueKey] = elementRect;
          }

          // Local pre-paint apply (preApplyLocalOverrides): the FIRST scan to
          // see a pre-applied element reports the FILE class value it stashed,
          // not the override the DOM already carries — the parent's baseline/↻
          // bookkeeping must see the same bytes an un-pre-applied load sends.
          // Consume-once: every later scan reports the DOM, exactly as a scan
          // after the parent's own re-apply does today.
          var scannedClasses = self.getElementClasses(element);
          var preApplied = self._preAppliedFileClasses;
          if (preApplied && Object.prototype.hasOwnProperty.call(preApplied, uniqueKey)) {
            scannedClasses = preApplied[uniqueKey];
            delete preApplied[uniqueKey];
          }

          var isImg = element.tagName.toLowerCase() === 'img';
          var srcLoc = self.parseSourceLocation(element);
          // task-143: bound-asset handle + owning component + component-local
          // img index, so a Layers-panel selection classifies the same as a
          // canvas click. Computed once per img.
          var imgIdx = isImg ? self.imageComponentIndexOf(element) : -1;

          // Use the rendered cascade, not utility-name guesses: custom CSS,
          // inline styles and responsive rules must produce the same icon.
          var layout = self.getContainerLayout(element);
          if (!self._scannedLayouts) self._scannedLayouts = new WeakMap();
          self._scannedLayouts.set(element, layout);

          elementTree.push(Object.assign({
            key: uniqueKey,
            sourceKey: sourceKey || undefined,
            legacyKeys: (function () {
              var out = [];
              for (var k = 0; k < legacyUniqueKeys.length; k++) {
                if (legacyUniqueKeys[k] && legacyUniqueKeys[k] !== uniqueKey) out.push(legacyUniqueKeys[k]);
              }
              return out.length ? out : undefined;
            })(),
            tagName: reportedTagName,
            classes: scannedClasses,
            layout: layout,
            sourceLocation: srcLoc,
            // task-148 item 7 — the invocation tag that placed this element's
            // component, in the PLACING file. Undefined for a page file's own
            // elements and off local mode.
            usageLocation: self.parseUsageLocation(element),
            // What the MASTER says for a class read from an override prop
            // (utils/propOverrides.ts) — the DOM may carry a page's override.
            masterClasses: element.getAttribute('data-sq-cf') === null ? undefined : element.getAttribute('data-sq-cf'),
            masterText: element.getAttribute('data-sq-tf') === null ? undefined : element.getAttribute('data-sq-tf').trim().slice(0, 200),
            masterSrc: isImg && element.getAttribute('data-sq-sf') !== null ? element.getAttribute('data-sq-sf').slice(0, 200) : undefined,
            rect: elementRect,
            parentKey: self.findParentKey(element, uniqueKey),
            parentDisplay: self.getParentDisplay(element),
            hasSourceTracking: hasSourceTracking,
            textContent: directText || undefined,
            postSlug: slugEl ? slugEl.getAttribute('data-sq-post-slug') : undefined,
            postLinkPaths: self.getPostLinkPaths(element),
            bodyLine: bodyBlock ? parseInt(bodyBlock.getAttribute('data-sq-body-line') || '0', 10) || undefined : undefined,
            mediaUnit: mediaWrap ? {
              bodyLine: parseInt(mediaWrap.getAttribute('data-sq-body-line') || '0', 10),
              bodyEnd: parseInt(mediaWrap.getAttribute('data-sq-body-end') || '0', 10)
            } : undefined,
            componentName: slotComponentName || undefined,
            componentSrc: element.getAttribute('data-sq-component-src') || undefined,
            slotName: isLayoutSlot ? (element.getAttribute('name') || '') : undefined,
            // The src VALUE, not the old hasSrc boolean (task-186 FIX-2).
            // '' still answers "is this img empty?" for the canvas receiver
            // frame, and the value is the "now" half local mode's rev-arrow
            // gate compares against the override's anchor — with only a
            // boolean, getFileValue('image', key) was undefined forever and
            // the kind-agnostic gate could never fire for an image-only master
            // change. Capped like textContent above: a data: URI src would
            // otherwise put ~100KB per img on every scan's postMessage.
            imageSrc: isImg ? (element.getAttribute('src') || '').slice(0, 200) : undefined,
            // Figma model (2026-09-19): a Layers selection shows the image's own
            // description without a canvas click or a source read.
            imageAlt: isImg ? (element.getAttribute('alt') || '').slice(0, 200) : undefined,
            boundAssetPath: isImg ? (self.decodeBoundAssetPath(element) || undefined) : undefined,
            ownerComponentFile: isImg && !srcLoc
              ? (self.resolveOwnerComponentFile(element) || undefined) : undefined,
            imageComponentIndex: imgIdx >= 0 ? imgIdx : undefined,
          }, self.linkAttributesOf(element))); // <a>: a Layers / Shift+Enter selection shows its link
        } catch (elementError) {
          console.error('[IFrameBridge] Error processing element:', elementError);
        }
      });

      // Wrong-file-write guard (live-smoke Critical): stamp the route this
      // scan came from. The parent CANNOT read a cross-origin iframe's URL,
      // and in local mode it must know whether a scan describes the page the
      // user is actually on before letting a structural write target a real
      // file (utils/localPageSync.ts).
      this.sendToParent({
        type: 'ELEMENTS_SCANNED',
        payload: {
          documentId: sqLocalDocumentId,
          elements: elementTree,
          route: (window.location && window.location.pathname) || null,
          // Taken right after a predicted DOM change (applyPrediction): pre-write keys.
          predicted: this._predictedScan === true
        }
      });
      this._predictedScan = false;

      // Mark elements as ready and process any pending class updates
      this.elementsReady = true;
      this.processPendingClassUpdates();

      // After HMR, resolve any sq-asset: refs the Astro re-render left in the DOM
      this.resolveAssetRefsInDOM();

      // Report content height after scan
      this.reportContentHeight();

      if (!this.mutationObserverStarted) {
        this.startMutationObserver();
        this.startResizeObserver();
        this.startResizeListener();
      }
    } catch (error) {
      console.error('[IFrameBridge] scanElements error:', error);
    }
  };

  /** task-120: rescan budget lives on the instance so SET_PAGE can reset it. */
  IFrameBridge.prototype.resetRescanBudget = function() {
    this._rescanCount = 0;
  };

  /**
   * LOCAL MODE ONLY — apply placement class overrides BEFORE FIRST PAINT.
   *
   * A local page frame is a real navigation that paints raw file bytes; the
   * parent's post-ELEMENTS_SCANNED re-apply is bounded below by the frame's
   * own first paint, so it can never close the file-bytes flash (measured
   * live: element in DOM at ~75 ms, UPDATE_CLASSES at 127–160 ms). The parent
   * therefore rides the edited sourceClasses map on the frame URL fragment
   * (\`#sq-ov=\`, built by previewSrc.ts), and this method — called from the
   * constructor, which the <script> tag executes synchronously in <head>,
   * before any body element exists — applies each override AS THE PARSER
   * INSERTS ITS ELEMENT. MutationObserver callbacks are microtasks and run
   * before update-the-rendering, so the first painted bytes already carry the
   * override; the parent's later UPDATE_CLASSES no-ops on the equality guard
   * in handleUpdateClasses.
   *
   * The scan contract does NOT move: each applied element's FILE class value
   * is stashed in _preAppliedFileClasses and reported by the FIRST scan in
   * place of the DOM value (consume-once), so the parent's baseline/↻/badge
   * bookkeeping sees the byte-identical stream of an un-pre-applied load; the
   * task-151 pre-override baseline is captured here for the same reason.
   * Fail-open everywhere: no fragment, bad JSON, or an unmatched key just
   * falls back to the post-scan re-apply (today's behaviour). No paint hold.
   *
   * ponytail: KNOWN CEILING — only plain class overrides ride the URL.
   * sq-asset:/bg-image overrides still need the parent round-trip (blobs
   * can't ride a fragment), and an IN-FRAME navigation (preview-mode link)
   * carries no fragment — both keep the small post-scan repaint. Upgrade
   * path: serve overrides from the local instance itself.
   */
  IFrameBridge.prototype.preApplyLocalOverrides = function() {
    this._preAppliedFileClasses = this._preAppliedFileClasses || {};
    if (!window.__SQ_LOCAL_MODE__) return;
    var overrides = null;
    try {
      var hash = window.location.hash || '';
      if (hash.indexOf('#sq-ov=') === 0) {
        overrides = JSON.parse(decodeURIComponent(hash.slice(7)));
      }
    } catch (hashErr) {
      overrides = null;
    }
    if (!overrides || typeof overrides !== 'object') return;

    var self = this;
    var counts = {};
    var seen = new WeakSet();
    var applyTo = function(el) { self.applyLocalOverrideTo(el, overrides, counts, seen); };
    var visit = function(node) {
      if (node.nodeType !== 1) return;
      applyTo(node);
      if (node.querySelectorAll) {
        var tagged = node.querySelectorAll('[data-sq-source]');
        for (var t = 0; t < tagged.length; t++) applyTo(tagged[t]);
      }
    };
    var processRecords = function(records) {
      for (var r = 0; r < records.length; r++) {
        var added = records[r].addedNodes;
        for (var n = 0; n < added.length; n++) visit(added[n]);
      }
    };
    // Sweep anything already parsed (late injection), then follow the parser.
    visit(document.documentElement);
    var observer = new MutationObserver(processRecords);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Parser done = nothing more streams in; the observer's job is over.
    // (If DOMContentLoaded already fired the listener never runs — that only
    // happens for a late-injected bridge, where the sweep above did the work.)
    document.addEventListener('DOMContentLoaded', function() {
      processRecords(observer.takeRecords());
      observer.disconnect();
    }, { once: true });
  };

  /** One element of the #sq-ov pre-paint apply (shared with the seamless
   *  refresh, source-refresh.ts). counts/seen are per document pass. */
  IFrameBridge.prototype.applyLocalOverrideTo = function(el, overrides, counts, seen) {
    var self = this;
    if (seen.has(el)) return;
    seen.add(el);
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    // Mirror scanElements' universe filters: an element the scan skips must
    // not consume a repeat index here, or the \`#N\` keys drift apart.
    if (SKIP_TAGS.indexOf(tag) !== -1) return;
    if (el.hasAttribute('data-slot-placeholder')) return;
    if (tag === 'svg' && (el.ownerSVGElement ||
        (el.closest && el.closest('[data-drawn]')))) return;
    var src = el.getAttribute('data-sq-source');
    if (!src) return;
    // Same composition + repeat counting as scanElements/resolveSourceKey:
    // placement segment first, then \`#N\` per composed key in document order
    // (the parser inserts in document order, so the counters agree).
    var sourceKey = self.withPlacement(src, el);
    var idx = counts[sourceKey] || 0;
    counts[sourceKey] = idx + 1;
    var uniqueKey = idx === 0 ? sourceKey : sourceKey + '#' + idx;
    if (!Object.prototype.hasOwnProperty.call(overrides, uniqueKey)) return;
    var target = overrides[uniqueKey];
    if (typeof target !== 'string') return;
    if (self.classHoldFor(el)) return;   // a held class is the editor's newest intent (P0b)
    var current = self.getElementClasses(el);
    // task-151 baseline: by the time the parent's UPDATE_CLASSES arrives the
    // DOM already carries the override, so the FILE value is captured here
    // (the first-wins guard in handleUpdateClasses then leaves it alone).
    if (self.originalClassesByKey[uniqueKey] === undefined) {
      self.originalClassesByKey[uniqueKey] = current;
    }
    self._preAppliedFileClasses[uniqueKey] = current;
    if (current !== target) el.setAttribute('class', target);
  };

  IFrameBridge.prototype.startMutationObserver = function() {
    if (this.mutationObserverStarted) return;
    this.mutationObserverStarted = true;

    var self = this;
    var generation = this._mutationObserverGeneration = (this._mutationObserverGeneration || 0) + 1;
    var pendingMetadataMutation = false;
    var lastScanTime = Date.now();
    var MIN_SCAN_INTERVAL = 500;
    var MAX_RESCANS = 10;
    this._rescanCount = 0;

    // task-120 (5.4): the 500/1500ms deferred rescans are gone — RENDER,
    // SET_PAGE and the mutation observer are the deterministic scan triggers.

    var isCurrentObserver = function() {
      return self.mutationObserverStarted && self._mutationObserverGeneration === generation;
    };
    var runTrailingScan = function() {
      if (!isCurrentObserver()) return;
      self._mutationScanTimeout = null;
      var remaining = MIN_SCAN_INTERVAL - (Date.now() - lastScanTime);
      if (remaining > 0) {
        // A clock adjustment / early callback must not consume the pending update.
        self._mutationScanTimeout = setTimeout(runTrailingScan, remaining);
        return;
      }
      if (!pendingMetadataMutation) self._rescanCount++;
      pendingMetadataMutation = false;
      lastScanTime = Date.now();
      self.scanElements();
    };

    this.mutationObserver = new MutationObserver(function(mutations) {
      if (!isCurrentObserver()) return;
      // task-120 (4.4): DOM changed — implicit-row probe answers may be stale.
      self._gridProbeCache = null;
      // Always resolve asset refs on any DOM mutation (not limited by MAX_RESCANS)
      if (Object.keys(self._assetMap).length > 0) {
        if (self._mutationAssetTimeout != null) clearTimeout(self._mutationAssetTimeout);
        self._mutationAssetTimeout = setTimeout(function() {
          if (!isCurrentObserver()) return;
          self._mutationAssetTimeout = null;
          self.resolveAssetRefsInDOM();
        }, 50);
      }

      var hasPostLinkMutation = mutations.some(function(mutation) {
        return mutation.type === 'attributes' && mutation.attributeName === 'href' &&
          mutation.target.tagName === 'A' && mutation.target.closest('article');
      });
      // Ancestor/theme selectors can change descendants without changing the
      // ancestor itself. Compare only previously scanned elements in that subtree.
      var checkedLayouts = new Set();
      var layoutChanged = function(element) {
        if (checkedLayouts.has(element)) return false;
        checkedLayouts.add(element);
        return self._scannedLayouts && self._scannedLayouts.has(element) &&
          self._scannedLayouts.get(element) !== self.getContainerLayout(element);
      };
      var hasLayoutMutation = mutations.some(function(mutation) {
        if (mutation.type !== 'attributes' ||
            (mutation.attributeName !== 'class' && mutation.attributeName !== 'style')) return false;
        if (layoutChanged(mutation.target)) return true;
        var descendants = mutation.target.querySelectorAll('[data-key]');
        for (var i = 0; i < descendants.length; i++) {
          if (layoutChanged(descendants[i])) return true;
        }
        return false;
      });
      if (self._rescanCount >= MAX_RESCANS && !hasPostLinkMutation && !hasLayoutMutation) return;

      var hasRelevantMutation = hasLayoutMutation || mutations.some(function(mutation) {
        // img src changes (e.g. post-upload) carry no addedNodes but must
        // flip the empty/loaded state reported to ELEMENTS_SCANNED.
        if (mutation.type === 'attributes') {
          return (mutation.attributeName === 'src' && mutation.target.tagName === 'IMG') ||
            (mutation.attributeName === 'href' && mutation.target.tagName === 'A' && mutation.target.closest('article'));
        }

        if (mutation.type !== 'childList' || mutation.addedNodes.length === 0) return false;

        for (var i = 0; i < mutation.addedNodes.length; i++) {
          if (self.isRelevantAddedNode(mutation.addedNodes[i])) {
            return true;
          }
        }
        return false;
      });

      if (hasRelevantMutation) {
        // A later ordinary mutation must not erase a pending metadata update.
        pendingMetadataMutation = pendingMetadataMutation || hasPostLinkMutation || hasLayoutMutation;
        if (self._mutationScanTimeout != null) clearTimeout(self._mutationScanTimeout);
        self._mutationScanTimeout = setTimeout(runTrailingScan,
          Math.max(200, MIN_SCAN_INTERVAL - (Date.now() - lastScanTime)));
      }
    });

    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'src', 'href']
    });
    // Theme classes commonly live above body. Do not observe head mutations.
    this.mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  };

IFrameBridge.prototype.scanThen = function(callback, scanDelay, scanScope) {
    var self = this;
    scanDelay = scanDelay || LINK_SCAN_DELAY_MS;
    if (callback) {
      this._pendingScanCallbacks = this._pendingScanCallbacks || [];
      this._pendingScanCallbacks.push(callback);
    }
    // task-120 (5.4): scope merging — any full request (undefined/null)
    // widens the pending scan to full; two scoped requests concatenate.
    var scope = scanScope === undefined ? null : scanScope;
    if (this._pendingScanTimeout != null) {
      if (scope === null || this._pendingScanScope === null) this._pendingScanScope = null;
      else this._pendingScanScope = this._pendingScanScope.concat(scope);
      return;
    }
    this._pendingScanScope = scope;
    this._pendingScanTimeout = setTimeout(function() {
      self._pendingScanTimeout = null;
      var pendingScope = self._pendingScanScope;
      self._pendingScanScope = null;
      self.scanElements(0, pendingScope);
      var callbacks = self._pendingScanCallbacks;
      self._pendingScanCallbacks = null;
      if (callbacks && callbacks.length) {
        setTimeout(function() {
          for (var i = 0; i < callbacks.length; i++) {
            try { callbacks[i](); } catch (e) { console.error('[scanThen callback]', e); }
          }
        }, LINK_SELECT_DELAY_MS);
      }
    }, scanDelay);
  };

IFrameBridge.prototype.addKeysToMarkup = function(html, instanceId) {
    var tagCounts = {};
    var self = this;

    // Escape instanceId for safe use in HTML attribute
    var safeInstanceId = self.escapeHtmlAttr(instanceId);

    // Match opening tags, capturing the tag name and everything up to >
    // This allows us to check if data-key already exists
    return html.replace(/<(\\w+)((?:\\s+[^>]*)?)(\\/?>)/g, function(match, tag, attrs, close) {
      var tagLower = tag.toLowerCase();

      // Skip non-element tags
      if (MARKUP_SKIP_TAGS.indexOf(tagLower) !== -1) {
        return match;
      }

      // Count this tag for selector generation
      var index = tagCounts[tagLower] || 0;
      tagCounts[tagLower] = index + 1;

      // Skip if already has data-key
      if (attrs && attrs.indexOf('data-key=') !== -1) {
        return match;
      }

      var selector = tagLower + '-' + index;
      var newAttr = ' data-key="' + safeInstanceId + ':' + selector + '"';

      return '<' + tag + newAttr + (attrs || '') + close;
    });
  };

IFrameBridge.prototype.resolveSourceKey = function(element) {
    // task-149: withPlacement() composes the local-mode placement segment onto
    // the bare file:line:col. It runs HERE, before scanElements' sourceKeyCounts
    // collision counter, so the positional \`#N\` suffix scopes per placement for
    // free (a .map() loop still gets #0/#1/#2 within its ONE placement). No-op
    // outside local mode.
    var sourceKey = element.getAttribute('data-sq-source');
    if (sourceKey) {
      return {
        sourceKey: this.withPlacement(sourceKey, element),
        // task-159/160: the same element under each transitional placement
        // chain, most recent first, so the parent can move an override stored
        // under an old address onto the new one exactly once. [] outside the
        // migration window.
        legacySourceKeys: this.legacyKeysFor(sourceKey, element),
        hasSourceTracking: true
      };
    }

    var astroFile = element.getAttribute('data-astro-source-file');
    var astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc) {
      var srcIndex = astroFile.indexOf('/src/');
      var relativePath = srcIndex !== -1 ? astroFile.substring(srcIndex + 1) : astroFile;
      return {
        sourceKey: this.withPlacement(relativePath + ':' + astroLoc, element),
        legacySourceKeys: this.legacyKeysFor(relativePath + ':' + astroLoc, element),
        hasSourceTracking: true
      };
    }

    return { sourceKey: null, legacySourceKeys: [], hasSourceTracking: false };
  };

IFrameBridge.prototype.isRelevantAddedNode = function(node) {
    if (node.nodeType !== 1) return false;

    // Skip already-keyed elements
    if (node.getAttribute && node.getAttribute('data-key')) return false;

    // Check for source tracking attributes
    if (node.hasAttribute && (node.hasAttribute('data-sq-source') || node.hasAttribute('data-astro-source-file'))) {
      return true;
    }

    // Check for unkeyed source-tracked descendants
    if (node.querySelector) {
      if (node.querySelector('[data-sq-source]:not([data-key])') ||
          node.querySelector('[data-astro-source-file]:not([data-key])')) {
        return true;
      }
    }

    // Check for significant structural elements
    var tagName = node.tagName ? node.tagName.toLowerCase() : '';
    return SIGNIFICANT_MUTATION_TAGS.indexOf(tagName) !== -1;
  };

IFrameBridge.prototype.stopMutationObserver = function() {
    // Own both observer timers: disconnect alone leaves their closures runnable.
    this._mutationObserverGeneration = (this._mutationObserverGeneration || 0) + 1;
    if (this._mutationScanTimeout != null) clearTimeout(this._mutationScanTimeout);
    if (this._mutationAssetTimeout != null) clearTimeout(this._mutationAssetTimeout);
    this._mutationScanTimeout = null;
    this._mutationAssetTimeout = null;
    if (this.mutationObserver) this.mutationObserver.disconnect();
    this.mutationObserver = null;
    this.mutationObserverStarted = false;
  };

IFrameBridge.prototype._reportContentHeightNow = function() {
    // DOM changes are distinct from ResizeObserver notifications caused by
    // the parent's own iframe resize. Ignore bridge key stamping and no-op
    // attribute writes; keep source styles/text (including HMR head styles).
    if (!this._heightMutationObserver) {
      var self = this;
      this._heightRevision = 0;
      this._heightMutationObserver = new MutationObserver(function(records) {
        records = records.filter(function(record, index) {
          if (record.type !== 'attributes' || record.attributeName !== 'style' || !self._heightRepaintStyles) return true;
          var writes = self._heightRepaintStyles.get(record.target);
          if (!writes) return true;
          // MutationRecord exposes the old value. The next style record (or
          // current attribute) supplies this write's exact resulting value.
          var next = records.slice(index + 1).find(function(other) {
            return other.target === record.target && other.attributeName === 'style';
          });
          var after = next ? next.oldValue : record.target.getAttribute('style');
          var owned = writes.findIndex(function(write) {
            return write.before === record.oldValue && write.after === after;
          });
          if (owned === -1) return true;
          writes.splice(owned, 1);
          if (writes.length === 0) self._heightRepaintStyles.delete(record.target);
          return false;
        });
        var isEditorChrome = function(node) {
          var el = node.nodeType === 1 ? node : node.parentElement;
          return el && el.closest('[data-sq-selection-highlight], [data-sq-ai-highlight], [data-drag-ghost], [data-sq-drop-line], #sq-design-mode-styles, #sq-ai-pulse-style');
        };
        var changed = records.some(function(record, index) {
          if (isEditorChrome(record.target)) return false;
          if (record.type === 'childList') {
            return Array.from(record.addedNodes).some(function(node) { return node.isConnected && !isEditorChrome(node); }) ||
              Array.from(record.removedNodes).some(function(node) {
                // A temporary geometry probe added and removed in this batch
                // has no lasting content effect.
                return !node.isConnected && !isEditorChrome(node) && !records.some(function(other) {
                  return Array.prototype.indexOf.call(other.addedNodes, node) !== -1;
                });
              });
          }
          if (record.type === 'attributes') {
            if (records.slice(0, index).some(function(other) {
              return other.target === record.target && other.attributeName === record.attributeName;
            })) return false;
            return record.oldValue !== record.target.getAttribute(record.attributeName);
          }
          return record.type !== 'characterData' || record.oldValue !== record.target.textContent;
        });
        if (changed) {
          self._heightRevision++;
          self.reportContentHeight();
          // Content moved: the selection box must follow even when body keeps its (vh-pinned) size.
          self.scheduleRectsUpdate();
        }
      });
      this._heightMutationObserver.observe(document.documentElement, {
        childList: true, subtree: true, characterData: true, characterDataOldValue: true,
        attributes: true, attributeOldValue: true,
        attributeFilter: ['class', 'style', 'src', 'width', 'height', 'hidden', 'open']
      });
    }

    // Calculate actual content height by finding the bottom of the last
    // top-level element. This avoids issues with scrollHeight including
    // empty space. O(body children) instead of O(all DOM nodes): the page
    // bottom is determined by top-level flow content; walking every
    // descendant forced a full-DOM rect read per rAF during class-edit drags.
    var maxBottom = 0;
    var kids = document.body.children;

    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      // Skip hidden elements and scripts/styles
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      if (el.offsetParent === null) continue;
      var rect = el.getBoundingClientRect();
      var bottom = rect.bottom + window.scrollY;
      if (bottom > maxBottom) {
        maxBottom = bottom;
      }
    }

    // Keep the true content bottom (not viewport-clamped scrollHeight), so
    // the parent can shrink after removal as well as grow after insertion.
    var height = Math.max(maxBottom, 100);
    // A vh-based margin transition continues changing content geometry at
    // the SAME viewport after the host pauses. It is resize feedback, not
    // a new content edit. Decorative animations do not own this fence.
    var transitioning = typeof document.getAnimations === 'function' && document.getAnimations().some(function(animation) {
      return 'transitionProperty' in animation && (animation.playState === 'running' || animation.pending);
    });

    this.sendToParent({
      type: 'CONTENT_HEIGHT',
      payload: {
        height: height, viewportHeight: window.innerHeight, viewportWidth: window.innerWidth,
        revision: this._heightRevision, transitioning: transitioning,
        documentId: sqLocalDocumentId, href: window.location.href, mode: this.mode
      }
    });
  };

IFrameBridge.prototype.toggleDesignModeListeners = function(add) {
    var method = add ? 'addEventListener' : 'removeEventListener';
    var handlers = this.boundHandlers;

    // Standard capture events
    ['mousedown', 'mouseup', 'mousemove', 'mouseleave', 'click', 'keydown', 'dragover', 'drop'].forEach(function(event) {
      document[method](event, handlers[event], true);
    });

    document[method]('keyup', handlers.altKey, true);
    window[method]('blur', handlers.altKey);

    // Wheel needs special options - capture must match for removal
    if (add) {
      document.addEventListener('wheel', handlers.wheel, { passive: false, capture: true });
    } else {
      document.removeEventListener('wheel', handlers.wheel, { capture: true });
    }
  };
`;
