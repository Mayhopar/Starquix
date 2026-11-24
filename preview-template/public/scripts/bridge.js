// GENERATED FILE — DO NOT EDIT.
// Source of truth: app/src/bridge/parts/*.ts (assembled by IFrameBridgeScript.ts).
// Regenerate: node scripts/build-bridge.mjs   (build-snapshot.js runs this automatically)

(function() {
  if (window.__SQ_BRIDGE__) return;
  window.__SQ_BRIDGE__ = true;

  var isInIframe = window.parent !== window;

  var SCAN_RETRY_BASE_MS = 200;
  var NAVIGATION_SETTLE_MS = 100;
  var DOUBLE_CLICK_THRESHOLD_MS = 300;
  var HOVER_THROTTLE_MS = 50;
  var SCAN_INITIAL_DELAY_MS = 100;
  var SCAN_MAX_RETRIES = 8;
  var CLICK_MOVE_THRESHOLD_PX = 5;
  var DRAG_START_THRESHOLD_PX = 3;
  
  var LINK_SCAN_DELAY_MS = 150;    // Delay before scanning after link creation
  var LINK_SELECT_DELAY_MS = 100;  // Delay before selecting link after scan

  // Tag sets for element classification
  // Root <svg> is scannable/keyable (a shape IS content — it gets a Layers
  // row like <img>); svg INTERNALS (path/circle/g/...) stay skipped so icons
  // don't explode into layer rows.
  // br/wbr: a line break is part of its text, never a row or a keyed child box
  // (sq-tagging never tags them either). Keying one made a <p> with a <br>
  // look like a container, so it drilled instead of text-editing (2026-09-14).
  var SKIP_TAGS = ['br', 'wbr', 'script', 'style', 'noscript', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan', 'g', 'defs', 'clippath', 'mask', 'use', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'stop', 'astro-dev-toolbar', 'html', 'head', 'meta', 'title', 'link', 'base'];
  var MARKUP_SKIP_TAGS = ['script', 'style', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan', 'g', 'defs', 'clippath', 'mask', 'use', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'stop', 'marker'];
  var INLINE_TEXT_TAGS = ['a', 'span', 'em', 'strong', 'b', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup', 'code', 'abbr', 'cite', 'q', 'time'];
  var BLOCK_ELEMENT_SELECTOR = 'div, p, button, input, form, section, article, nav, header, footer, main, aside, ul, ol, li, table, tr, td, th, h1, h2, h3, h4, h5, h6';
  var SIGNIFICANT_MUTATION_TAGS = ['div', 'section', 'main', 'article', 'nav', 'header', 'footer', 'aside', 'form', 'table', 'ul', 'ol'];

  // task-149: the placement segment of a local-mode element key —
  // `src/components/Card.astro:4:1~q<16 hex>` with an optional `#N` repeat
  // suffix. Anchored at the end and hex-strict so a source path that happens to
  // contain '~' cannot false-positive. Capture group 1 = the placement itself.
  // task-159: `q` = the structural id, `p` = the legacy coordinate id kept
  // readable for the migration window. Both must match here — a key stored
  // before the upgrade is still a placement key.
  var PLACEMENT_KEY_PATTERN = /~([pqs][0-9a-f]{16})(?:#\d+)?$/;


  // Load Tailwind CDN for instant visual updates (no JIT compilation needed)
  function loadTailwindCDN() {
    if (window.__TAILWIND_CDN_LOADED__) return;
    window.__TAILWIND_CDN_LOADED__ = true;

    var script = document.createElement('script');
    script.src = '/scripts/tailwind.js';
    script.onload = function() {
      // Check if tailwind object is available
      var checkCount = 0;
      var checkInterval = setInterval(function() {
        checkCount++;
        if (typeof tailwind !== 'undefined') {
          clearInterval(checkInterval);
          tailwind.config = { corePlugins: { preflight: false } };
        } else if (checkCount > 30) {
          clearInterval(checkInterval);
          console.error('[IFrameBridge] ❌ Tailwind object never became available');
        }
      }, 100);
    };
    script.onerror = function(e) {
      console.error('[IFrameBridge] ❌ Tailwind CDN failed to load:', e);
    };
    document.head.appendChild(script);
  }

  // ── Parts ──────────────────────────────────────────────

  
  /** Extract { top, left, width, height } from a DOMRect. */

  /**
   * Bounding rect of an element, falling back to the union of its direct
   * children's rects when the element itself has zero size (e.g.
   * `display: contents`, used by BlogSlot's named `<slot>`).
   */

  function getClosestEdge(rect, cursorX, cursorY, allowedEdges) {
    var distances = {
      top:    Math.abs(cursorY - rect.top),
      bottom: Math.abs((rect.top + rect.height) - cursorY),
      left:   Math.abs(cursorX - rect.left),
      right:  Math.abs((rect.left + rect.width) - cursorX)
    };
    var closest = null, minDist = Infinity;
    for (var i = 0; i < allowedEdges.length; i++) {
      if (distances[allowedEdges[i]] < minDist) {
        minDist = distances[allowedEdges[i]];
        closest = allowedEdges[i];
      }
    }
    return closest;
  }

  /** Force GPU layer recomposition to ensure repaint after class changes. */

  /** Resolve the relative source path from an astro-source-file attribute. */

  IFrameBridge.prototype.getElementClasses = function(element) {
    if (element.className && typeof element.className === 'string') {
      return element.className;
    }
    if (element.className && element.className.baseVal !== undefined) {
      return element.className.baseVal;
    }
    return element.getAttribute('class') || '';
  };

  /**
   * task-149 — placement identity (LOCAL MODE ONLY).
   *
   * `data-sq-source` is the DEFINING file:line:col, so it is identical on every
   * page that renders the same component and on every repeat of it. The tagger
   * (`sq-tagging.js`, armed with `{ placements: true }` by the local-mode
   * plugin) additionally stamps `data-sq-placement` = a hash of the authored
   * component INVOCATION chain. Composing the two gives local mode the
   * per-placement identity server/WC mode get from the doc's `el-…` ids.
   *
   * Resolution order: own `data-sq-placement` → own `data-sq-p` (present when a
   * component spreads `{...Astro.props}` onto its root) → nearest ancestor
   * carrying `data-sq-placement`. An EMPTY `data-sq-placement` is a real answer,
   * not a miss: page files emit it to terminate the walk.
   *
   * Gated on window.__SQ_LOCAL_MODE__ (set by sq-source-plugin's HTML
   * injection) so WC/server keys stay byte-identical by construction and the
   * extra DOM walk never runs there.
   */
  IFrameBridge.prototype.resolvePlacement = function(element) {
    if (!window.__SQ_LOCAL_MODE__) return '';
    if (!element || !element.getAttribute) return '';
    var own = element.getAttribute('data-sq-placement');
    if (own !== null) return own;
    var propAttr = element.getAttribute('data-sq-p');
    // task-160: `data-sq-p` carries the TRIPLE "<s-id> <q-id> <p-id>" — the
    // stamped id first, then the two transitional chains in recency order.
    if (propAttr !== null) return propAttr.split(' ')[0] || '';
    var ancestor = element.closest ? element.closest('[data-sq-placement]') : null;
    return ancestor ? (ancestor.getAttribute('data-sq-placement') || '') : '';
  };

  /**
   * task-159/160 — the SAME resolution over a TRANSITIONAL chain, so a scan can
   * name the addresses an override may have been stored under before the
   * identity scheme changed. Two of them now, because a user's outstanding work
   * can predate EITHER change:
   *
   *   `data-sq-lq` (field 1) — task-159's ordinal chain
   *   `data-sq-lp` (field 2) — the pre-task-159 coordinate chain
   *
   * Field 1 could NOT simply be redefined as "the previous address": under
   * eager stamping the stamp lands before the first scan ever runs, so a
   * pre-task-159 `p…` key would never see a `p` field and would strand.
   *
   * Mirrors `resolvePlacement` exactly, including the rule that an EMPTY value
   * is a real answer (a page file's own elements terminate the walk). Both
   * chains are pure subtraction once one full usage cycle has passed.
   */
  IFrameBridge.prototype.resolveTransitionalPlacement = function(element, attr, field) {
    if (!window.__SQ_LOCAL_MODE__) return '';
    if (!element || !element.getAttribute) return '';
    var own = element.getAttribute(attr);
    if (own !== null) return own;
    var propAttr = element.getAttribute('data-sq-p');
    if (propAttr !== null) return propAttr.split(' ')[field] || '';
    var ancestor = element.closest ? element.closest('[' + attr + ']') : null;
    return ancestor ? (ancestor.getAttribute(attr) || '') : '';
  };

  /** task-159's ordinal chain. */
  IFrameBridge.prototype.resolveOrdinalPlacement = function(element) {
    return this.resolveTransitionalPlacement(element, 'data-sq-lq', 1);
  };

  /** The pre-task-159 coordinate chain. */
  IFrameBridge.prototype.resolveLegacyPlacement = function(element) {
    return this.resolveTransitionalPlacement(element, 'data-sq-lp', 2);
  };

  /** Append the placement segment to a bare `file:line:col` source key. */
  IFrameBridge.prototype.withPlacement = function(sourceKey, element) {
    var placement = this.resolvePlacement(element);
    return placement ? sourceKey + '~' + placement : sourceKey;
  };

  /**
   * The same key under every transitional chain, MOST RECENT FIRST, with
   * empties and duplicates dropped. The parent walks this in order and takes
   * the first tier that has a stored value, so p→s and q→s each migrate in ONE
   * hop — never a transitive replay through an intermediate address.
   */
  IFrameBridge.prototype.legacyKeysFor = function(sourceKey, element) {
    var out = [];
    var chains = [this.resolveOrdinalPlacement(element), this.resolveLegacyPlacement(element)];
    for (var i = 0; i < chains.length; i++) {
      if (!chains[i]) continue;
      var key = sourceKey + '~' + chains[i];
      if (out.indexOf(key) === -1) out.push(key);
    }
    return out;
  };

  IFrameBridge.prototype.findElementByKey = function(key) {
    if (!key || typeof key !== 'string') return null;

    // Escape key for safe use in CSS selector
    var escapedKey = this.escapeCssSelector(key);

    // Direct lookup by data-key
    var element = document.querySelector('[data-key="' + escapedKey + '"]');
    if (element) return element;

    // Try data-sq-source for backwards compatibility.
    // task-149: a placement-scoped key (`…:4:1~p<16 hex>`) never matches a raw
    // data-sq-source attribute, so this fallback simply misses — which is the
    // SAFE outcome. Matching would return an arbitrary sibling placement. The
    // data-key lookup above already covers scanned elements.
    element = document.querySelector('[data-sq-source="' + escapedKey + '"]');
    if (element) return element;

    // Try data-astro-source-file + data-astro-source-loc combo
    // Keys from Astro look like: "src/pages/file.astro:7:27"
    var lastColon = key.lastIndexOf(':');
    if (lastColon > 0) {
      var secondLastColon = key.lastIndexOf(':', lastColon - 1);
      if (secondLastColon > 0) {
        var filePart = key.substring(0, secondLastColon);
        var loc = key.substring(secondLastColon + 1); // "7:27"
        var allAstro = document.querySelectorAll('[data-astro-source-file]');
        for (var a = 0; a < allAstro.length; a++) {
          var el = allAstro[a];
          var file = el.getAttribute('data-astro-source-file');
          var elLoc = el.getAttribute('data-astro-source-loc');
          if (!file || !elLoc) continue;
          var srcIdx = file.indexOf('/src/');
          var rel = srcIdx !== -1 ? file.substring(srcIdx + 1) : file;
          if (rel === filePart && elLoc === loc) {
            // Cache by setting data-key for future lookups
            el.setAttribute('data-key', key);
            return el;
          }
        }
      }
    }

    return null;
  };

  IFrameBridge.prototype.getElementKey = function(element) {
    // Return existing key if present
    var key = element.getAttribute('data-key');
    if (key) return key;

    // For source-tracked elements, build source key. node_modules internals
    // (e.g. astro's own Image.astro renders the <img> and forwards attrs)
    // never get source keys — they fall through to dynamic keys.
    var astroFile = element.getAttribute('data-astro-source-file');
    var astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc && astroFile.indexOf('node_modules') === -1) {
      var srcIndex = astroFile.indexOf('/src/');
      if (srcIndex !== -1) {
        // task-149: same placement composition as resolveSourceKey — this
        // fallback must not hand back an unscoped key for an element the scan
        // would have scoped.
        var sourceKey = this.withPlacement(astroFile.substring(srcIndex + 1) + ':' + astroLoc, element);
        element.setAttribute('data-key', sourceKey);
        return sourceKey;
      }
    }

    // Fallback: generate dynamic key (must be globally unique)
    var tagName = element.tagName.toLowerCase();
    var id = element.id;
    var dynamicKey = 'dynamic:' + tagName;
    if (id) {
      dynamicKey += '#' + id;
    }

    var parent = element.parentElement;
    if (parent) {
      var siblings = Array.from(parent.children);
      var index = siblings.indexOf(element);
      dynamicKey += ':' + index;

      // Include parent's key hash to ensure global uniqueness
      var parentKey = parent.getAttribute('data-key');
      if (parentKey) {
        var parentHash = parentKey.split('').reduce(function(a, b) {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return a & a;
        }, 0);
        dynamicKey += '@' + Math.abs(parentHash).toString(36);
      }
    }

    element.setAttribute('data-key', dynamicKey);
    return dynamicKey;
  };

  /**
   * `<file>:<line>:<col>` -> { file, line, column }, or undefined.
   *
   * ONE parser for BOTH `data-sq-source` and task-148's `data-sq-usage`: the
   * usage attribute is deliberately emitted in the source-key grammar so a
   * component's invocation tag is an ORDINARY source location, handled by every
   * existing writer, scope guard and undo op with no special case.
   *
   * The file is rejoined from the head parts, never `parts[0]` — a Windows-ish
   * or colon-bearing path must not be truncated into a different file.
   */
  IFrameBridge.prototype.parseLocationString = function(value) {
    if (!value) return undefined;
    var parts = value.split(':');
    if (parts.length < 3) return undefined;
    var column = parseInt(parts.pop(), 10);
    var line = parseInt(parts.pop(), 10);
    var file = parts.join(':');
    if (isNaN(line) || isNaN(column) || !file) return undefined;
    return { file: file, line: line, column: column };
  };

  /**
   * task-148 item 7 — WHERE THIS ELEMENT'S COMPONENT WAS PLACED.
   *
   * `data-sq-usage` is field 3 of `data-sq-p`, carried RAW by the tagger: the
   * `file:line:col` of the `<Card />` invocation tag in the file that placed it.
   * It is what "remove this component from THIS page" has to write to, and it is
   * the only address for it that is not derived (no ordinal, no hash inversion,
   * no DOM order) — the compiler hands it over.
   *
   * Read from the element's OWN attribute only, never `closest()`. The
   * ancestor walk that `resolvePlacement` needs would be a BUG here: it crosses
   * component boundaries and would answer with the wrong file. An element with
   * no usage of its own has none — fail closed, and the caller refuses.
   *
   * An EMPTY value is a real answer (a page file's own elements emit `""`), and
   * it parses to undefined, which is exactly the "no usage" the caller wants.
   *
   * Gated on __SQ_LOCAL_MODE__ so WC/server scans stay byte-identical.
   */
  IFrameBridge.prototype.parseUsageLocation = function(element) {
    if (!window.__SQ_LOCAL_MODE__) return undefined;
    if (!element || !element.getAttribute) return undefined;
    var own = element.getAttribute('data-sq-usage');
    var version = element.getAttribute('data-sq-usage-version');
    if (own === null) {
      var propAttr = element.getAttribute('data-sq-p');
      // Field 3 is LAST and read with slice().join(' '), never [3]: a
      // project-relative path may contain spaces and the delimiter is a space.
      var fields = (propAttr || '').split('\t');
      own = fields[0].split(' ').slice(3).join(' ');
      version = fields[1];
    }
    var location = this.parseLocationString(own);
    if (location && version) location.sourceVersion = version;
    return location;
  };

  /**
   * task-207: is this scanned element part of an sq/ SYSTEM component?
   *
   * The rehype pass wraps EVERY component invocation in a post body (D8 probe),
   * so the wrapper alone cannot tell ours from the user's own SingleImage —
   * the source path is what decides. `data-sq-unit` short-circuits it for
   * Media, whose root declares one.
   *
   * Walks from the element up to (and including) the wrapper looking for the
   * nearest `data-sq-source`: an inner element with no source of its own still
   * belongs to whichever component encloses it.
   */
  IFrameBridge.prototype.isSystemComponentElement = function(element, wrapper) {
    if (!wrapper) return false;
    // The block belongs to whatever component the wrapper's own root is. A
    // system component used INSIDE another component (a <Credit/> inside a
    // <CreditWrapper/>) would otherwise splice the OUTER invocation, and
    // setProp matches the first such attribute anywhere in that block — i.e. an
    // arbitrary nested tag. Refuse instead: no stamp, no panel, nothing written.
    // Found by verifying task-207 on the real post route, not by reasoning.
    var root = wrapper.firstElementChild;
    if (!root) return false;

    // A root that declares data-sq-unit (Media) is a system root by definition,
    // even when it carries no data-sq-source of its own.
    if (root.getAttribute && root.getAttribute('data-sq-unit') !== null) {
      return !element.closest || root.contains(element) || root === element;
    }

    var own = this.nearestComponentFile(element, wrapper);
    if (!own || own.indexOf('src/components/sq/') !== 0) return false;
    return this.nearestComponentFile(root, wrapper) === own;
  };

  /** Nearest `data-sq-source` FILE at or above `element`, stopping at
   *  `wrapper`. `data-sq-unit` marks a system root whose own source wins. */
  IFrameBridge.prototype.nearestComponentFile = function(element, wrapper) {
    var node = element;
    while (node && node.getAttribute) {
      var src = node.getAttribute('data-sq-source');
      if (src) return src.replace(/:\d+:\d+$/, '');
      if (node === wrapper) break;
      node = node.parentElement;
    }
    return null;
  };

  IFrameBridge.prototype.parseSourceLocation = function(element) {
    var sourceAttr = element.getAttribute('data-sq-source');
    if (sourceAttr) {
      var fromSource = this.parseLocationString(sourceAttr);
      if (fromSource) {
        var version = element.getAttribute('data-sq-source-version');
        if (version && window.__SQ_LOCAL_MODE__) fromSource.sourceVersion = version;
        return fromSource;
      }
    }

    // node_modules internals must NEVER become a write target — a tag swap
    // once rewrote astro's own Image.astro (its <img> forwards attrs, so it
    // looked source-tracked) and broke every image on the site. Absolute
    // paths without /src/ are equally unwritable — refuse both.
    var astroFile = element.getAttribute('data-astro-source-file');
    var astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc && astroFile.indexOf('node_modules') === -1) {
      var locParts = astroLoc.split(':');
      var line = parseInt(locParts[0], 10);
      var column = parseInt(locParts[1], 10);
      if (!isNaN(line) && !isNaN(column)) {
        var srcIndex = astroFile.indexOf('/src/');
        if (srcIndex !== -1) {
          return { file: astroFile.substring(srcIndex + 1), line: line, column: column };
        }
      }
    }

    return undefined;
  };

  // The layout's <body> when it is a scanned element (scanning.ts bodyHead:
  // data-sq-source under src/layouts/) — the Layers panel's Layout row. Null
  // for a page-file body, which the scan never lists either.
  IFrameBridge.prototype.layoutRootBody = function() {
    var body = document.body;
    var src = body && body.getAttribute('data-sq-source');
    return src && src.indexOf('src/layouts/') === 0 ? body : null;
  };

  IFrameBridge.prototype.findEditableElement = function(target, forSelection, directSelect) {
    if (!target) return null;

    if (target.nodeType !== 1) target = target.parentElement;
    if (!target) return null;
    // A click on <body> / <html> selects the LAYOUT ROOT (owner report
    // 2026-09-10: bare body area was dead to the mouse). Same predicate the
    // scan uses for its body row, so the key is one the parent knows.
    if (target === document.body || target === document.documentElement) return this.layoutRootBody();

    // task-206 D4: a click inside a SELECTION UNIT (an element carrying
    // data-sq-unit — system components' roots, e.g. <Media/>) selects the
    // unit, never the outermost post root the walk below would return.
    // ⌘-click (directSelect) keeps innermost for power users.
    if (forSelection && !directSelect && target.closest) {
      var unitRoot = target.closest('[data-sq-unit]');
      if (unitRoot) return unitRoot;
    }

    var editableAncestors = [];
    var allAncestors = [];
    var current = target;
    while (current && current !== document.documentElement) {
      if (current === document.body) {
        // OUTSIDE → INSIDE (owner ruling 2026-09-11): the layout <body> is the
        // outermost editable ancestor, so the first click on a page selects
        // the Layout; a double-click drills into it (handleDrillDown sets it as
        // the context and the context loop below returns its child).
        if (this.layoutRootBody()) editableAncestors.push(current);
        break;
      }
      var tagName = current.tagName.toLowerCase();
      if (tagName !== 'script' && tagName !== 'style' && tagName !== 'noscript') {
        allAncestors.push(current);
      }

      if (this.isTrackedElement(current)) {
        editableAncestors.push(current);
      }
      current = current.parentElement;
    }

    if (editableAncestors.length === 0) {
      if (allAncestors.length > 0) {
        return allAncestors[0];
      }
      return null;
    }

    if (!forSelection || directSelect) {
      return editableAncestors[0];
    }

    if (this.contextKey) {
      var contextElement = this.findElementByKey(this.contextKey);
      if (contextElement) {
        for (var i = 0; i < editableAncestors.length; i++) {
          var el = editableAncestors[i];
          var parent = this.findEditableElement(el.parentElement, false);
          if (parent && this.getElementKey(parent) === this.contextKey) {
            return el;
          }
          if (el === contextElement) {
            return el;
          }
        }
        if (contextElement.contains(target)) {
          return editableAncestors[0];
        }
      }
    }

    // Return the outermost ancestor, but skip the infrastructure container
    // (the Astro page wrapper with [pageId].astro in its key)
    for (var j = editableAncestors.length - 1; j >= 0; j--) {
      var ancestorKey = this.getElementKey(editableAncestors[j]);
      if (!ancestorKey || !ancestorKey.includes('[pageId].astro')) {
        return editableAncestors[j];
      }
    }
    // Fallback: return innermost if all ancestors are infrastructure
    return editableAncestors[0];
  };

  IFrameBridge.prototype.getComputedStyles = function(element) {
    var computed = window.getComputedStyle(element);
    return {
      display: computed.display,
      boxSizing: computed.boxSizing,
      maxWidth: computed.maxWidth,
      objectFit: computed.objectFit,
      objectPosition: computed.objectPosition,
      borderTopWidth: computed.borderTopWidth,
      borderRightWidth: computed.borderRightWidth,
      borderBottomWidth: computed.borderBottomWidth,
      borderLeftWidth: computed.borderLeftWidth,
      parentDisplay: element.parentElement ? window.getComputedStyle(element.parentElement).display : '',
      imageFillOwned: element.getAttribute('data-sq-image-fill') === 'true',
      imageFillInlineBackground: !!element.style.backgroundImage,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontFamily: computed.fontFamily,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
      color: computed.color,
      width: computed.width,
      height: computed.height,
      paddingTop: computed.paddingTop,
      paddingRight: computed.paddingRight,
      paddingBottom: computed.paddingBottom,
      paddingLeft: computed.paddingLeft,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      backgroundColor: computed.backgroundColor,
      backgroundImage: computed.backgroundImage
    };
  };

  IFrameBridge.prototype._makeThumbnail = function(imgElement, maxWidth) {
    maxWidth = maxWidth || 200;
    try {
      var scale = Math.min(1, maxWidth / imgElement.naturalWidth);
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(imgElement.naturalWidth * scale);
      canvas.height = Math.round(imgElement.naturalHeight * scale);
      var ctx = canvas.getContext('2d');
      ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      return null;
    }
  };

  IFrameBridge.prototype.captureAndSendBgImagePreview = function(element, key) {
    var computed = window.getComputedStyle(element);
    if (!computed.backgroundImage || computed.backgroundImage === 'none') return;
    var bgMatch = computed.backgroundImage.match(/url\(["']?(.+?)["']?\)/);
    if (!bgMatch) return;

    var self = this;
    var url = bgMatch[1];

    // task-120 (5.5): thumbnail capture (Image load + canvas encode) cached
    // per (key, resolved URL) — repeat clicks/refreshes on the same element
    // resend the cached data URL instead of re-capturing.
    this._bgThumbCache = this._bgThumbCache || {};
    var cacheKey = key + '\u0000' + url;
    var cached = this._bgThumbCache[cacheKey];
    if (cached) {
      this.sendToParent({
        type: 'BG_IMAGE_PREVIEW',
        payload: { key: key, dataUrl: cached }
      });
      return;
    }

    // Try without crossOrigin first (same-origin in iframe), fall back to crossOrigin
    function attempt(useCors) {
      var bgImg = new Image();
      if (useCors) bgImg.crossOrigin = 'anonymous';
      bgImg.onload = function() {
        var dataUrl = self._makeThumbnail(bgImg);
        if (dataUrl) {
          self._bgThumbCache[cacheKey] = dataUrl;
          self.sendToParent({
            type: 'BG_IMAGE_PREVIEW',
            payload: { key: key, dataUrl: dataUrl }
          });
        } else if (!useCors) {
          // Tainted canvas from non-CORS load -- retry with CORS
          attempt(true);
        }
      };
      bgImg.onerror = function() {
        // CORS load failed -- retry without if we haven't tried that yet
        if (useCors) attempt(false);
      };
      bgImg.src = url;
    }
    attempt(false);
  };

IFrameBridge.prototype.escapeCssSelector = function(str) {
    if (!str || typeof str !== 'string') return '';
    // Use CSS.escape if available, otherwise manual escape
    if (typeof CSS !== 'undefined' && CSS.escape) {
      return CSS.escape(str);
    }
    // Manual escape for browsers without CSS.escape
    return str.replace(/["\\/:[\](){}|^$.*+?]/g, '\\$&');
  };

IFrameBridge.prototype.escapeHtmlAttr = function(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  };

IFrameBridge.prototype.rectOf = function(element) {
    var rect = element.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return this.buildRect(rect);
    if (!element.children || element.children.length === 0) return this.buildRect(rect);
    var top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    var anyMatch = false;
    for (var i = 0; i < element.children.length; i++) {
      var cr = element.children[i].getBoundingClientRect();
      if (cr.width === 0 && cr.height === 0) continue;
      anyMatch = true;
      if (cr.top < top) top = cr.top;
      if (cr.left < left) left = cr.left;
      if (cr.right > right) right = cr.right;
      if (cr.bottom > bottom) bottom = cr.bottom;
    }
    return anyMatch
      ? { top: top, left: left, width: right - left, height: bottom - top }
      : this.buildRect(rect);
  };

IFrameBridge.prototype.buildRect = function(domRect) {
    return {
      top: domRect.top,
      left: domRect.left,
      width: domRect.width,
      height: domRect.height
    };
  };

IFrameBridge.prototype.requireElement = function(key, warnMsg) {
    var element = this.findElementByKey(key);
    if (!element && warnMsg) {
      console.warn('[IFrameBridge] ' + warnMsg + ':', key);
    }
    return element;
  };

// task-240: files-truth blog CHROME the source stamps like any element but
  // that is ours, not the user's — the per-card post-link wrapper a bound page
  // emits (<a href data-sq-post-slug><BlogCard/></a>, utils/blogBinding) and
  // BlogSlot.astro's pagination container. Scanned as elements they were a
  // page-file row between the posts container and the BlogCard root (the drill
  // stopped on it: pencil, but no ↗/⋮ — those need a component-file placement
  // ROOT) and a 0×0 "div" row with pagination off. Transparent everywhere:
  // never a row, never a click/drill stop; children nest under the next
  // tracked ancestor. The wrapper's slug still reaches the card through
  // closest('[data-sq-post-slug]').
  IFrameBridge.prototype.isBlogChrome = function(element) {
    return element.hasAttribute('data-sq-post-slug') ||
           element.getAttribute('data-blog-source') === 'pagination';
  };

  IFrameBridge.prototype.isTrackedElement = function(element) {
    if (this.isBlogChrome(element)) return false;
    return element.hasAttribute('data-key') ||
           element.hasAttribute('data-sq-source') ||
           element.hasAttribute('data-astro-source-file');
  };

IFrameBridge.prototype.isInstanceChildKey = function(key) {
    if (!key || typeof key !== 'string') return false;
    // Instance-child keys have format: instanceId:tagname-index
    // The selector part (after last colon) should match tagname-number pattern
    var colonIdx = key.lastIndexOf(':');
    if (colonIdx <= 0) return false;
    var selector = key.substring(colonIdx + 1);
    return /^[a-z][a-z0-9]*-\d+$/i.test(selector);
  };

IFrameBridge.prototype.findParentKey = function(element, excludeKey) {
    var parent = element.parentElement;
    // Layout-element paradigm (2026-08-24): the walk INCLUDES document.body —
    // a layout-owned body is a scanned element (data-key stamped first in the
    // scan pass) and children must nest under it. A keyless body returns null
    // exactly as the old body-excluding walk did.
    while (parent && parent !== document.documentElement) {
      var key = parent.getAttribute('data-key');
      if (key && key !== excludeKey) {
        return key;
      }
      parent = parent.parentElement;
    }
    return null;
  };

IFrameBridge.prototype.findAncestorWithInstanceChildKey = function(element) {
    var current = element.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      var key = current.getAttribute('data-key');
      if (key && this.isInstanceChildKey(key)) {
        return { element: current, key: key };
      }
      current = current.parentElement;
    }
    return null;
  };

IFrameBridge.prototype.getParentDisplay = function(element) {
    if (!element.parentElement) return null;
    return window.getComputedStyle(element.parentElement).display;
  };

IFrameBridge.prototype.findRootSection = function(element) {
    var current = element;
    var root = element;
    while (current && current !== document.body && current !== document.documentElement) {
      // #sq-components is the editor shell wrapper — it carries a
      // data-sq-source of the preview shell .astro, but it is NEVER a
      // content section. Without this boundary every element "rooted" to the
      // whole page (one page-sized AI stroke instead of per-section).
      if (current.id === 'sq-components') break;
      var key = current.getAttribute('data-key') || current.getAttribute('data-sq-source');
      if (key) {
        root = current;
      }
      current = current.parentElement;
    }
    return root;
  };

IFrameBridge.prototype.hasBlockChildren = function(element) {
    var children = element.querySelectorAll('[data-key], [data-sq-source]');
    for (var i = 0; i < children.length; i++) {
      var childTag = children[i].tagName.toLowerCase();
      if (INLINE_TEXT_TAGS.indexOf(childTag) === -1) {
        return true;
      }
    }
    return element.children.length > 0 && element.querySelector(BLOCK_ELEMENT_SELECTOR) !== null;
  };

IFrameBridge.prototype.getPostSlug = function(element) {
    if (!element || !element.closest) return null;
    var el = element.nodeType === 1 ? element : element.parentElement;
    if (!el) return null;
    var slugEl = el.closest('[data-sq-post-slug]');
    return slugEl ? slugEl.getAttribute('data-sq-post-slug') : null;
  };

/** task-142/143: astro <Image> output — decode the dev /_image?href=/@fs… URL
 *  to the real bound asset under src/. These imgs carry NO data-sq-source
 *  (their render is attributed to node_modules/astro — never emitted), so the
 *  underlying asset path is the only editable handle. Shared by the click
 *  payload AND the scan so Layers-selected imgs classify identically. */
IFrameBridge.prototype.decodeBoundAssetPath = function(element) {
    if (element.getAttribute('data-image-component') !== 'true') return null;
    var rawImgSrc = element.getAttribute('src') || '';
    if (rawImgSrc.indexOf('/_image?') !== 0) return null;
    try {
      var boundHref = new URL(rawImgSrc, window.location.origin).searchParams.get('href') || '';
      if (boundHref.indexOf('/@fs') === 0) {
        var boundFsPath = boundHref.slice(4).split('?')[0];
        if (boundFsPath.indexOf('/node_modules/') === -1) return boundFsPath;
      }
    } catch (imgUrlErr) { /* malformed URL — no handle */ }
    return null;
  };

/** task-143: position of an astro-<Image> img among such imgs WITHIN ITS
 *  OWNING COMPONENT'S subtree — the component-default-image write maps it to
 *  the nth image tag in that component's source. Scope = the OUTERMOST
 *  ancestor tagged with the owner file (an inner tagged div would give every
 *  img index 0); no component owner → whole document (component view of a
 *  page-level img). Nested sub-components inside the owner can still shift
 *  the index — per-tag static components only. */
IFrameBridge.prototype.imageComponentIndexOf = function(element) {
    if (element.getAttribute('data-image-component') !== 'true') return -1;
    var ownerFile = this.resolveOwnerComponentFile(element);
    var scope = null;
    if (ownerFile) {
      var cur = element.closest ? element.closest('[data-sq-source]') : null;
      while (cur) {
        if ((cur.getAttribute('data-sq-source') || '').split(':')[0] === ownerFile) scope = cur;
        cur = cur.parentElement ? cur.parentElement.closest('[data-sq-source]') : null;
      }
    }
    var all = (scope || document).querySelectorAll('img[data-image-component="true"]');
    for (var ii = 0; ii < all.length; ii++) { if (all[ii] === element) return ii; }
    return -1;
  };

/** task-142/143: img with no source location (prop-driven astro <Image>) —
 *  the OWNING component's file (nearest tagged component/layout ancestor),
 *  so the panel can offer "Edit component" / the usage picker. */
IFrameBridge.prototype.resolveOwnerComponentFile = function(element) {
    var ownerEl = element.closest ? element.closest('[data-sq-source]') : null;
    if (!ownerEl) return null;
    var ownerSrc = ownerEl.getAttribute('data-sq-source') || '';
    var ownerFile = ownerSrc.split(':')[0];
    if (ownerFile.indexOf('src/components/') === 0 || ownerFile.indexOf('src/layouts/') === 0) {
      return ownerFile;
    }
    return null;
  };

/** Read-only navigation evidence for a card, never a write target: a bound
 *  card's link is its page's <a data-sq-post-slug> wrapper (transparent
 *  chrome), an imported card's are the links in its own <article>. */
IFrameBridge.prototype.getPostLinkPaths = function(element) {
    if (!element || !element.closest) return [];
    var wrapper = element.closest('a[data-sq-post-slug]');
    var article = wrapper ? null : element.closest('article');
    var links = wrapper ? [wrapper] : article ? article.querySelectorAll('a[href]') : [];
    var paths = [];
    for (var i = 0; i < links.length; i++) {
      if (article && links[i].closest('article') !== article) continue;
      var href = links[i].getAttribute('href');
      if (!href || !href.trim() || href.trim().charAt(0) === '#') continue;
      try {
        var url = new URL(href, document.baseURI);
        if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== window.location.origin) continue;
        if (paths.indexOf(url.pathname) === -1) paths.push(url.pathname);
      } catch (err) { /* Invalid links supply no post identity. */ }
    }
    return paths;
  };

/** The link an element is or sits inside: its own, never one it merely holds or
 *  a click landed near. No link: linkBlocked if an <a> cannot go around it. */
IFrameBridge.prototype.linkAttributesOf = function(element) {
    var link = element.closest('a[href]');
    if (!link) {
      // HTML: an <a> holds no interactive content; a wrapper breaks table and document structure.
      var cannotHold = 'a,button,input,select,textarea,label,iframe,embed,details';
      var cannotWrap = 'html,body,tr,td,th,thead,tbody,tfoot,caption,colgroup,col,option,summary';
      return element.matches(cannotHold + ',' + cannotWrap) || element.querySelector(cannotHold) ? { linkBlocked: true } : null;
    }
    return {
      // A bound card's wrapper has no key: the binding writes it, the panel only follows it.
      linkKey: link.hasAttribute('data-sq-post-slug') ? undefined : link.getAttribute('data-key') || undefined,
      linkHref: link.getAttribute('href') || '',
      linkTarget: link.getAttribute('target') || undefined,
      linkAriaLabel: link.getAttribute('aria-label') || undefined
    };
  };

// Selection/HMR can arrive before image decode. Retain one guarded load
// callback, using the existing thumbnail message after pixels become ready.
IFrameBridge.prototype.captureAndSendImagePreview = function(element, key) {
    if (this._imagePreviewSelectionKey && this._imagePreviewSelectionKey !== key) return;
    if (this._imagePreviewSelectionElement && this._imagePreviewSelectionElement !== element) return;
    if (this._imagePreviewCleanup) this._imagePreviewCleanup();
    var self = this;
    var src = element.getAttribute('src');
    var cleanup = function() {
      element.removeEventListener('load', loaded);
      element.removeEventListener('error', cleanup);
      if (self._imagePreviewCleanup === cleanup) self._imagePreviewCleanup = null;
    };
    var loaded = function() {
      cleanup();
      if (!element.isConnected || element.getAttribute('src') !== src ||
          (self._imagePreviewSelectionKey && self._imagePreviewSelectionKey !== key) ||
          !element.complete || !element.naturalWidth) return;
      var dataUrl = self._makeThumbnail(element);
      if (dataUrl) self.sendToParent({ type: 'IMAGE_PREVIEW_REFRESH', payload: { key: key, dataUrl: dataUrl } });
    };
    this._imagePreviewCleanup = cleanup;
    if (element.complete && element.naturalWidth > 0) loaded();
    else {
      element.addEventListener('load', loaded, { once: true });
      element.addEventListener('error', cleanup, { once: true });
    }
  };

IFrameBridge.prototype.buildElementPayload = function(element, options, ctx) {
    // ctx (optional, blog-card click only): { rawTarget, clickedCardWrapper }
    // Non-first blog cards have their data-key attrs stripped at render, so the
    // caller redirects `element` to the first-card template for ancestor
    // walking. Map back to the actually-clicked card so per-instance attrs
    // (href/src/slug) and the overlay rect come from the right card.
    ctx = ctx || {};
    var clickedEquivalent = ctx.clickedCardWrapper
      ? this._mapFirstCardElementToClickedCard(element, ctx.clickedCardWrapper)
      : null;

    var originalElement = clickedEquivalent || element;
    var originalPostSlug = this.getPostSlug(originalElement);

    var key = this.getElementKey(element);
    if (this._imagePreviewCleanup) this._imagePreviewCleanup();
    this._imagePreviewSelectionKey = key;
    this._imagePreviewSelectionElement = originalElement;
    var tagName = element.tagName.toLowerCase();
    var payload = {
      key: key,
      tagName: tagName,
      classes: this.getElementClasses(element),
      sourceLocation: this.parseSourceLocation(element),
      rect: this.rectOf(element),
      parentKey: this.getEditableParentKey(element),
      parentDisplay: this.getParentDisplay(element),
      hasChildren: this.hasBlockChildren(element)
    };

    if (options) {
      for (var prop in options) {
        if (options.hasOwnProperty(prop)) {
          payload[prop] = options[prop];
        }
      }
    }

    if (!options || options.computedStyles !== false) {
      payload.computedStyles = this.getComputedStyles(element);
    }

    // Fallback to ctx.rawTarget when originalElement is outside any card
    // (e.g. blog slot selected) but the raw click landed on a card with
    // data-sq-post-slug. Note: must NOT fall back to `element` — when
    // clickedEquivalent is set, `element` is the first-card template and
    // would yield post #1's slug instead of the actually-clicked card's.
    var slug = originalPostSlug || (ctx.rawTarget ? this.getPostSlug(ctx.rawTarget) : null);
    if (slug) payload.postSlug = slug;
    payload.postLinkPaths = this.getPostLinkPaths(clickedEquivalent || ctx.rawTarget || originalElement);

    // task-140: unresolved media-fill flag rides the click payload so the
    // DesignBar Fill block can show the Media state without a doc mirror.
    if (originalElement.getAttribute('data-sq-media') === 'true') {
      payload.mediaFill = true;
    }

    // task-141: Media tab picks tag-swap vs background treatment by element
    // children (text nodes excluded natively by .children).
    payload.hasElementChildren = originalElement.children.length > 0;

    // task-141: video src rides imageAttributes too — the resolved-media
    // undo (inverse tag swap) needs the previous src for either tag.
    if (tagName === 'img' || tagName === 'video') {
      payload.imageAttributes = {
        src: originalElement.getAttribute('src') || null,
        alt: originalElement.getAttribute('alt') || null,
        loading: originalElement.getAttribute('loading') || null
      };
      if (tagName === 'img' && originalElement.naturalWidth > 0 && originalElement.complete) {
        var thumbDataUrl = this._makeThumbnail(originalElement);
        if (thumbDataUrl) payload.imagePreviewDataUrl = thumbDataUrl;
      } else if (tagName === 'img') {
        this.captureAndSendImagePreview(originalElement, key);
      }
    }

    if (tagName === 'video') {
      payload.videoAttributes = {
        src: originalElement.getAttribute('src') || null,
        autoplay: originalElement.hasAttribute('autoplay') ? 'true' : 'false',
        loop: originalElement.hasAttribute('loop') ? 'true' : 'false',
        muted: originalElement.hasAttribute('muted') ? 'true' : 'false',
        controls: originalElement.hasAttribute('controls') ? 'true' : 'false'
      };
    }

    // task-142: astro <Image> bound-asset handle (see decodeBoundAssetPath).
    if (tagName === 'img') {
      var boundPath = this.decodeBoundAssetPath(originalElement);
      if (boundPath) payload.boundAssetPath = boundPath;
      var imgCompIdx = this.imageComponentIndexOf(originalElement);
      if (imgCompIdx >= 0) payload.imageComponentIndex = imgCompIdx;
      // Prop-driven astro <Image>: name the OWNING component so the panel can
      // offer "Edit component" / the usage picker.
      if (!payload.sourceLocation) {
        var ownerFile = this.resolveOwnerComponentFile(element);
        if (ownerFile) payload.ownerComponentFile = ownerFile;
      }
    }

    if (clickedEquivalent) {
      payload.rect = this.rectOf(clickedEquivalent);
    }

    return payload;
  };

IFrameBridge.prototype.buildSelectionPayload = function(key) {
    var selection = document.getSelection();
    if (!selection || selection.rangeCount === 0) {
      return { key: key, selectedText: '', hasSelection: false, isInsideLink: false };
    }

    var selectedText = selection.toString();
    var hasSelection = !selection.isCollapsed && selectedText.trim().length > 0;
    var range = selection.getRangeAt(0);

    // Check for cross-link-boundary selection (invalid)
    if (hasSelection) {
      var startLink = this.findClosestLink(range.startContainer);
      var endLink = this.findClosestLink(range.endContainer);
      var crossesBoundary = (startLink && !endLink) || (!startLink && endLink) ||
                            (startLink && endLink && startLink !== endLink);
      if (crossesBoundary) {
        return { key: key, selectedText: '', hasSelection: false, isInsideLink: false };
      }

      // Save selection for later use
      var textNode = range.startContainer;
      if (textNode.nodeType === Node.TEXT_NODE) {
        this.savedSelectionRange = {
          key: key, selectedText: selectedText,
          startOffset: range.startOffset, endOffset: range.endOffset,
          textContent: textNode.textContent
        };
      } else {
        this.savedSelectionRange = { range: range.cloneRange(), key: key, selectedText: selectedText };
      }
    }

    // Check if cursor is inside a link
    var linkElement = this.findClosestLink(range.commonAncestorContainer);
    var payload = {
      key: key,
      selectedText: selectedText,
      hasSelection: hasSelection,
      isInsideLink: !!linkElement
    };

    if (linkElement) {
      payload.existingHref = linkElement.getAttribute('href') || '';
      payload.existingTarget = linkElement.getAttribute('target') || undefined;
      payload.linkKey = linkElement.getAttribute('data-key') || undefined;
    }

    return payload;
  };


IFrameBridge.prototype.updateAttribute = function(element, attr, value) {
    if (value) {
      element.setAttribute(attr, value);
    } else {
      element.removeAttribute(attr);
    }
  };



  
  var BLOCK_CONTAINERS = new Set([
    'div', 'section', 'article', 'nav', 'header', 'footer',
    'main', 'aside', 'form', 'ul', 'ol', 'li', 'table', 'td', 'th',
    'details', 'dialog', 'fieldset', 'figure', 'figcaption'
  ]);

  function isInstanceChildKey(key) {
    if (!key || key.includes('/')) return false;
    var colonIdx = key.lastIndexOf(':');
    if (colonIdx <= 0) return false;
    var selector = key.slice(colonIdx + 1);
    return /^[a-z][a-z0-9]*-\d+$/i.test(selector);
  }

  // A grid with ONE column is a stack: its children reorder like any stack's.
  // Pinning a row there (col-start-1 row-start-3 on the base layer) follows the
  // card to every wider breakpoint and strands it on a row of its own.
  function isStackGrid(style) {
    return /^[\d.]+px$/.test((style.gridTemplateColumns || '').trim());
  }

  function keyOf(el) {
    return el.getAttribute('data-key') || el.getAttribute('data-sq-source');
  }

  function FlowDragManager(bridge) {
    this._bridge = bridge;
    this._state = null;
    this._containers = null;
    this._currentTarget = null;
    this._reparentTarget = null;
  }

  /** A look-alike copy that is pure drag chrome: no keys or ids (never found,
   *  scanned or selected), islands flattened to their SSR markup so cloning
   *  never hydrates a component twice. */
  FlowDragManager.prototype._inertClone = function(el) {
    var copy = el.cloneNode(true);
    var all = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('*')));
    for (var i = 0; i < all.length; i++) {
      all[i].removeAttribute('data-key');
      all[i].removeAttribute('data-sq-source');
      all[i].removeAttribute('id');
    }
    var islands = copy.querySelectorAll('astro-island');
    for (var j = 0; j < islands.length; j++) {
      var flat = document.createElement('div');
      flat.innerHTML = islands[j].innerHTML;
      islands[j].parentNode.replaceChild(flat, islands[j]);
    }
    copy.setAttribute('data-drag-ghost', 'true');
    return copy;
  };

  FlowDragManager.prototype._createGhost = function(el, rect) {
    var ghost = this._inertClone(el);
    ghost.style.position = 'fixed';
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    ghost.style.left = rect.left + 'px';
    ghost.style.top = rect.top + 'px';
    ghost.style.opacity = '0.6';
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '99999';
    ghost.style.margin = '0';
    ghost.style.transition = 'none';
    document.body.appendChild(ghost);
    return ghost;
  };

  FlowDragManager.prototype._detectAxis = function(parentElement, style) {
    var parentStyle = style || window.getComputedStyle(parentElement);
    var display = parentStyle.display;

    // Grid: use grid-auto-flow to determine primary axis
    if (display === 'grid' || display === 'inline-grid') {
      if (isStackGrid(parentStyle)) return 'vertical';
      var autoFlow = parentStyle.gridAutoFlow || 'row';
      return autoFlow.indexOf('column') !== -1 ? 'vertical' : 'horizontal';
    }

    var isHorizontal = display === 'flex' || display === 'inline-flex';
    if (isHorizontal) {
      var direction = parentStyle.flexDirection;
      if (direction === 'column' || direction === 'column-reverse') {
        isHorizontal = false;
      }
    }
    return isHorizontal ? 'horizontal' : 'vertical';
  };

  /** Insert target from [{el, rect}] entries — the ONE insert-position rule
   *  (reorder passes cached rects; reparent maps live rects). */
  FlowDragManager.prototype._findInsertTarget = function(entries, cursorX, cursorY, axis) {
    var edges = axis === 'horizontal' ? ['left', 'right'] : ['top', 'bottom'];
    for (var i = 0; i < entries.length; i++) {
      var edge = getClosestEdge(entries[i].rect, cursorX, cursorY, edges);
      if (axis === 'horizontal' ? edge === 'left' : edge === 'top') {
        return entries[i].el;
      }
    }
    return null;
  };

  FlowDragManager.prototype.handleStart = function(payload) {
    if (!payload || !payload.key) return;

    var el = this._bridge.findElementByKey(payload.key);
    if (!el) return;
    var parentElement = el.parentElement;
    if (!parentElement) return;

    var parentStyle = window.getComputedStyle(parentElement);
    var gridParent = parentStyle.display === 'grid' || parentStyle.display === 'inline-grid';
    var isGrid = gridParent && !isStackGrid(parentStyle);
    // The host assumes cell placement for a grid child: tell it this one reorders.
    if (gridParent && !isGrid) this._bridge.sendToParent({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'flow' } });

    var rect = el.getBoundingClientRect();
    var parentRect = parentElement.getBoundingClientRect();
    var ghost = this._createGhost(el, rect);
    var axis = this._detectAxis(parentElement);

    // Owner UX 2026-11-11 (flexbox-style, reverses the 2026-11-08 drop line
    // for same-parent drags): a ghost follows the cursor, a dimmed copy of
    // the element holds its slot and moves LIVE between the siblings — top
    // half of a hovered sibling = slot above it, bottom half = below. The
    // real element stays hidden at its original spot (scans keep the true
    // order); handleEnd commits ONE insertBefore into the slot.
    el.style.opacity = '0.3';
    el.style.pointerEvents = 'none';

    this._state = {
      key: payload.key,
      element: el,
      ghost: ghost,
      ghostOffsetX: payload.iframeX - rect.left,
      ghostOffsetY: payload.iframeY - rect.top,
      parentElement: parentElement,
      axis: axis,
      isGrid: isGrid,
      siblingRects: null, // re-measured after every slot move (siblings shift)
      placeholder: null, // the dimmed copy holding the reorder slot
      // Measured now: once the slot copy is in, the hidden element measures 0.
      dragSize: isGrid ? 0 : rect[axis === 'vertical' ? 'width' : 'height'],
      originalParentRect: { left: parentRect.left, top: parentRect.top, right: parentRect.right, bottom: parentRect.bottom },
      startX: payload.iframeX,
      startY: payload.iframeY,
      mode: 'reorder',
    };
  };

  /** The insertion line for a drop into ANOTHER container (same-parent
   *  reorder moves a live slot instead), position:fixed above the page. entries = [{el, rect}] in order;
   *  the line sits between targetRef (null = end) and the entry before it. */
  FlowDragManager.prototype._showDropLine = function(box, axis, entries, targetRef) {
    var line = this._dropLine;
    if (!line) {
      line = this._dropLine = document.createElement('div');
      line.setAttribute('data-sq-drop-line', 'true');
      line.style.position = 'fixed';
      line.style.zIndex = '99998';
      line.style.pointerEvents = 'none';
      line.style.background = '#3b82f6';
      line.style.borderRadius = '1px';
      document.body.appendChild(line);
    }
    var at = entries.length;
    for (var i = 0; i < entries.length; i++) if (entries[i].el === targetRef) { at = i; break; }
    var next = entries[at] ? entries[at].rect : null, prev = at > 0 ? entries[at - 1].rect : null;
    var horizontal = axis === 'horizontal';
    var lo = horizontal ? 'left' : 'top', hi = horizontal ? 'right' : 'bottom';
    var pos = next && prev ? (prev[hi] + next[lo]) / 2 : next ? next[lo] - 1 : prev ? prev[hi] + 1 : box[lo];
    line.style.left = (horizontal ? pos - 1 : box.left) + 'px';
    line.style.top = (horizontal ? box.top : pos - 1) + 'px';
    line.style.width = (horizontal ? 2 : box.right - box.left) + 'px';
    line.style.height = (horizontal ? box.bottom - box.top : 2) + 'px';
    line.style.display = '';
  };

  /** The next real sibling (drag chrome and the hidden dragged element
   *  skipped); null when last. */
  FlowDragManager.prototype._nextSibling = function(el) {
    var n = el.nextElementSibling;
    while (n && (this._bridge.isEditorNode(n) || n === this._state.element)) n = n.nextElementSibling;
    return n;
  };

  /** Reorder slot: a dimmed inert copy in the flow; the real element hides. */
  FlowDragManager.prototype._ensurePlaceholder = function() {
    var state = this._state;
    if (state.placeholder) return state.placeholder;
    var ph = this._inertClone(state.element);
    ph.style.opacity = '0.3';
    ph.style.pointerEvents = 'none';
    ph.style.display = '';
    state.parentElement.insertBefore(ph, state.element);
    state.element.style.display = 'none';
    state.placeholder = ph;
    state.siblingRects = null;
    this._containers = null;
    return ph;
  };

  /** Drop the slot copy and show the real element at its original spot. */
  FlowDragManager.prototype._clearPlaceholder = function() {
    var state = this._state;
    if (!state || !state.placeholder) return;
    if (state.placeholder.parentNode) state.placeholder.parentNode.removeChild(state.placeholder);
    state.placeholder = null;
    state.element.style.display = '';
    state.siblingRects = null;
    this._containers = null;
  };

  /** A container's real children with their rects (drag chrome and the
   *  dragged element skipped). */
  FlowDragManager.prototype._childEntries = function(parent) {
    var entries = [];
    for (var i = 0; i < parent.children.length; i++) {
      var kid = parent.children[i];
      if (kid === this._state.element || this._bridge.isEditorNode(kid)) continue;
      entries.push({ el: kid, rect: kid.getBoundingClientRect() });
    }
    return entries;
  };

  /** Move the slot to the pointer: before the first sibling whose nearer
   *  edge (along the stack) is its leading one. Rects are re-read after a
   *  move, so a hovered sibling that slid away is judged where it now is. */
  FlowDragManager.prototype._reorderMove = function(x, y) {
    var state = this._state;
    var ph = this._ensurePlaceholder();
    if (!state.siblingRects) state.siblingRects = this._childEntries(state.parentElement);
    var targetRef = this._findInsertTarget(state.siblingRects, x, y, state.axis);
    if (targetRef === this._nextSibling(ph)) return;
    state.parentElement.insertBefore(ph, targetRef);
    state.siblingRects = null;
    this._containers = null;
  };

  FlowDragManager.prototype._cleanupIndicators = function() {
    if (this._dropLine && this._dropLine.parentNode) this._dropLine.parentNode.removeChild(this._dropLine);
    this._dropLine = null;
    var lit = document.querySelectorAll('[data-reparent-highlight]');
    for (var i = 0; i < lit.length; i++) {
      lit[i].style.outline = '';
      lit[i].removeAttribute('data-reparent-highlight');
    }
    this._lastInsertRef = undefined;
  };


  FlowDragManager.prototype._teardown = function() {
    if (!this._state) return;
    this._clearPlaceholder();
    if (this._state.ghost && this._state.ghost.parentNode) {
      this._state.ghost.parentNode.removeChild(this._state.ghost);
    }
    this._state.element.style.opacity = '';
    this._state.element.style.pointerEvents = '';
    this._cleanupIndicators();
    this._state = null;
    this._containers = null;
    this._currentTarget = null;
    this._reparentTarget = null;
  };

  FlowDragManager.prototype.handleCancel = function() {
    if (!this._state) return;
    // The real element never moved — teardown drops the slot copy and the chrome.
    this._teardown();

    this._bridge.sendToParent({
      type: 'DRAG_ELEMENT_DROP',
      payload: { cancelled: true }
    });
  };

  FlowDragManager.prototype._scanContainers = function(){
    var state = this._state;
    if (!state) return [];

    // task-120 (5.2/C3): single DOM walk with depth tracked as we descend.
    // The dragged element and drag chrome subtrees are pruned outright. The
    // original parent is ALWAYS a target — even <body> or an untagged wrapper
    // (sections directly in <body> once snapped back: log-proven 2026-11-11).
    // Any other container must be larger than the dragged element across its
    // stack (width for a vertical stack, height for a row): a same-size
    // sibling section — or anything inside one — means "before/after it", not
    // "inside" (a sideways hand drift used to nest a section into its
    // neighbour, log-proven 2026-11-10). Ancestors always fit.
    // ponytail: size heuristic; a same-width wrapper is nested via Layers.
    var containers = [];
    var self = this;
    var dim = state.axis === 'vertical' ? 'width' : 'height';

    function walk(node, depth) {
      var kids = node.children;
      for (var i = 0; i < kids.length; i++) {
        var el = kids[i];
        if (el === state.element || self._bridge.isEditorNode(el)) continue;
        var isParent = el === state.parentElement;
        var key = keyOf(el);
        if (isParent || (key && BLOCK_CONTAINERS.has(el.tagName.toLowerCase()) && !isInstanceChildKey(key))) {
          var style = window.getComputedStyle(el);
          var rect = el.getBoundingClientRect();
          if (isParent || (style.display !== 'none' &&
              (rect[dim] > state.dragSize + 1 || el.contains(state.element)))) {
            containers.push({ element: el, rect: rect, key: key, axis: self._detectAxis(el, style), depth: depth });
          }
        }
        walk(el, depth + 1);
      }
    }

    walk(document.documentElement, 0);
    return containers;
  };

  FlowDragManager.prototype._findDeepestContainer = function(x, y) {
    // Lazy: any layout change (a slot move) drops the cache.
    if (!this._containers) this._containers = this._scanContainers();

    var candidates = [];
    for (var i = 0; i < this._containers.length; i++) {
      var c = this._containers[i];
      if (x >= c.rect.left && x <= c.rect.right &&
          y >= c.rect.top  && y <= c.rect.bottom) {
        candidates.push(c);
      }
    }
    if (candidates.length === 0) return null;
    candidates.sort(function(a, b) { return b.depth - a.depth; });
    return candidates[0];
  };

  FlowDragManager.prototype._enterReparentMode = function() {
    var state = this._state;
    if (!state) return;

    // Leaving reorder drops the slot copy: the element is back in place.
    this._clearPlaceholder();
    this._containers = null;
    this._currentTarget = null;
    state.mode = 'reparent';
  };

  FlowDragManager.prototype._exitReparentMode = function() {
    this._cleanupIndicators();
    this._reparentTarget = null;
    this._containers = null;
    this._currentTarget = null;
    this._state.mode = 'reorder';
  };

  FlowDragManager.prototype._handleReparentMove = function(container, x, y) {

    // Clean up previous indicators if target changed
    if (container !== this._currentTarget) {
      this._cleanupIndicators();
      this._currentTarget = container;
      this._lastInsertRef = undefined;
    }

    if (!container) {
      // No container under the cursor — a stale target must not survive,
      // or the drop would land in whatever was hovered last.
      this._reparentTarget = null;
      return;
    }

    // Highlight container
    container.element.style.outline = '2px solid #3b82f6';
    container.element.setAttribute('data-reparent-highlight', 'true');

    // Find insertion position among container's children
    var entries = this._childEntries(container.element);
    var targetRef = this._findInsertTarget(entries, x, y, container.axis);
    var insertIndex = entries.length;
    for (var i = 0; i < entries.length; i++) if (entries[i].el === targetRef) { insertIndex = i; break; }

    // Update insertion info (used by handleEnd)
    this._reparentTarget = {
      containerKey: container.key,
      element: container.element,
      insertIndex: insertIndex,
    };

    // Skip redraws if insert position hasn't changed
    if (targetRef === this._lastInsertRef) return;
    this._lastInsertRef = targetRef;
    this._showDropLine(container.rect, container.axis, entries, targetRef);
  };




  FlowDragManager.prototype.handleMove = function(payload) {
    if (!this._state) return;

    var state = this._state;

    // Ghost follows cursor, or snaps to grid cell when applicable
    var snap = state.isGrid && state.mode === 'reorder' && payload.snapRect;
    if (snap) {
      state.ghost.style.left = payload.snapRect.left + 'px';
      state.ghost.style.top = payload.snapRect.top + 'px';
      state.ghost.style.width = payload.snapRect.width + 'px';
      state.ghost.style.height = payload.snapRect.height + 'px';
    } else {
      state.ghost.style.left = (payload.iframeX - state.ghostOffsetX) + 'px';
      state.ghost.style.top = (payload.iframeY - state.ghostOffsetY) + 'px';
    }

    // Has the cursor left the original parent's box?
    var parentRect = state.originalParentRect;
    var inParent = payload.iframeX >= parentRect.left && payload.iframeX <= parentRect.right &&
                   payload.iframeY >= parentRect.top  && payload.iframeY <= parentRect.bottom;

    if (state.isGrid) {
      // Grid children: containment-based, REVERSIBLE mode. No cross-axis flip —
      // horizontal cell-to-cell drags inside the grid must stay in reorder mode.
      if (!inParent && state.mode !== 'reparent') {
        this._enterReparentMode();
        this._bridge.sendToParent({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'reparent' } });
      } else if (inParent && state.mode === 'reparent') {
        this._exitReparentMode();
        this._bridge.sendToParent({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'grid' } });
      }
      if (state.mode === 'reparent') {
        this._handleReparentMove(this._findDeepestContainer(payload.iframeX, payload.iframeY), payload.iframeX, payload.iframeY);
      }
      return;
    }

    // Flow elements: a container OTHER than the original parent can take the
    // drop once the pointer leaves the parent or drifts across the stack
    // (full-width elements never leave their parent). Otherwise — and again
    // whenever the pointer comes back over the parent — it is a live reorder.
    var REPARENT_THRESHOLD = 50;
    var crossAxisDelta = state.axis === 'vertical'
      ? Math.abs(payload.iframeX - state.startX)
      : Math.abs(payload.iframeY - state.startY);
    var container = (!inParent || crossAxisDelta > REPARENT_THRESHOLD)
      ? this._findDeepestContainer(payload.iframeX, payload.iframeY)
      : null;

    if (container && container.element !== state.parentElement) {
      if (state.mode !== 'reparent') this._enterReparentMode();
      this._handleReparentMove(container, payload.iframeX, payload.iframeY);
      return;
    }
    if (state.mode === 'reparent') this._exitReparentMode();
    this._reorderMove(payload.iframeX, payload.iframeY);
  };

  FlowDragManager.prototype.handleEnd = function() {
    if (!this._state) return;

    var state = this._state;
    var reparent = this._reparentTarget;
    var dropPayload;

    if (state.mode === 'reparent' && reparent) {
      // Dropping back into the original parent is a plain reorder, not a reparent.
      var parentKey = keyOf(state.parentElement);
      var isDropBack = reparent.element === state.parentElement ||
                       (parentKey && reparent.containerKey === parentKey);
      dropPayload = {
        key: state.key,
        newParentKey: reparent.containerKey,
        insertIndex: reparent.insertIndex,
        cancelled: false,
        reparented: !isDropBack,
      };
    } else {
      // Commit the reorder NOW — the single real-element move of the whole
      // drag, into the slot the dimmed copy holds.
      if (state.placeholder && state.placeholder.parentNode === state.parentElement) {
        state.parentElement.insertBefore(state.element, state.placeholder);
      }
      this._clearPlaceholder();

      var self = this;
      var children = Array.prototype.slice.call(state.parentElement.children)
        .filter(function(child) { return !self._bridge.isEditorNode(child); });
      var insertIndex = Array.prototype.indexOf.call(children, state.element);
      if (insertIndex === -1) insertIndex = children.length;

      dropPayload = {
        key: state.key,
        newParentKey: keyOf(state.parentElement) || null,
        insertIndex: insertIndex,
        cancelled: false,
        reparented: false,
      };
    }

    this._teardown();
    this._bridge.sendToParent({ type: 'DRAG_ELEMENT_DROP', payload: dropPayload });
  };

  FlowDragManager.prototype.handleReenter = function() {
    if (!this._state) return;
    // The next move decides the mode (reorder over the parent, else reparent).
    if (this._state.ghost) {
      this._state.ghost.style.display = '';
    }
  };


  // ── IFrameBridge Constructor ───────────────────────────

  function IFrameBridge() {
    this.throttledHover = null;
    this.isDragging = false;
    this.mouseDownTarget = null;
    this.mouseDownPos = { x: 0, y: 0 };
    this.lastClickKey = null;
    this.lastClickTime = 0;
    this.lastHoveredKey = null;
    this.contextKey = null;
    this.mode = 'design';
    this.currentPath = window.location.pathname;
    this.styleElement = null;
    this.mutationObserverStarted = false;
    this.listenersActive = false;
    this.boundHandlers = null;
    this.previewListenersActive = false; // task-116: preview listeners attached?
    this.boundPreviewNavClick = null;    // bound once, so add/remove match
    this.boundPreviewKeyDown = null;
    this.pendingClassUpdates = [];  // Queue for class updates waiting for elements
    this.elementsReady = false;      // True after first successful ELEMENTS_SCANNED
    this.editingElement = null;      // Currently editing element (contentEditable)
    this.editBlurHandler = null;     // Handler for element blur to exit edit mode
    this.windowBlurHandler = null;   // Handler for window blur to exit edit mode
    this.originalTextContent = null; // Text before editing started
    this.originalTextByKey = {};     // Map of key -> original text for undo support
    // task-151: pre-override baselines the undo observers restore to. The iframe
    // is the only place that ever holds the element as the SOURCE renders it —
    // captured first-wins when an override is first applied, discarded with the
    // document on every reload. See handleRestoreOriginalClasses /
    // handleRestoreOriginalImageAttributes.
    this.originalClassesByKey = {};   // key -> class attribute before the first override
    this.originalImageAttrsByKey = {}; // key -> { attribute: value|null } before the first override
    // instant-edit P0b: class intents (parts/dom-updates.ts). A held key keeps its value until the file carries it.
    this._classHoldByKey = {};        // key -> hold
    this._classHoldByEl = new WeakMap();   // element -> hold
    this._classSeqHigh = {};          // key -> highest intent seq applied (survives a release)
    this._classSettledSeq = {};       // key -> highest seq the parent reported settled
    this._classSeqEpoch = null;
    this._classAliveAt = 0;
    this._morphSeq = 0;
    this._restoringClasses = false;    // suppresses the capture during a restore
    this._restoringImageAttrs = false;
    this._editGraceUntil = 0;       // Timestamp until which stray clicks are ignored
    this.savedSelectionRange = null; // Saved selection range for link wrapping when focus leaves iframe
    this.parentOrigin = null;        // Validated parent origin for secure postMessage
    this._styleElementCache = { key: null, element: null }; // Cache for SET_ELEMENT_STYLE lookups
    this._assetMap = {};  // assetId → iframe-origin blobUrl
    this._pendingAssetClasses = {};  // key → payload for deferred sq-asset: class resolution
    this._pendingAssetImages = {};   // key → payload for deferred sq-asset: image attr resolution
    this._blogCardInfo = [];         // Blog card metadata from last RENDER (for key re-assignment after HMR)
    this._blogCardKeysDirty = false; // Set true after RENDER; handleClick skips _ensureBlogCardKeys when false
    this._flowDrag = new FlowDragManager(this);
    this._preAppliedFileClasses = {}; // key → FILE class value, consumed by the FIRST scan (local pre-paint apply)
    this._handlers = {};
    this.registerHandlers();

    // Local mode: apply URL-fragment placement overrides BEFORE FIRST PAINT.
    // Must run here — the bridge <script> executes synchronously in <head>,
    // before any body element exists, which is the only moment early enough
    // to beat the parser to the placed elements (see preApplyLocalOverrides).
    this.preApplyLocalOverrides();
    // Seamless canvas: claim Vite's reloads and refresh in place (source-refresh.ts).
    this.installSourceRefresh();

    // Load Tailwind CDN for instant class updates
    loadTailwindCDN();

    window.addEventListener('message', this.handleMessage.bind(this));
    this.setupEventListeners();
    this.setupNavigationDetection();
    this.injectDesignModeStyles();
    this.armFixedRepaintOnResize();
    this.notifyReady();
  }

  // ── Prototype Methods (from parts) ─────────────────────

  

  IFrameBridge.prototype.injectDesignModeStyles = function() {
    if (this.styleElement) return;
    var self = this;

    var inject = function() {
      if (self.styleElement) return;
      self.styleElement = document.createElement('style');
      self.styleElement.id = 'sq-design-mode-styles';
      self.styleElement.textContent = 'body * { cursor: pointer !important; } body { cursor: default !important; }';
      (document.head || document.documentElement).appendChild(self.styleElement);
      self.updateDesignModeStyles();
      self.injectMediaPlaceholderStyles();
    };

    if (document.head) {
      inject();
    } else {
      var observer = new MutationObserver(function() {
        if (document.head) {
          observer.disconnect();
          inject();
        }
      });
      observer.observe(document.documentElement, { childList: true });
    }
  };

  // task-140/141: unresolved media-fill placeholder (mountain art). WC parity
  // with the local plugin's INJECT block in sq-source-plugin.js — keep the CSS
  // in sync with it. Separate style element: mode-independent, injected once.
  IFrameBridge.prototype.injectMediaPlaceholderStyles = function() {
    if (document.getElementById('sq-media-placeholder-styles')) return;
    var el = document.createElement('style');
    el.id = 'sq-media-placeholder-styles';
    el.textContent = '[data-sq-media="true"]{background:#e2e8f0 url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%201200%20800%22%20preserveAspectRatio%3D%22xMidYMid%20slice%22%3E%3Crect%20width%3D%221200%22%20height%3D%22800%22%20fill%3D%22%23e2e8f0%22%2F%3E%3Ccircle%20cx%3D%22880%22%20cy%3D%22235%22%20r%3D%2272%22%20fill%3D%22%2394a3b8%22%2F%3E%3Cpath%20d%3D%22M96%20640%20L478%20288%20L780%20640%20Z%22%20fill%3D%22%23cbd5e1%22%2F%3E%3Cpath%20d%3D%22M570%20640%20L834%20394%20L1104%20640%20Z%22%20fill%3D%22%2394a3b8%22%2F%3E%3C%2Fsvg%3E") center / cover no-repeat;min-height:4rem}';
    (document.head || document.documentElement).appendChild(el);
  };

  IFrameBridge.prototype.updateDesignModeStyles = function() {
    if (!this.styleElement) return;
    if (this.mode === 'design') {
      this.styleElement.textContent = 'body * { cursor: pointer !important; } body { cursor: default !important; }';
    } else {
      this.styleElement.textContent = '';
    }
  };


  
  var VH_TOKEN_RE = /(-?\d*\.?\d+)(d|s|l)?vh\b/gi;

  /** Override CSS for every same-origin vh declaration, resolved at `height`. */
  IFrameBridge.prototype._vhPinCssFor = function(height) {
    var out = [];
    var px = function(_m, n) { return (Math.round(parseFloat(n) / 100 * height * 100) / 100) + 'px'; };
    var emit = function(selector, style, wrappers) {
      var decls = [];
      for (var j = 0; j < style.length; j++) {
        var prop = style[j];
        var val = style.getPropertyValue(prop);
        VH_TOKEN_RE.lastIndex = 0;
        if (!VH_TOKEN_RE.test(val)) continue;
        decls.push(prop + ':' + val.replace(VH_TOKEN_RE, px) + ' !important');
      }
      if (!decls.length) return;
      var text = selector + '{' + decls.join(';') + '}';
      // Innermost wrapper first, so the chain reads outer → inner.
      for (var w = wrappers.length - 1; w >= 0; w--) text = wrappers[w] + '{' + text + '}';
      out.push(text);
    };
    // selector = the nearest enclosing style rule (CSS nesting puts an @media
    // INSIDE a style rule and its declarations in a selector-less child).
    var walk = function(rules, wrappers, selector) {
      for (var i = 0; i < rules.length; i++) {
        var r = rules[i];
        if (typeof r.selectorText === 'string') {
          // Nested '&' selectors are not re-emittable at top level; skip them.
          var sel = r.selectorText.indexOf('&') === -1 ? r.selectorText : null;
          if (sel && r.style) emit(sel, r.style, wrappers);
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, wrappers, sel);
        } else if (r.style) {
          // CSSNestedDeclarations under a style rule; a keyframe has no selector.
          if (selector) emit(selector, r.style, wrappers);
        } else if (r.cssRules) {
          var head = String(r.cssText || '');
          head = head.slice(0, head.indexOf('{')).trim();
          if (head) walk(r.cssRules, wrappers.concat(head), selector);
        } else if (r.styleSheet) {
          var imported; try { imported = r.styleSheet.cssRules; } catch (e) { continue; }
          if (imported) walk(imported, wrappers, null);
        }
      }
    };
    var sheets = document.styleSheets;
    for (var s = 0; s < sheets.length; s++) {
      var sheet = sheets[s];
      if (sheet.ownerNode && sheet.ownerNode.id === 'sq-vh-pin') continue;
      var rules;
      try { rules = sheet.cssRules; } catch (e) { continue; } // cross-origin: keeps native vh
      if (rules) walk(rules, [], null);
    }
    return out.join('\n');
  };

  /** Build (or rebuild) the pin for the current height; remove it outside design mode. */
  IFrameBridge.prototype._applyVhPin = function() {
    var el = document.getElementById('sq-vh-pin');
    if (this.mode !== 'design' || !this._vhPinHeight) { if (el) el.parentNode.removeChild(el); return; }
    if (!el) { el = document.createElement('style'); el.id = 'sq-vh-pin'; }
    var css = this._vhPinCssFor(this._vhPinHeight);
    if (el.textContent !== css) el.textContent = css;
    // Always last in <head>: equal specificity + !important, the later rule wins.
    var root = document.head || document.documentElement;
    if (root.lastElementChild !== el) root.appendChild(el);
    // The pin changes the page's geometry; the parent must re-fit on it.
    this.reportContentHeight();
  };

  IFrameBridge.prototype._scheduleVhPin = function() {
    var self = this;
    if (this._vhPinTimer) clearTimeout(this._vhPinTimer);
    // Debounced: Vite HMR swaps several style tags in one burst.
    this._vhPinTimer = setTimeout(function() { self._vhPinTimer = null; self._applyVhPin(); }, 100);
  };

  /** SET_MODE design with a design viewport height. Ignores a missing/invalid height. */
  IFrameBridge.prototype.pinDesignViewport = function(height) {
    if (typeof height !== 'number' || !isFinite(height) || height <= 0) return;
    this._vhPinHeight = height;
    this._applyVhPin();
    if (this._vhPinObserver) return;
    var self = this;
    var isSheetNode = function(n) {
      return n && n.nodeType === 1 && (n.tagName === 'STYLE' || n.tagName === 'LINK') && n.id !== 'sq-vh-pin';
    };
    this._vhPinObserver = new MutationObserver(function(records) {
      var touched = false;
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        for (var a = 0; a < rec.addedNodes.length; a++) {
          if (!isSheetNode(rec.addedNodes[a])) continue;
          touched = true;
          // A <link> has no rules until it loads.
          if (rec.addedNodes[a].tagName === 'LINK') rec.addedNodes[a].addEventListener('load', function() { self._scheduleVhPin(); });
        }
        for (var d = 0; d < rec.removedNodes.length; d++) if (isSheetNode(rec.removedNodes[d])) touched = true;
      }
      if (touched) self._scheduleVhPin();
    });
    this._vhPinObserver.observe(document.head || document.documentElement, { childList: true });
  };

  /** SET_MODE preview: real vh, native scroll. */
  IFrameBridge.prototype.unpinDesignViewport = function() {
    if (this._vhPinObserver) { this._vhPinObserver.disconnect(); this._vhPinObserver = null; }
    if (this._vhPinTimer) { clearTimeout(this._vhPinTimer); this._vhPinTimer = null; }
    var el = document.getElementById('sq-vh-pin');
    if (el) el.parentNode.removeChild(el);
  };


  
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
          // placement chain, most recent first. The `#N` suffix REUSES
          // instanceIndex — never a second counter: every chain is computed
          // over the same tree, so they partition it identically, and a private
          // counter would silently miss every `.map()`-repeated element.
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
            // `~p…` guard is what keeps this narrow: a key with no placement
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

          // Filled drawn slot: emit a separate `componentName` for the slot's
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

          // Layout slot: the filled `<div data-sq-slot>` or an empty chrome
          // `<slot>`. Stamp its name (''=default slot) so the editor can re-home
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
   * (`#sq-ov=`, built by previewSrc.ts), and this method — called from the
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
    // not consume a repeat index here, or the `#N` keys drift apart.
    if (SKIP_TAGS.indexOf(tag) !== -1) return;
    if (el.hasAttribute('data-slot-placeholder')) return;
    if (tag === 'svg' && (el.ownerSVGElement ||
        (el.closest && el.closest('[data-drawn]')))) return;
    var src = el.getAttribute('data-sq-source');
    if (!src) return;
    // Same composition + repeat counting as scanElements/resolveSourceKey:
    // placement segment first, then `#N` per composed key in document order
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
    return html.replace(/<(\w+)((?:\s+[^>]*)?)(\/?>)/g, function(match, tag, attrs, close) {
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
    // collision counter, so the positional `#N` suffix scopes per placement for
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

    // Wheel needs special options - capture must match for removal
    if (add) {
      document.addEventListener('wheel', handlers.wheel, { passive: false, capture: true });
    } else {
      document.removeEventListener('wheel', handlers.wheel, { capture: true });
    }
  };


  
  // Stable for this Document, including duplicate bridge initialization. A
  // parent request counter cannot distinguish initial load from an HMR load.
  var sqLocalDocumentId = document.__sqBridgeDocumentId ||
    (document.__sqBridgeDocumentId = Math.random().toString(36).slice(2) + Date.now().toString(36));
  IFrameBridge.prototype.sendToParent = function(message) {
    if (this._performance) this._performance.record('bridge-message', this._performanceOperation);
    try {
      // Auto-add timestamp if not present
      if (!message.timestamp) {
        message.timestamp = Date.now();
      }
      var target = isInIframe ? window.parent : window;
      // Use validated parent origin for security after handshake.
      // For initial messages (IFRAME_READY) before parentOrigin is set,
      // use '*' to allow cross-origin communication (editor at :4000, preview at :4321)
      var targetOrigin = this.parentOrigin || '*';
      target.postMessage(message, targetOrigin);
    } catch (error) {
      console.error('[IFrameBridge] Failed to send:', error);
    }
  };

  // Refresh the next-reload pre-paint payload without mutating iframe.src.
  // A message queued across a route/instance switch must never touch that new
  // document. Keep pathname AND query exact; route normalization is too broad.
  IFrameBridge.prototype.handleSyncLocalOverridesFragment = function(payload) {
    if (!window.__SQ_LOCAL_MODE__ || !payload || typeof payload.url !== 'string') return;
    try {
      var desired = new URL(payload.url);
      var current = new URL(window.location.href);
      if (desired.origin !== current.origin || desired.pathname !== current.pathname || desired.search !== current.search) return;
      if (desired.hash && desired.hash.indexOf('#sq-ov=') !== 0) return;
      if (desired.hash === current.hash) return;
      // Preserve ordinary user anchors when there is no override to remove.
      if (!desired.hash && current.hash && current.hash.indexOf('#sq-ov=') !== 0) return;
      var dropped = this.overrideKeysDropped(current.hash, desired.hash);
      window.history.replaceState(window.history.state, '', desired.href);
      // Seamless canvas: a discarded override (Reset, local undo) needs the
      // FILE value back on screen — re-render from source with the new fragment.
      if (dropped) this.requestSourceRefresh();
    } catch (e) { /* A malformed/stale URL cannot change the running document. */ }
  };

  IFrameBridge.prototype.overrideKeysDropped = function(fromHash, toHash) {
    var parse = function(h) { try { return h && h.indexOf('#sq-ov=') === 0 ? JSON.parse(decodeURIComponent(h.slice(7))) || {} : {}; } catch (e) { return {}; } };
    var from = parse(fromHash), to = parse(toHash);
    for (var k in from) if (!Object.prototype.hasOwnProperty.call(to, k)) return true;
    return false;
  };

  IFrameBridge.prototype.handleRequestLocalRoute = function(payload) {
    if (!window.__SQ_LOCAL_MODE__ || !payload || typeof payload.requestId !== 'string') return;
    this.sendToParent({ type: 'LOCAL_ROUTE_RESULT', payload: { requestId: payload.requestId, href: window.location.href, documentId: sqLocalDocumentId } });
  };

  IFrameBridge.prototype.handleRequestLocalScan = function(payload) {
    if (!window.__SQ_LOCAL_MODE__ || !payload || typeof payload.href !== 'string') return;
    try {
      var expected = new URL(payload.href);
      var current = new URL(window.location.href);
      if (expected.origin !== current.origin || expected.pathname !== current.pathname || expected.search !== current.search) return;
      this.scanElements();
    } catch (e) { /* Stale/malformed requests never vouch for another page. */ }
  };

  IFrameBridge.prototype.notifyReady = function() {
    var self = this;

    var sendReady = function() {
      self.sendToParent({
        type: 'IFRAME_READY',
        payload: {
          documentId: sqLocalDocumentId,
          href: window.location.href,
          documentHeight: document.documentElement.scrollHeight,
          documentWidth: document.documentElement.scrollWidth,
          classIntentV: 1   // understands UPDATE_CLASSES.intent and CLASS_INTENT_SETTLED
        }
      });

      // task-120: report which assets this iframe already holds so the parent
      // rehydrates by diff (fresh boot → empty list → parent sends everything).
      self.sendToParent({
        type: 'ASSETS_OWNED',
        payload: { ids: Object.keys(self._assetMap || {}) }
      });

      // task-146: NEVER gate the initial scan on requestAnimationFrame —
      // Chrome freezes rAF inside the local-mode cross-origin iframe (proven
      // live: the rAF callback never ran while plain timers did), which left
      // every freshly navigated page unscanned. A plain timer gives the same
      // post-load settle without the freeze.
      //
      // …and in local mode that settle must carry NO delay. The same frames
      // Chrome freezes rAF in are frames it also ALIGNS timers to 1 s in, so a
      // 100 ms settle is charged ~900 ms (measured live: 0 ms timer 0 ms late,
      // 100 ms 757 ms late, 500 ms 363 ms late — the last two firing at the
      // same instant, which no busy thread can produce). The whole local
      // override re-apply hangs off this scan, so the page frame sat painting
      // raw file bytes for that second on every surface switch.
      //
      // The last frame — the ~50 ms of file-bytes a parent-mediated re-apply
      // can never remove (it is bounded below by the frame's own first paint)
      // — is closed by preApplyLocalOverrides (scanning.ts): the override
      // rides the frame URL fragment and is applied in-frame before first
      // paint, with the FILE value stashed so the scan still feeds the ↻
      // badge the bytes it read before. See its ponytail comment for the
      // remaining ceiling.
      setTimeout(
        function() { self.scanElements(); },
        window.__SQ_LOCAL_MODE__ ? 0 : SCAN_INITIAL_DELAY_MS,
      );
    };

    if (document.readyState === 'complete') {
      sendReady();
    } else {
      window.addEventListener('load', sendReady, { once: true });
    }
  };

  IFrameBridge.prototype.handleMessage = function(event) {
    // Benchmark handshake is restricted to this parent and this exact Document.
    // No diagnostics records/listeners/observers exist before explicit enablement.
    if (event.data && event.data.type === 'SQ_PERFORMANCE') {
      var p = event.data.payload;
      if (event.source !== window.parent || !p || p.documentId !== sqLocalDocumentId) return;
      if (this.parentOrigin && event.origin !== this.parentOrigin) return;
      if (p.enabled === false) { delete this._performance; return; }
      if (p.enabled !== true || !Number.isSafeInteger(p.operation) || p.operation <= 0) return;
      this._performanceOperation = p.operation;
      if (!this._performance) {
        var samples = [];
        this._performance = {
          record: function(name, operation, amount) {
            samples.push({ name: name, operation: operation || 0, at: performance.timeOrigin + performance.now(), amount: amount === undefined ? 1 : amount });
            if (samples.length > 2000) samples.splice(0, samples.length - 2000);
          },
          read: function() { return samples.slice(); },
          clear: function() { samples.length = 0; }
        };
      }
      return;
    }
    // Security: Validate origin for messages from parent
    // In iframe mode, only accept messages from same origin or parent
    if (isInIframe) {
      // Allow messages from parent window (which may have different port in dev)
      // In production, you should validate against a specific origin
      var allowedOrigins = [window.location.origin];
      // Also allow parent origin if different (e.g., different port)
      try {
        if (window.parent && window.parent.location && window.parent.location.origin) {
          allowedOrigins.push(window.parent.location.origin);
        }
      } catch (e) {
        // Cross-origin - parent location not accessible, which is expected
      }
      // For development, allow localhost origins with strict validation
      // Parse origin to ensure it's actually localhost, not a subdomain like evil.localhost.com
      var originUrl;
      try {
        originUrl = new URL(event.origin);
      } catch (e) {
        return; // Invalid URL, reject
      }
      var hostname = originUrl.hostname;
      var isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

      // Also allow messages from the parent window regardless of origin,
      // since the editor and the preview iframe are always on different
      // origins
      var isFromParent = event.source === window.parent;

      if (isLocalhost) {
        // Development mode - allow localhost
      } else if (isFromParent) {
        // Allow messages from parent window (editor)
      } else if (allowedOrigins.indexOf(event.origin) === -1) {
        // Unknown origin in production - reject
        return;
      }
      // Store validated parent origin for secure outgoing messages
      if (!this.parentOrigin) {
        this.parentOrigin = event.origin;
      }
    }

    var message = event.data;
    if (!message || !message.type) return;

    if (this._performance) this._performance.record('bridge-message', this._performanceOperation);
    var handler = this._handlers[message.type];
    if (handler) {
      handler(message.payload);
    }
  };

  IFrameBridge.prototype.registerHandlers = function() {
    var self = this;

    this._handlers['REQUEST_LOCAL_ROUTE'] = function(p) { self.handleRequestLocalRoute(p); };
    this._handlers['REQUEST_LOCAL_SCAN'] = function(p) { self.handleRequestLocalScan(p); };
    this._handlers['SYNC_LOCAL_OVERRIDES_FRAGMENT'] = function(p) { self.handleSyncLocalOverridesFragment(p); };
    this._handlers['REFRESH_FROM_SOURCE'] = function() { self.handleRefreshFromSource(); };

    // Class & style updates
    this._handlers['UPDATE_CLASSES'] = function(p) { self.handleUpdateClasses(p); };
    this._handlers['SYNC_CLASSES_TO_IFRAME'] = function(p) { self.handleUpdateClasses(p); };
    this._handlers['UPDATE_TEXT'] = function(p) { self.handleUpdateText(p); };
    this._handlers['UPDATE_INSTANCE_OVERRIDE'] = function(p) { self.handleUpdateInstanceOverride(p); };
    this._handlers['UPDATE_LINK_ATTRIBUTE'] = function(p) { self.handleUpdateLinkAttribute(p); };
    // Inline-link markup override re-apply (scan re-apply after reload)
    this._handlers['UPDATE_SOURCE_MARKUP'] = function(p) { self.handleUpdateSourceMarkup(p); };
    this._handlers['UPDATE_IMAGE_ATTRIBUTE'] = function(p) { self.handleUpdateImageAttribute(p); };
    // task-206: component-viewer Media demo (display-only DOM mutation)
    this._handlers['SET_MEDIA_DEMO'] = function(p) { self.handleSetMediaDemo(p); };

    // Mode & context
    this._handlers['SET_CONTEXT'] = function(p) { self.contextKey = (p && p.contextKey) || null; };
    this._handlers['SET_MODE'] = function(p) { self.handleSetMode(p); };

    // Page switch without navigation (task-120)
    this._handlers['SET_PAGE'] = function(p) { self.handleSetPage(p); };

    // Same-origin fetch of a rendered page on the parent's behalf.

    // Element interaction
    this._handlers['REQUEST_ELEMENT_RECT'] = function(p) { self.handleRequestElementRect(p); };
    this._handlers['SIMULATE_CLICK'] = function(p) { self.handleSimulateClick(p); };
    this._handlers['SIMULATE_HOVER'] = function(p) { self.handleSimulateHover(p); };
    this._handlers['PICK_ELEMENT_AT_POINT'] = function(p) { self.handlePickElementAtPoint(p); };
    this._handlers['SET_ELEMENT_STYLE'] = function(p) { self.handleSetElementStyle(p); };


    // Asset transfer (blob from editor → iframe-origin blob URL)
    this._handlers['TRANSFER_ASSET'] = function(p) { self.handleTransferAsset(p); };

    // HMR writes
    this._handlers['SQ_WRITE_CLASSES'] = function(p) { self.handleWriteClasses(p); };
    this._handlers['SQ_WRITE_TEXT'] = function(p) { self.handleWriteText(p); };
    this._handlers['SQ_WRITE_IMAGE'] = function(p) { self.handleWriteImage(p); };
    this._handlers['SQ_WRITE_TAG_SWAP'] = function(p) { self.handleWriteTagSwap(p); };
    // task-133: structural write relays
    this._handlers['SQ_WRITE_INSERT'] = function(p) { self.handleWriteInsert(p); };
    this._handlers['SQ_WRITE_APPEND_PAGE'] = function(p) { self.handleWriteAppendPage(p); };
    this._handlers['SQ_WRITE_REMOVE'] = function(p) { self.handleWriteRemove(p); };
    this._handlers['SQ_WRITE_MOVE'] = function(p) { self.handleWriteMove(p); };
    this._handlers['SQ_WRITE_IMPORT'] = function(p) { self.handleWriteImport(p); };
    this._handlers['SQ_WRITE_RESTORE'] = function(p) { self.handleWriteRestore(p); };
    this._handlers['SQ_WRITE_RESTORE_REGION'] = function(p) { self.handleWriteRestoreRegion(p); };

    // Reorder
    this._handlers['REORDER_ELEMENTS'] = function(p) { self.handleReorderElements(p); };
    this._handlers['REPARENT_ELEMENT_DOM'] = function(p) {
      try {
        self.handleReparentElementDom(p);
      } catch (err) {
        console.error('[IFrameBridge] REPARENT_ELEMENT_DOM error:', err);
      }
    };

    // Grid geometry
    this._handlers['REQUEST_GRID_GEOMETRY'] = function(p) { self.handleRequestGridGeometry(p); };

    // Text editing
    this._handlers['ENTER_EDIT_MODE'] = function(p) { self.handleEnterEditMode(p); };
    this._handlers['RESTORE_ORIGINAL_TEXT'] = function(p) { self.handleRestoreOriginalText(p); };

    // task-151: undo REMOVED an overlay entry — hand back the pre-override
    // baseline this bridge captured, in place (no reload, no scroll loss).
    this._handlers['RESTORE_ORIGINAL_CLASSES'] = function(p) { self.handleRestoreOriginalClasses(p); };
    // instant-edit P0b: the rows behind these held class values are materialized — verify against the file, release.
    this._handlers['CLASS_INTENT_SETTLED'] = function(p) { self.handleClassIntentSettled(p); };
    this._handlers['RESTORE_ORIGINAL_IMAGE_ATTRIBUTES'] = function(p) { self.handleRestoreOriginalImageAttributes(p); };

    // Link editing
    this._handlers['SET_LINK_INTERACTING'] = function(p) {
      self.linkInteracting = p.interacting;
      if (p.interacting && self.savedSelectionRange) {
        self.applySelectionHighlight();
      } else {
        self.removeSelectionHighlight();
      }
    };
    this._handlers['WRAP_SELECTION_IN_LINK'] = function(p) { self.handleWrapSelectionInLink(p); };
    this._handlers['UNWRAP_LINK'] = function(p) { self.handleUnwrapLink(p); };

    // AI context highlight
    this._handlers['HIGHLIGHT_ELEMENT'] = function(p) { self.handleHighlightElement(p); };
    this._handlers['CLEAR_HIGHLIGHT'] = function() { self.clearHighlightElement(); };

    // Drawn elements
    this._handlers['INSERT_DRAWN_ELEMENT'] = function(p) { self.handleInsertDrawnElement(p); };
    this._handlers['REMOVE_DRAWN_ELEMENT'] = function(p) { self.handleRemoveDrawnElement(p); };
    this._handlers['REMOVE_ELEMENT_FROM_DOM'] = function(p) { self.handleRemoveElementFromDOM(p); };
    this._handlers['CLONE_ELEMENT_IN_DOM'] = function(p) { self.handleCloneElementInDom(p); };

    // Flow drag (delegated to FlowDragManager)
    this._handlers['DRAG_ELEMENT_START'] = function(p) { self._flowDrag.handleStart(p); };
    this._handlers['DRAG_ELEMENT_MOVE'] = function(p) { self._flowDrag.handleMove(p); };
    this._handlers['DRAG_ELEMENT_END'] = function() { self._flowDrag.handleEnd(); };
    this._handlers['DRAG_ELEMENT_REENTER_IFRAME'] = function(p) { self._flowDrag.handleReenter(p); };

    // Screenshot capture
    this._handlers['CAPTURE_SCREENSHOT'] = function(p) { self.handleCaptureScreenshot(p); };

    // Preview refresh (re-capture after DOM rebuild)
    this._handlers['REQUEST_PREVIEW_REFRESH'] = function(p) { self.handleRequestPreviewRefresh(p); };

    // Unified render (replaces SET_PAGE_COMPONENTS + REORDER_ELEMENTS + INSERT_DRAWN_ELEMENT sequence)

    // Collection rendering

    // Update slot placeholder text (after collection connection)
    this._handlers['UPDATE_SLOT_PLACEHOLDER'] = function(p) { self.handleUpdateSlotPlaceholder(p); };

    // Variables CSS injection
    this._handlers['SET_VARIABLES_CSS'] = function(p) { self.handleSetVariablesCSS(p); };

    // Theme-mode preview (data-mode attribute on <html>)
    this._handlers['SET_THEME_MODE'] = function(p) { self.handleSetThemeMode(p); };

    // Project fonts CSS injection
    this._handlers['SET_FONTS_CSS'] = function(p) { self.handleSetFontsCss(p); };

    // AI activity highlights
    this._handlers['SET_AI_ACTIVE_HIGHLIGHTS'] = function(p) { self.handleSetAIActiveHighlights(p); };

    // AI element HTML fetch
    this._handlers['GET_ELEMENT_SECTION_HTML'] = function(p) { self.handleGetElementSectionHtml(p); };

    // Element-clipboard copy HTML fetch
    this._handlers['GET_ELEMENT_COPY_HTML'] = function(p) { self.handleGetElementCopyHtml(p); };

    // AI layout verification (verify_layout tool)
    this._handlers['VERIFY_LAYOUT'] = function(p) { self.handleVerifyLayout(p); };

    // AI live stream preview (throwaway DOM while tool args stream)
    this._handlers['STREAM_PREVIEW'] = function(p) { self.handleStreamPreview(p); };
    this._handlers['STREAM_PREVIEW_END'] = function(p) { self.handleStreamPreviewEnd(p); };

    // Chromium fixed-layer raster bug workaround (see handleRepaintFixed)
    this._handlers['REPAINT_FIXED'] = function() { self.handleRepaintFixed(); };
  };


  
  /**
   * Convert image URLs (same-origin and cross-origin) to data URIs.
   * Cross-origin images are fetched via server-side proxy.
   */
  IFrameBridge.prototype._inlineAllImages = function() {
    var origin = window.location.origin;

    function isAlreadyInlined(src) {
      return !src || src.startsWith('data:') || src.startsWith('blob:');
    }

    function isCrossOrigin(src) {
      try { return new URL(src, origin).origin !== origin; } catch(e) { return false; }
    }

    function fetchAsDataUrl(url) {
      var fetchUrl = isCrossOrigin(url)
        ? '/sq-image-proxy?url=' + encodeURIComponent(url)
        : url;
      return fetch(fetchUrl)
        .then(function(r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(function(blob) {
          return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function() { resolve(reader.result); };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        });
    }

    var promises = [];

    var imgs = document.querySelectorAll('img[src]');
    for (var i = 0; i < imgs.length; i++) {
      (function(img) {
        if (isAlreadyInlined(img.src)) return;
        promises.push(
          fetchAsDataUrl(img.src)
            .then(function(dataUrl) { img.src = dataUrl; })
            .catch(function() { /* skip */ })
        );
      })(imgs[i]);
    }

    // CSS background-image URLs
    var els = document.querySelectorAll('*');
    for (var j = 0; j < els.length; j++) {
      (function(el) {
        var bg = getComputedStyle(el).backgroundImage;
        if (!bg || bg === 'none') return;
        var match = bg.match(/url\(["']?((?:https?:\/\/|\/)[^"')]+)["']?\)/);
        if (!match || isAlreadyInlined(match[1])) return;
        promises.push(
          fetchAsDataUrl(match[1])
            .then(function(dataUrl) { el.style.backgroundImage = 'url(' + dataUrl + ')'; })
            .catch(function() { /* skip */ })
        );
      })(els[j]);
    }

    return Promise.all(promises);
  };

  /**
   * Capture a screenshot using SVG foreignObject.
   * Deep-clones the DOM with computed styles inlined on every element,
   * wraps in SVG foreignObject, loads as data URI, draws to canvas.
   */
  IFrameBridge.prototype.handleCaptureScreenshot = function(payload) {
    var self = this;
    var outputWidth = (payload && payload.width) || 800;

    var fontsReady = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

    fontsReady.then(function() {
      return self._inlineAllImages();
    }).then(function() {
      var vpWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
      var vpHeight = window.innerHeight || document.documentElement.clientHeight || 720;
      var clipHeight = Math.min(Math.round(vpWidth * 9 / 16), vpHeight);

      function cloneWithStyles(node) {
        if (node.nodeType === 3) return document.createTextNode(node.textContent);
        if (node.nodeType !== 1) return null;

        var tag = node.tagName.toLowerCase();
        if (tag === 'script' || tag === 'noscript' || tag === 'link') return null;

        var clone = node.cloneNode(false);

        var cs = window.getComputedStyle(node);
        if (cs.cssText) {
          clone.style.cssText = cs.cssText;
        } else {
          for (var i = 0; i < cs.length; i++) {
            var prop = cs[i];
            clone.style.setProperty(prop, cs.getPropertyValue(prop), cs.getPropertyPriority(prop));
          }
        }

        // Strip external URLs that could taint the canvas
        var urlProps = ['background-image', 'list-style-image', 'border-image-source', 'mask-image', '-webkit-mask-image'];
        for (var u = 0; u < urlProps.length; u++) {
          var val = clone.style.getPropertyValue(urlProps[u]);
          if (val && val.indexOf('url(') !== -1 && val.indexOf('data:') === -1) {
            clone.style.removeProperty(urlProps[u]);
          }
        }

        for (var c = 0; c < node.childNodes.length; c++) {
          var ch = cloneWithStyles(node.childNodes[c]);
          if (ch) clone.appendChild(ch);
        }
        return clone;
      }

      var clone = cloneWithStyles(document.body);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');

      var xhtml = new XMLSerializer().serializeToString(clone);

      var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + vpWidth + '" height="' + clipHeight + '">' +
        '<foreignObject x="0" y="0" width="' + vpWidth + '" height="' + clipHeight + '">' +
        xhtml +
        '</foreignObject></svg>';

      // Data URI (not blob URL) -- blob URLs taint canvas in Chrome
      var dataUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

      return new Promise(function(resolve, reject) {
        var img = new Image();
        img.onload = function() {
          try {
            var scale = outputWidth / vpWidth;
            var canvasH = Math.round(clipHeight * scale);
            var canvas = document.createElement('canvas');
            canvas.width = outputWidth;
            canvas.height = canvasH;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, outputWidth, canvasH);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } catch(e) {
            reject(e);
          }
        };
        img.onerror = function() {
          reject(new Error('SVG foreignObject image failed to load'));
        };
        img.src = dataUri;
      });
    }).then(function(dataUrl) {
      self.sendToParent({ type: 'SCREENSHOT_CAPTURED', payload: { dataUrl: dataUrl } });
    }).catch(function(err) {
      console.error('[Bridge] Screenshot failed:', err);
      self.sendToParent({ type: 'SCREENSHOT_FAILED', payload: { error: String(err) } });
    });
  };

  IFrameBridge.prototype.handleSimulateClick = function(payload) {
    if (!payload) return;
    var x = payload.x;
    var y = payload.y;
    var isDoubleClick = payload.isDoubleClick || false;
    var ctrlKey = payload.ctrlKey || false;
    var metaKey = payload.metaKey || false;
    var shiftKey = payload.shiftKey || false;

    // Find element at coordinates
    var element = document.elementFromPoint(x, y);

    // Every canvas click arrives here (ViewportFrame's passthrough overlay
    // swallows the real one and re-emits SIMULATE_CLICK). body/html are NOT
    // filtered: handleClick → findEditableElement resolves them to the layout
    // root (or null, which exits edit mode there) — one resolver, not two.
    if (!element) {
      this.exitEditModeCleanup();
      return;
    }

    // Create synthetic event object for handleClick
    var syntheticEvent = {
      target: element,
      clientX: x,
      clientY: y,
      metaKey: metaKey,
      ctrlKey: ctrlKey,
      shiftKey: shiftKey,
      detail: isDoubleClick ? 2 : 1,
      preventDefault: function() {},
      stopPropagation: function() {}
    };

    this.handleClick(syntheticEvent);
  };

  IFrameBridge.prototype._clearHover = function() {
    if (!this.lastHoveredKey) return;
    this.lastHoveredKey = null;
    this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {}, timestamp: Date.now() });
  };

  IFrameBridge.prototype.handleSimulateHover = function(payload) {
    if (!payload) {
      this._clearHover();
      return;
    }

    var element = document.elementFromPoint(payload.x, payload.y);
    // deep: Option-hover measuring targets the element right under the cursor (like ⌘-click)
    var target = element ? this.findEditableElement(element, true, !!payload.deep) : null;
    if (!target) {
      this._clearHover();
      return;
    }

    var key = this.getElementKey(target);
    if (!key || key === this.lastHoveredKey) return;
    this.lastHoveredKey = key;
    var rect = target.getBoundingClientRect();
    this.sendToParent({
      type: 'ELEMENT_HOVER',
      payload: {
        key: key,
        tagName: target.tagName.toLowerCase(),
        rect: this.buildRect(rect)
      },
      timestamp: Date.now()
    });
  };


  
  /**
   * A page's Layout has no single DOM box. Its selection identity is the bare
   * layout-element id (e.g. "layoutchrome-p1") and its visual extent is the
   * UNION of its top-level chrome tags ([data-sq-chrome] keyed
   * "<layoutElementId>:<selector>"). Chrome nested inside other chrome (e.g. the
   * slot div inside <main>) is skipped so the union is just the outer frame.
   * Returns a rect ({top,left,width,height}) or null when the key isn't a
   * layout-element id / no chrome is present.
   */
  IFrameBridge.prototype.layoutUnionRect = function(key) {
    if (!key || key.indexOf(':') !== -1 || key.indexOf('layoutchrome-') !== 0) return null;
    var all = document.querySelectorAll('[data-sq-chrome][data-key^="' + key + ':"]');
    var top = Infinity, left = Infinity, right = -Infinity, bottom = -Infinity;
    var anyMatch = false;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      // Top-level chrome only: skip chrome whose ancestor is also chrome.
      if (el.parentElement && el.parentElement.closest('[data-sq-chrome]')) continue;
      var r = el.getBoundingClientRect();
      anyMatch = true;
      if (r.left < left) left = r.left;
      if (r.top < top) top = r.top;
      if (r.right > right) right = r.right;
      if (r.bottom > bottom) bottom = r.bottom;
    }
    if (!anyMatch) return null;
    return { top: top, left: left, width: right - left, height: bottom - top };
  };

  IFrameBridge.prototype.handleRequestElementRect = function(payload) {
    if (!payload || !payload.key) return;
    var element = this.findElementByKey(payload.key);
    var rect = element ? this.rectOf(element) : this.layoutUnionRect(payload.key);
    if (!rect) return;

    this.sendToParent({
      type: 'ELEMENT_RECT_RESPONSE',
      payload: {
        key: payload.key,
        rect: rect
      }
    });
  };

  /**
   * Report element rect update to parent after layout changes.
   * Schedules via requestAnimationFrame for accurate measurements.
   */
  IFrameBridge.prototype.reportRectUpdate = function(key, element) {
    var self = this;
    requestAnimationFrame(function() {
      self.sendToParent({
        type: 'RECT_UPDATED',
        payload: { key: key, rect: self.rectOf(element) }
      });
      self.reportContentHeight();
    });
  };

  IFrameBridge.prototype.handleSetElementStyle = function(payload) {
    if (!payload || !payload.key || !payload.styles) return;

    var cache = this._styleElementCache;
    var element;
    if (cache.key === payload.key && cache.element && cache.element.isConnected) {
      element = cache.element;
    } else {
      element = this.findElementByKey(payload.key);
      if (!element) return;
      cache.key = payload.key;
      cache.element = element;
    }

    var styles = payload.styles;
    for (var prop in styles) {
      if (styles.hasOwnProperty(prop)) {
        element.style[prop] = styles[prop];
      }
    }

    // During live resize the overlay tracks size directly -- skip the expensive
    // reportRectUpdate + reportContentHeight round-trip. The final commit
    // (without isLiveResize) still reports so the parent gets the settled rect.
    if (!payload.isLiveResize) {
      this.reportRectUpdate(payload.key, element);
    }
  };

  IFrameBridge.prototype.handleRequestGridGeometry = function(payload) {
    if (!payload || !payload.key) return;
    var element = this.findElementByKey(payload.key);
    if (!element) return;

    // Nearest grid ANCESTOR first — every host consumer looks the element up in
    // the response cells (resize cellInfo, drag isGridDrop, DesignBar Start+Span
    // fallback), so the grid the element PARTICIPATES IN wins. The element's own
    // grid is only a fallback for standalone grid containers; checking the
    // element first broke every lookup for grid-in-grid children (task-090).
    var gridContainer = null;
    var parent = element.parentElement;
    while (parent) {
      var pStyle = window.getComputedStyle(parent);
      if (pStyle.display === 'grid' || pStyle.display === 'inline-grid') { gridContainer = parent; break; }
      parent = parent.parentElement;
    }
    if (!gridContainer) {
      var elStyle = window.getComputedStyle(element);
      if (elStyle.display === 'grid' || elStyle.display === 'inline-grid') gridContainer = element;
    }
    if (!gridContainer) return;

    var style = window.getComputedStyle(gridContainer);
    var borderRect = gridContainer.getBoundingClientRect();
    // Use content box (after padding) since grid tracks are laid out inside padding
    var padTop = parseFloat(style.paddingTop) || 0;
    var padLeft = parseFloat(style.paddingLeft) || 0;
    var padRight = parseFloat(style.paddingRight) || 0;
    var padBottom = parseFloat(style.paddingBottom) || 0;
    var containerRect = {
      top: borderRect.top + padTop,
      left: borderRect.left + padLeft,
      width: borderRect.width - padLeft - padRight,
      height: borderRect.height - padTop - padBottom
    };

    // Parse resolved track sizes (e.g., "200px 100px 200px" → [200, 100, 200])
    var columns = style.gridTemplateColumns.split(/\s+/).map(function(s) { return parseFloat(s); }).filter(function(n) { return !isNaN(n); });
    var rows = style.gridTemplateRows.split(/\s+/).map(function(s) { return parseFloat(s); }).filter(function(n) { return !isNaN(n); });
    var columnGap = parseFloat(style.columnGap) || 0;
    var rowGap = parseFloat(style.rowGap) || 0;

    var explicitRowCount = rows.length;

    // An auto-placed child has no numeric start: its track is the one whose
    // START is nearest to its edge. A range test ("inside this track, +1px")
    // names the PREVIOUS track when the gap is under a pixel (the next track
    // starts where this one ends) and no track at all when the computed sizes
    // serialize rounded up — cards swapped with the wrong neighbour and two
    // landed in one cell (live 2026-11-12, a gapless ul). Twin of
    // nearestTrackStart in utils/gridGeometry.ts (bridge parts cannot import).
    var nearestTrack = function(position, tracks, gap) {
      var best = 0, bestDistance = Infinity, offset = 0;
      for (var t = 0; t < tracks.length; t++) {
        var distance = Math.abs(position - offset);
        if (distance < bestDistance) { bestDistance = distance; best = t; }
        offset += tracks[t] + gap;
      }
      return best;
    };

    // Build cells map from children
    var cells = [];
    var children = gridContainer.children;
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      var key = child.getAttribute('data-key') || child.getAttribute('data-sq-source');
      if (!key) continue;

      var childStyle = window.getComputedStyle(child);
      var colStartStr = childStyle.gridColumnStart;
      var colEndStr = childStyle.gridColumnEnd;
      var rowStartStr = childStyle.gridRowStart;
      var rowEndStr = childStyle.gridRowEnd;

      var colStart = parseInt(colStartStr, 10) || 0;
      var rowStart = parseInt(rowStartStr, 10) || 0;
      var colEnd = parseInt(colEndStr, 10) || 0;
      var rowEnd = parseInt(rowEndStr, 10) || 0;

      // Parse "span N" values from computed styles (e.g., col-span-6 → "span 6")
      var colSpanMatch = colEndStr.match(/span\s+(\d+)/) || colStartStr.match(/span\s+(\d+)/);
      var rowSpanMatch = rowEndStr.match(/span\s+(\d+)/) || rowStartStr.match(/span\s+(\d+)/);

      // Fallback: use bounding rect to determine position when CSS values are auto/0
      // Check col and row independently — one may be explicit while the other is auto
      var childRect = child.getBoundingClientRect();
      var relLeft = childRect.left - containerRect.left;
      var relTop = childRect.top - containerRect.top;

      if (isNaN(colStart) || colStart === 0) colStart = nearestTrack(relLeft, columns, columnGap) + 1;
      if (isNaN(rowStart) || rowStart === 0) rowStart = nearestTrack(relTop, rows, rowGap) + 1;

      // Determine span: prefer explicit "span N" from computed style, then end-start, then fallback to 1
      var colSpan = colSpanMatch ? parseInt(colSpanMatch[1], 10) : ((colEnd > colStart) ? colEnd - colStart : 1);
      var rowSpan = rowSpanMatch ? parseInt(rowSpanMatch[1], 10) : ((rowEnd > rowStart) ? rowEnd - rowStart : 1);

      cells.push({
        col: colStart - 1,  // 0-based
        row: rowStart - 1,  // 0-based
        colSpan: colSpan,
        rowSpan: rowSpan,
        key: key
      });
    }

    // ── Detect & measure implicit rows beyond the explicit grid ──
    // gridTemplateRows only reports explicit rows; implicit rows from
    // auto-placement or content overflow are missing.
    var maxRowFromCells = rows.length;
    for (var mri = 0; mri < cells.length; mri++) {
      var cellRowEnd = cells[mri].row + cells[mri].rowSpan;
      if (cellRowEnd > maxRowFromCells) maxRowFromCells = cellRowEnd;
    }
    var explicitRowsTotal = 0;
    for (var eri = 0; eri < rows.length; eri++) explicitRowsTotal += rows[eri];
    if (rows.length > 1) explicitRowsTotal += (rows.length - 1) * rowGap;

    if (maxRowFromCells > rows.length || containerRect.height > explicitRowsTotal + rowGap + 1) {
      // task-120 (4.4): the probe appends a node and forces a layout per
      // implicit row — cache the answer per container until the container's
      // measurable state changes (sig) or the DOM mutates / RENDER repaints
      // (cache cleared in handleRender + the mutation observer).
      var probeSig = containerRect.height + ':' + rows.join(',') + ':' + maxRowFromCells + ':' + rowGap;
      var probeHit = this._gridProbeCache && this._gridProbeCache.get(gridContainer);
      if (probeHit && probeHit.sig === probeSig) {
        rows = rows.concat(probeHit.extraRows);
      } else {
        var probe = document.createElement('div');
        probe.style.cssText = 'visibility:hidden;pointer-events:none;padding:0;margin:0;border:none;min-height:0;';
        probe.style.gridColumn = '1';
        gridContainer.appendChild(probe);

        var accounted = explicitRowsTotal;
        var pr = rows.length;
        var rowLimit = Math.max(maxRowFromCells, pr + 1);
        var extraRows = [];

        while ((pr < rowLimit || accounted < containerRect.height - 2) && pr < 50) {
          probe.style.gridRow = (pr + 1) + ' / ' + (pr + 2);
          var probeH = probe.getBoundingClientRect().height;
          if (probeH <= 0) break;
          rows.push(probeH);
          extraRows.push(probeH);
          accounted += rowGap + probeH;
          pr++;
        }

        gridContainer.removeChild(probe);
        if (!this._gridProbeCache) this._gridProbeCache = new WeakMap();
        this._gridProbeCache.set(gridContainer, { sig: probeSig, extraRows: extraRows });
      }
    }

    this.sendToParent({
      type: 'GRID_GEOMETRY_RESPONSE',
      payload: {
        containerRect: this.buildRect(containerRect),
        columns: columns,
        rows: rows,
        columnGap: columnGap,
        rowGap: rowGap,
        cells: cells,
        explicitRowCount: explicitRowCount
      }
    });
  };

  IFrameBridge.prototype.reportContentHeight = function() {
    var self = this;
    if (this._pendingHeightFrame != null) return;
    // task-146's law, and this is the second time it has bitten: Chrome FREEZES
    // requestAnimationFrame inside the local-mode cross-origin iframe, so an
    // rAF-gated report simply never fires there. Proven again 2026-08-09 by
    // instrumenting the parent: the post frame emitted IFRAME_READY,
    // ASSETS_OWNED and ELEMENTS_SCANNED but never CONTENT_HEIGHT, leaving the
    // post body pinned at its minimum height. No local-mode consumer existed
    // before the content editor, which is why it went unnoticed.
    //
    // A 0 ms timer coalesces exactly as well and is not frozen.
    if (typeof window !== 'undefined' && window.__SQ_LOCAL_MODE__) {
      this._pendingHeightFrame = setTimeout(function() {
        self._pendingHeightFrame = null;
        self._reportContentHeightNow();
      }, 0);
      return;
    }
    this._pendingHeightFrame = requestAnimationFrame(function() {
      self._pendingHeightFrame = null;
      self._reportContentHeightNow();
    });
  };

  IFrameBridge.prototype.startResizeObserver = function() {
    var self = this;
    var reportDebounce = null;

    // No scrollHeight gate here: scrollHeight is pinned to the (parent-sized)
    // viewport, so a gate on it can grow but NEVER shrink — direct-DOM
    // removals left a permanent white gap. reportContentHeight() is rAF
    // coalesced and measures the true content bottom, so delegating
    // unconditionally is both correct and cheap.
    var reportIfChanged = function() {
      self.reportContentHeight();
      // A body-size change means SOME element reflowed (image finished
      // loading, media grew, content inserted) — push fresh rects so the
      // parent's selection overlay follows the element instead of keeping
      // the box measured at scan time (stale-selection bug, 2026-08-11).
      self.sendRectsUpdate();
    };

    // Use ResizeObserver if available. LEADING-edge + trailing: the first
    // resize in a burst reports immediately (the selection overlay must
    // travel with the element, not ~100ms behind it); the trailing timer
    // catches the burst's final geometry. No rAF here — Chrome freezes rAF
    // in unfocused cross-origin iframes (task-146).
    if (typeof ResizeObserver !== 'undefined') {
      var lastLeadingReport = 0;
      var dirtySinceLeading = false;
      var resizeObserver = new ResizeObserver(function() {
        var now = Date.now();
        if (now - lastLeadingReport > 100) {
          lastLeadingReport = now;
          dirtySinceLeading = false;
          reportIfChanged();
          return; // a lone resize is fully reported — no duplicate trailing pass
        }
        dirtySinceLeading = true;
        if (reportDebounce) clearTimeout(reportDebounce);
        reportDebounce = setTimeout(function() {
          if (dirtySinceLeading) { dirtySinceLeading = false; reportIfChanged(); }
        }, 100);
      });

      resizeObserver.observe(document.body);
      if (document.documentElement) {
        resizeObserver.observe(document.documentElement);
      }
    } else {
      // Fallback: check periodically
      setInterval(reportIfChanged, 1000);
    }

    // task-132 local mode: the page scrolls INSIDE the fixed-viewport iframe,
    // so viewport-relative rects go stale on every scroll — push fresh ones
    // (RECTS_UPDATED also re-syncs the selection overlay parent-side).
    if (window.__SQ_LOCAL_MODE__) {
      var scrollDebounce = null;
      window.addEventListener('scroll', function() {
        if (scrollDebounce) clearTimeout(scrollDebounce);
        scrollDebounce = setTimeout(function() { self.sendRectsUpdate(); }, 80);
      }, { passive: true });
    }
  };

  /** Coalesce rect pushes from a burst of content mutations into one (next task;
   *  no rAF — frozen in unfocused cross-origin frames, task-146). */
  IFrameBridge.prototype.scheduleRectsUpdate = function() {
    var self = this;
    if (this._rectsTimer) return;
    this._rectsTimer = setTimeout(function() {
      self._rectsTimer = null;
      // A torn-down document (a test file's jsdom ending under this timer) has nothing to measure.
      if (typeof document !== 'undefined') self.sendRectsUpdate();
    }, 0);
  };

  /** When the layout changes (breakpoint switch, content resize, image load),
   *  send fresh element rects. [data-key] is complete here: the scan stamps
   *  it onto every element it reports, source-keyed ones included. */
  IFrameBridge.prototype.sendRectsUpdate = function() {
    var self = this;
    var elements = document.querySelectorAll('[data-key]');
    var rects = [];

    elements.forEach(function(el) {
      var key = el.getAttribute('data-key');
      if (key) {
        rects.push({
          key: key,
          rect: self.rectOf(el)
        });
      }
    });

    if (rects.length > 0) {
      self.sendToParent({
        type: 'RECTS_UPDATED',
        payload: { rects: rects }
      });
    }
  };

  IFrameBridge.prototype.startResizeListener = function() {
    var self = this;
    var resizeDebounce = null;
    var layoutViewportWidth = window.innerWidth;

    window.addEventListener('resize', function() {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(function() {
        self.sendRectsUpdate();
        self.reportContentHeight();
        // Breakpoint CSS can change layout without changing classes. A height
        // report can resize this iframe again, so do not rescan on height alone.
        if (layoutViewportWidth !== window.innerWidth) {
          layoutViewportWidth = window.innerWidth;
          self.scanElements();
        }
      }, 50);
    });
  };


  
  

  /** Relay class writes to the HMR module (sq-hmr.mjs) for Vite hot-update. */
  IFrameBridge.prototype.handleWriteClasses = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_CLASSES payload');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_CLASSES__', payload, 'SQ_WRITE_RESULT');
  };

  /**
   * Predicted paint (filmstrip 2026-11-08): apply an ACCEPTED structural change
   * to the DOM now; the write's refresh morph lands 150–400 ms later as a
   * silent check. The scan observer is paused so the change is not re-scanned
   * as a natural mutation, and the one scan sent (next task, so Layers moves
   * with the canvas) is flagged predicted: its keys are still pre-write
   * coordinates, so it must not consume a pending selection.
   */
  IFrameBridge.prototype.applyPrediction = function(mutate) {
    var observing = this.mutationObserverStarted;
    this.stopMutationObserver();
    try { mutate(); } finally { if (observing) this.startMutationObserver(); }
    this._predictedScan = true;
    this.scanThen(null, 1);
    this.reportContentHeight();
  };

  IFrameBridge.prototype.handleReorderElements = function(payload) {
    if (this.editingElement) return;
    if (!payload || !Array.isArray(payload.elementIds)) return;

    var self = this;
    this.applyPrediction(function() { self._reorderChildElements(payload.elementIds); });
  };

  /**
   * ⌘D, predicted: a copy of `key` after `anchorKey` (or inside its end).
   * The copy carries NO source key until the refresh's morph adopts it
   * (unkeyed nodes pair by position): a pre-write coordinate on it would let
   * the next edit target whatever sits at that line in the old file.
   */
  IFrameBridge.prototype.handleCloneElementInDom = function(payload) {
    if (!payload || !payload.key) return;
    var el = this.findElementByKey(payload.key);
    var anchor = this.findElementByKey(payload.anchorKey || payload.key);
    if (!el || !anchor || !anchor.parentNode) return;
    this.applyPrediction(function() {
      var copy = el.cloneNode(true);
      var keyed = [copy].concat(Array.prototype.slice.call(copy.querySelectorAll('[data-key],[data-sq-source]')));
      for (var i = 0; i < keyed.length; i++) {
        keyed[i].removeAttribute('data-key');
        keyed[i].removeAttribute('data-sq-source');
      }
      copy.setAttribute('data-sq-predicted', 'true');
      if (payload.position === 'inside-end') anchor.appendChild(copy);
      else anchor.parentNode.insertBefore(copy, anchor.nextSibling);
    });
  };

  IFrameBridge.prototype.handleReparentElementDom = function(payload) {
    if (!payload || !payload.key || payload.newParentKey === undefined) {
      console.warn('[IFrameBridge] REPARENT_ELEMENT_DOM: Invalid payload');
      return;
    }

    var element = this.findElementByKey(payload.key);
    if (!element) {
      console.warn('[IFrameBridge] REPARENT_ELEMENT_DOM: Element not found:', payload.key);
      return;
    }

    var newParent = payload.newParentKey === null
      ? (document.querySelector('#sq-components') || document.body)
      : this.findElementByKey(payload.newParentKey);

    if (!newParent) {
      console.warn('[IFrameBridge] REPARENT_ELEMENT_DOM: New parent not found:', payload.newParentKey);
      return;
    }

    var children = Array.prototype.slice.call(newParent.children);
    var insertIndex = payload.insertIndex || 0;

    if (insertIndex >= children.length) {
      newParent.appendChild(element);
    } else {
      newParent.insertBefore(element, children[insertIndex]);
    }

    // Force reflow so the element settles into the new parent's layout
    void element.offsetHeight;

    this.scanThen(null, 50);
  };

  // ── instant-edit P0b: class intents ─────────────────────────────────────────────────────────────────────────
  // A durable class write carries { epoch, seq, hold }: seq = the call order of the edit in the editor's acceptance
  // lane. The bridge applies only the newest seq per key (W1), drops writes WITHOUT an intent for a held key — the
  // parent's replay paths (W2) —, and keeps a held key's value on screen until the file provably carries it:
  // the morph's class patches skip it (source-refresh.ts), and it is released only when the parent says the row that
  // wrote it is materialized AND a refresh from the file shows it (or shows a foreign value: newest wins).
  var SQ_HOLD_BACKSTOP_MS = 120000;   // parent silent for this long: files are truth, release
  var SQ_HOLD_VERIFY_MISSES = 2;      // a settled hold whose refresh still shows an older value this many times is released

  /** Canonical token set of a class string (our own sq-ai-* animation classes removed): sorted, joined. */
  function sqClassCanon(v) { return sqClassWithoutAI(v).split(' ').sort().join(' '); }   // sqClassWithoutAI: source-refresh.ts

  /** W0: a new epoch (the parent re-evaluated its counter) starts the bookkeeping over. */
  IFrameBridge.prototype.adoptClassEpoch = function(epoch) {
    if (this._classSeqEpoch === epoch) return;
    this._classSeqEpoch = epoch; this._classSeqHigh = {}; this._classSettledSeq = {};
    this.releaseAllClassHolds();
  };

  IFrameBridge.prototype.classHoldFor = function(el) {
    return el ? (this._classHoldByEl.get(el) || null) : null;
  };

  IFrameBridge.prototype.releaseClassHold = function(hold) {
    if (!hold) return;
    if (this._classHoldByKey[hold.key] === hold) delete this._classHoldByKey[hold.key];
    for (var i = 0; i < hold.els.length; i++) { if (this._classHoldByEl.get(hold.els[i]) === hold) this._classHoldByEl.delete(hold.els[i]); }
  };

  IFrameBridge.prototype.releaseAllClassHolds = function() {
    var keys = Object.keys(this._classHoldByKey);
    for (var i = 0; i < keys.length; i++) this.releaseClassHold(this._classHoldByKey[keys[i]]);
  };

  /** Every held node the morph removed from the document loses its hold: no re-assert by key (keys are positional). */
  IFrameBridge.prototype.releaseDetachedClassHolds = function() {
    var keys = Object.keys(this._classHoldByKey);
    for (var i = 0; i < keys.length; i++) {
      var hold = this._classHoldByKey[keys[i]], alive = false;
      for (var j = 0; j < hold.els.length; j++) if (document.body.contains(hold.els[j])) { alive = true; break; }
      if (!alive) this.releaseClassHold(hold);
    }
  };

  /** A held node inside an astro-island is kept untouched by the morph: nothing can regress it. */
  IFrameBridge.prototype.classHoldInsideIsland = function(hold) {
    for (var i = 0; i < hold.els.length; i++) if (hold.els[i].closest && hold.els[i].closest('astro-island')) return true;
    return false;
  };

  /**
   * The morph found this node's fresh class (what the file renders now). True = leave the DOM alone.
   * Unsettled: a value we painted (or an older base) is STALE (skip); anything else is a foreign write — newest wins,
   * release and patch. Settled (the row landed): fresh == held value releases; a stale value is a miss (kept, counted
   * once per refresh) and after SQ_HOLD_VERIFY_MISSES the file wins.
   */
  IFrameBridge.prototype.holdSkipsClassPatch = function(hold, freshClass) {
    var now = Date.now();
    if (now - Math.max(hold.since, this._classAliveAt || 0) > SQ_HOLD_BACKSTOP_MS) { this.releaseClassHold(hold); return false; }
    var fresh = sqClassCanon(freshClass);
    var stale = !!hold.own[fresh];
    if (!stale) {
      var tokens = fresh ? fresh.split(' ') : [];
      stale = true;
      for (var i = 0; i < tokens.length; i++) if (!hold.baseTokens[tokens[i]]) { stale = false; break; }
    }
    if (!hold.settled) {
      if (stale) return true;
      this.releaseClassHold(hold); return false;
    }
    if (fresh === sqClassCanon(hold.classes)) { this.releaseClassHold(hold); return true; }
    if (!stale) { this.releaseClassHold(hold); return false; }
    if (hold.missAt !== this._morphSeq) { hold.missAt = this._morphSeq; hold.misses++; }
    if (hold.misses >= SQ_HOLD_VERIFY_MISSES) { this.releaseClassHold(hold); return false; }
    return true;
  };

  /** The write was applied: create or refresh the key's hold. preClass = the node's class BEFORE this hold's first write. */
  IFrameBridge.prototype.noteClassIntentApplied = function(payload, intent, target, preClass) {
    var key = payload.key, old = this._classHoldByKey[key], hold = old, i;
    if (intent.hold === false) { if (old) this.releaseClassHold(old); return; }
    if (!target) return;   // no element yet (queued): the retry re-enters with the same seq
    if (!hold) {
      hold = { key: key, seq: intent.seq, classes: payload.classes, own: {}, baseTokens: {}, settled: false, misses: 0, missAt: -1, since: Date.now(), els: [], inlineBg: false };
      var base = preClass !== null && preClass !== undefined ? preClass : this.originalClassesByKey[key];
      if (base !== undefined && base !== null) {
        var canon = sqClassCanon(base), tokens = canon ? canon.split(' ') : [];
        hold.own[canon] = true;
        for (i = 0; i < tokens.length; i++) hold.baseTokens[tokens[i]] = true;
      }
      this._classHoldByKey[key] = hold;
    }
    hold.seq = intent.seq; hold.classes = payload.classes; hold.settled = false; hold.misses = 0; hold.since = Date.now();
    hold.own[sqClassCanon(payload.classes)] = true;
    hold.inlineBg = !!this._classPaintedInlineBg;
    var painted = this._classPaintedEls;
    for (i = 0; i < painted.length; i++) {
      if (hold.els.indexOf(painted[i]) === -1) hold.els.push(painted[i]);
      this._classHoldByEl.set(painted[i], hold);
    }
    // The parent may have said this seq is settled before the write itself arrived: verify at once.
    if ((this._classSettledSeq[key] || 0) >= hold.seq) {
      hold.settled = true;
      if (this.classHoldInsideIsland(hold)) this.releaseClassHold(hold); else this.requestSourceRefresh();
    }
  };

  /** The rows that wrote these held values are materialized: verify against the file (a refresh), then release. */
  IFrameBridge.prototype.handleClassIntentSettled = function(payload) {
    if (!payload) return;
    var settled = payload.settled || [], alive = payload.alive || [], any = false, i;
    for (i = 0; i < settled.length; i++) {
      var item = settled[i];
      if (!item || !item.key || typeof item.seq !== 'number') continue;
      if (item.epoch) this.adoptClassEpoch(item.epoch);
      this._classSettledSeq[item.key] = Math.max(this._classSettledSeq[item.key] || 0, item.seq);
      var hold = this._classHoldByKey[item.key];
      if (!hold || hold.seq > item.seq) continue;   // a newer write is in flight: its own settle follows
      hold.settled = true; hold.misses = 0;
      if (this.classHoldInsideIsland(hold)) this.releaseClassHold(hold); else any = true;
    }
    for (i = 0; i < alive.length; i++) {
      var a = alive[i], held = a && this._classHoldByKey[a.key];
      if (held && held.seq <= a.seq) held.since = Date.now();
    }
    this._classAliveAt = Date.now();
    if (any) this.requestSourceRefresh();
  };

  IFrameBridge.prototype.handleUpdateClasses = function(payload, isRetry) {
    var key = payload && payload.key, intent = payload && payload.intent;
    var plain = key && !this.parseInstanceKey(key);
    var tagged = !!(plain && intent && typeof intent.seq === 'number');
    var preClass = null;
    if (plain) {
      if (tagged) {
        this.adoptClassEpoch(intent.epoch);   // W0
        // W1: an older write than one already applied (a lane-lagged echo, a replay) is dropped. Strict: the one
        // pending-class retry for a key with no DOM element yet re-enters with the SAME seq and applies.
        if (intent.seq < (this._classSeqHigh[key] || 0)) return;
        if (!this._classHoldByKey[key]) { var before = this.findElementByKey(key); preClass = before ? this.getElementClasses(before) : null; }
      } else if (this._classHoldByKey[key]) {
        return;   // W2: no intent for a held key = a parent replay path, never newer than the held value
      }
    }
    var target = this.applyClassCore(payload, isRetry);
    if (tagged) {
      this._classSeqHigh[key] = Math.max(this._classSeqHigh[key] || 0, intent.seq);
      this.noteClassIntentApplied(payload, intent, target, preClass);
    }
  };

  /** The apply path itself (asset resolution, first-wins baseline, setAttribute, the bg-image inline fallback, the
   *  sibling broadcast, the rect report): no ordering gate, no hold bookkeeping. Returns the keyed element, or null. */
  IFrameBridge.prototype.applyClassCore = function(payload, isRetry) {
    var targetElement = null;
    var self = this;
    this._classPaintedEls = [];
    this._classPaintedInlineBg = false;

    // Check if this is an instance key (format: instanceId:selector)
    // If so, delegate to the instance override handler
    if (payload.key) {
      var instanceKeyParts = this.parseInstanceKey(payload.key);
      if (instanceKeyParts) {
        this.handleUpdateInstanceOverride({
          instanceId: instanceKeyParts.instanceId,
          selector: instanceKeyParts.selector,
          classes: payload.classes
        });
        return null;
      }
    }

    if (payload.key) {
      var element = this.findElementByKey(payload.key);
      if (element) {
        targetElement = element;
      }
    }

    // Resolve sq-asset: references for VISUAL application only.
    // INVARIANT (blob-poisoning fix): className always keeps the canonical
    // sq-asset: form — click/scan payloads echo className back into Yjs,
    // and a persisted blob: URL is dead after reload.
    var canonicalClasses = payload.classes || '';
    var resolvedClasses = this.resolveAssetRefs(canonicalClasses);

    // Extract resolved bg image URL for inline style backup
    // (Tailwind JIT may not generate CSS for dynamically-added bg-[url('blob:...')] classes)
    var bgUrlMatch = resolvedClasses.match(/bg-\[url\(['"]?(.+?)['"]?\)\]/);
    var bgUrl = bgUrlMatch ? bgUrlMatch[1] : null;

    // First, update the target element if found by key
    if (targetElement) {
      var currentClasses = this.getElementClasses(targetElement);
      // task-151: THE pre-override baseline. This is the only moment anything
      // in the system still holds the element as the SOURCE renders it — the
      // parent's snapshots hold overrides, and the scan payload reports
      // `getElementClasses` live, so it reports the override as soon as any
      // rescan happens after one is applied. First-wins, and reset with the
      // document on every reload (after which the DOM is bare source again).
      // handleRestoreOriginalClasses hands it back when an undo REMOVES the
      // overlay entry; it suppresses the capture so a restore never becomes the
      // new baseline.
      if (payload.key && !this._restoringClasses &&
          this.originalClassesByKey[payload.key] === undefined) {
        this.originalClassesByKey[payload.key] = currentClasses;
      }
      if (currentClasses !== canonicalClasses) {
        // setAttribute, not .className — SVGElement.className is read-only
        targetElement.setAttribute('class', canonicalClasses);
      }
      this._classPaintedEls.push(targetElement);
      // Apply bg image as inline style (reliable fallback for blob/asset URLs)
      if (bgUrl && bgUrl.indexOf('sq-asset:') === -1) {
        this._classPaintedInlineBg = true;
        targetElement.style.backgroundImage = "url('" + bgUrl + "')";
      } else if (!bgUrl) {
        // No bg-[url()] — clear any inline style we previously set
        targetElement.style.backgroundImage = '';
      }
      // Track elements with unresolved sq-asset: refs for deferred resolution
      if (resolvedClasses.indexOf('sq-asset:') !== -1 && payload.key) {
        this._pendingAssetClasses[payload.key] = payload;
      } else if (payload.key) {
        delete this._pendingAssetClasses[payload.key];   // a newer value without asset refs retires the older pending one
      }
    } else {
      // Element not found - queue for retry after next ELEMENTS_SCANNED
      if (!isRetry && payload.key) {
        // Remove any existing pending update for this key
        this.pendingClassUpdates = this.pendingClassUpdates.filter(function(p) {
          return p.key !== payload.key;
        });
        this.pendingClassUpdates.push(payload);
        return null; // Don't process further, will retry after scan
      }
    }

    // Also update any other elements with the same data-sq-source (for component instances)
    if (payload.sourceLocation) {
      var sourceKey = payload.sourceLocation.file + ':' + payload.sourceLocation.line + ':' + payload.sourceLocation.column;
      // task-149: in local mode the defining source key is shared by every
      // placement of the component, so this optimistic broadcast is itself the
      // leak — styling one <Card/> visibly restyled the sibling <Card/> and the
      // same component on every other route, regardless of how well the doc
      // keys were scoped. Narrow it to the payload key's placement. When the
      // key names no placement (WC / server mode, always) the selector is
      // unchanged and every instance still follows a master edit.
      var placementMatch = payload.key ? PLACEMENT_KEY_PATTERN.exec(payload.key) : null;
      var broadcastSelector = '[data-sq-source="' + sourceKey + '"]';
      if (placementMatch) {
        broadcastSelector += '[data-sq-placement="' + placementMatch[1] + '"]';
      }
      var elements = document.querySelectorAll(broadcastSelector);
      elements.forEach(function(element) {
        if (element !== targetElement) self._classPaintedEls.push(element);
        if (element !== targetElement && self.getElementClasses(element) !== canonicalClasses) {
          element.setAttribute('class', canonicalClasses);
          if (bgUrl && bgUrl.indexOf('sq-asset:') === -1) {
            element.style.backgroundImage = "url('" + bgUrl + "')";
          } else if (!bgUrl) {
            element.style.backgroundImage = '';
          }
        }
      });
    }

    if (targetElement && payload.key) {
      this.reportRectUpdate(payload.key, targetElement);
    }
    return targetElement;
  };

  /**
   * "Put this element back the way the source renders it." Sent by the parent's
   * undo observer when a sourceClasses entry is REMOVED (undo to before the
   * first edit, or redo of a Reset to master) — the counterpart of
   * RESTORE_ORIGINAL_TEXT, for the class tier.
   *
   * The captured baseline wins; `payload.fallbackClasses` (the parent's
   * registration-time value) covers the case where this bridge never applied an
   * override for the key. With neither, the DOM is left alone — blanking a class
   * attribute we have no baseline for would be worse than doing nothing.
   *
   * Applies through handleUpdateClasses so the restore reuses the ONE apply path
   * (sq-asset resolution, the bg-image inline-style fallback, the pending-retry
   * queue), with the capture suppressed for the duration.
   */
  IFrameBridge.prototype.handleRestoreOriginalClasses = function(payload) {
    var key = payload && payload.key;
    if (!key) return;
    // W2: a restore without an intent is dropped for a held key — and must leave the baseline in place.
    if (this._classHoldByKey[key] && !(payload.intent && typeof payload.intent.seq === 'number')) return;
    var original = this.originalClassesByKey[key];
    if (original === undefined) original = payload.fallbackClasses;
    if (original === undefined) return;
    delete this.originalClassesByKey[key];
    this._restoringClasses = true;
    try {
      this.handleUpdateClasses({
        key: key,
        classes: original,
        sourceLocation: payload.sourceLocation,
        intent: payload.intent
      });
    } finally {
      this._restoringClasses = false;
    }
  };

  IFrameBridge.prototype.processPendingClassUpdates = function() {
    if (this.pendingClassUpdates.length === 0) return;

    var pending = this.pendingClassUpdates.slice();
    this.pendingClassUpdates = [];

    var self = this;
    pending.forEach(function(payload) {
      self.handleUpdateClasses(payload, true); // isRetry = true
    });
  };

  /**
   * Parse "instanceId:selector" keys. Returns { instanceId, selector } or null.
   * Distinguishes from source keys (which contain slashes or file extensions).
   */
  IFrameBridge.prototype.parseInstanceKey = function(key) {
    if (!key || typeof key !== 'string') return null;

    // Skip if it looks like a source location (contains slash or file extension)
    if (key.indexOf('/') !== -1 || key.indexOf('.astro') !== -1 ||
        key.indexOf('.tsx') !== -1 || key.indexOf('.ts') !== -1) {
      return null;
    }

    // Instance keys have format: instanceId:selector
    // The selector is a simple identifier (letters, numbers, hyphens, underscores)
    var colonIndex = key.lastIndexOf(':');
    if (colonIndex === -1 || colonIndex === 0 || colonIndex === key.length - 1) {
      return null;
    }

    var instanceId = key.substring(0, colonIndex);
    var selector = key.substring(colonIndex + 1);

    // Selector must be a simple identifier (not contain colons)
    if (selector.indexOf(':') !== -1 || !/^[a-zA-Z0-9_-]+$/.test(selector)) {
      return null;
    }

    // instanceId shouldn't look like a file path
    if (instanceId.indexOf('/') !== -1) {
      return null;
    }

    return {
      instanceId: instanceId,
      selector: selector
    };
  };

  IFrameBridge.prototype.handleUpdateInstanceOverride = function(payload) {
    if (!payload || !payload.instanceId || !payload.selector) return;

    var compositeKey = payload.instanceId + ':' + payload.selector;
    var element = this.findElementByKey(compositeKey);

    // Fallback: check if selector is root element pattern (e.g., "div-0")
    if (!element && /^[a-z]+-0$/i.test(payload.selector)) {
      var rootEl = this.findElementByKey(payload.instanceId);
      // Only use if it's actually a child key, not the root itself
      if (rootEl && rootEl.getAttribute('data-key') !== payload.instanceId) {
        element = rootEl;
      }
    }

    if (!element) return;

    if (payload.classes !== undefined) {
      // Resolve for visuals only — className stays canonical (see handleUpdateClasses)
      var resolvedClasses = this.resolveAssetRefs(payload.classes);
      // setAttribute, not .className — SVGElement.className is read-only
      element.setAttribute('class', payload.classes);

      // Inline style backup for bg images (Tailwind may not generate CSS for blob URLs)
      var bgUrlMatch = resolvedClasses.match(/bg-\[url\(['"]?(.+?)['"]?\)\]/);
      var bgUrl = bgUrlMatch ? bgUrlMatch[1] : null;
      if (bgUrl && bgUrl.indexOf('sq-asset:') === -1) {
        element.style.backgroundImage = "url('" + bgUrl + "')";
      } else if (!bgUrl) {
        element.style.backgroundImage = '';
      }

      // Track unresolved for deferred resolution after asset transfer
      if (resolvedClasses.indexOf('sq-asset:') !== -1) {
        this._pendingAssetClasses[compositeKey] = {
          key: compositeKey,
          classes: payload.classes
        };
      }
    }

    // Resolve img src for instance children too
    if (element.tagName === 'IMG') {
      var src = element.getAttribute('src');
      if (src && src.indexOf('sq-asset:') === 0) {
        var resolvedSrc = this.resolveAssetRef(src);
        if (resolvedSrc !== src) {
          element.src = resolvedSrc;
        }
      }
    }

    this.reportRectUpdate(compositeKey, element);
  };

  IFrameBridge.prototype.handleUpdateText = function(payload) {
    if (!payload.key || payload.textContent === undefined) {
      return;
    }

    var element = this.findElementByKey(payload.key);
    if (!element) {
      return;
    }

    // task-151: same pre-override baseline capture as handleUpdateClasses, for
    // the observer-driven text path (undo, AI, scan re-apply). ENTER_EDIT_MODE
    // captured one only for a real edit SESSION, so an undo that removed a
    // sourceText entry written any other way had nothing to restore to.
    // First-wins, so an authoritative ENTER_EDIT_MODE baseline is never
    // overwritten by a later override.
    if (this.originalTextByKey[payload.key] === undefined) {
      this.originalTextByKey[payload.key] = element.textContent;
    }

    // Update text content if different
    if (element.textContent !== payload.textContent) {
      element.textContent = payload.textContent;
    }
  };


  

  IFrameBridge.prototype.handleUpdateLinkAttribute = function(payload) {
    if (!payload.key || !payload.attribute) return;

    var element = this.findElementByKey(payload.key);
    if (!element) return;

    this.updateAttribute(element, payload.attribute, payload.value);
  };

  // Re-apply a persisted inline-link markup override (link wrap/unwrap on a
  // source-tracked element). Posted by the parent's scan re-apply after every
  // preview reload — the doc's sourceLinkAttributes markup tier is the only
  // reload persistence for WC link wraps. Sanitized again on entry (defense in
  // depth; the stored value was sanitizeLinkHtml output already) and
  // idempotent: an unchanged innerHTML is left alone so repeated scans don't
  // churn the DOM.
  IFrameBridge.prototype.handleUpdateSourceMarkup = function(payload) {
    if (!payload || !payload.key || typeof payload.markup !== 'string') return;

    var element = this.findElementByKey(payload.key);
    if (!element) return;

    var clean = this.sanitizeLinkHtml(payload.markup);
    if (element.innerHTML === clean) return;
    element.innerHTML = clean;
  };

  IFrameBridge.prototype.handleSetVariablesCSS = function(payload) {
    if (!payload || typeof payload.css !== 'string') return;

    var style = document.getElementById('sq-variables');
    if (!style) {
      style = document.createElement('style');
      style.id = 'sq-variables';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = payload.css;
  };

  // Theme-mode preview: variables CSS scopes non-default modes under
  // [data-mode="<name>"] (cssGenerator.ts) — set/clear it on <html>.
  IFrameBridge.prototype.handleSetThemeMode = function(payload) {
    var mode = payload && payload.mode;
    if (mode) {
      document.documentElement.setAttribute('data-mode', mode);
    } else {
      document.documentElement.removeAttribute('data-mode');
    }
  };

  // --- Drawn Elements ---

  // Insert el into parent at index (clamped); index null/undefined appends.
  // Skips drawn siblings when counting? No — index is the draw-time position
  // among ALL children (position-aware findInsertionTarget), so a plain
  // children[] anchor reproduces it.
  IFrameBridge.prototype._mountDrawnAt = function(parent, el, index) {
    if (typeof index === 'number' && index >= 0 && index < parent.children.length) {
      parent.insertBefore(el, parent.children[index]);
    } else {
      parent.appendChild(el);
    }
  };

  // Where a parentKey-less drawn ROOT belongs right now: inside the page
  // layout's DEFAULT slot container when one is rendered, else #sq-components.
  // The named slots are never a fallback target; without a layout the first
  // selector matches nothing. ONE chain — both drawn-root mount paths use it.
  IFrameBridge.prototype._drawnRootTarget = function() {
    return document.querySelector('[data-sq-slot]:not([name])') ||
      document.getElementById('sq-components') || document.body;
  };

  // The third arg is an optional pre-resolved _drawnRootTarget(): the RENDER
  // loop resolves it ONCE per render instead of re-querying per drawn root.
  IFrameBridge.prototype._rehomeDrawnRoot = function(el, index, target) {
    if (!el) return;
    if (!target) target = this._drawnRootTarget();
    // Guard: never re-home a node into itself or its own subtree (appendChild
    // would throw mid-render and strand the reconciler half-applied).
    if (el === target || el.contains(target)) return;
    if (el.parentElement !== target) this._mountDrawnAt(target, el, index);
  };

  IFrameBridge.prototype._createDrawnElement = function(drawn) {
    if (!drawn || !drawn.key || !drawn.tag) return;

    var el = document.createElement(drawn.tag);
    el.setAttribute('data-key', drawn.key);
    el.setAttribute('data-drawn', 'true');
    if (drawn.classes) el.className = drawn.classes;
    if (drawn.textContent) el.textContent = drawn.textContent;
    if (drawn.staticMarkup && !drawn.slotType) el.innerHTML = drawn.staticMarkup;

    // Borders are drawn by the editor's SelectionOverlay on hover/select —
    // not painted onto the iframe DOM.
    if (drawn.slotType) {
      el.setAttribute('data-slot-type', drawn.slotType);
      if (drawn.slotComponentMarkup) {
        el.innerHTML = drawn.slotComponentMarkup;
        if (drawn.slotComponentName) el.setAttribute('data-slot-component', drawn.slotComponentName);
      } else {
        el.style.minHeight = '120px';
      }
    }

    // With a page-level layout applied, a parentKey-less drawn root is page
    // CONTENT: it mounts inside the DEFAULT slot container (the wrapped
    // <div data-sq-slot> without a name attr), not below the chrome. The
    // container exists whenever a layout is applied and the page has drawn
    // roots (composeSlotChildren force-wraps it).
    // A parentKey that does NOT resolve deliberately skips the slot and falls
    // to #sq-components — an unresolved child is not page content.
    var parent = drawn.parentKey ? this.findElementByKey(drawn.parentKey) : this._drawnRootTarget();
    if (!parent) parent = document.getElementById('sq-components') || document.body;
    // Mount at the draw-time index (C5): a box drawn at the TOP of a layout
    // page lands ABOVE the slot content instead of being appended below it.
    this._mountDrawnAt(parent, el, drawn.insertIndex);
  };

  IFrameBridge.prototype.handleInsertDrawnElement = function(payload) {
    if (!payload || !payload.key || !payload.tag) {
      console.error('[IFrameBridge] Invalid INSERT_DRAWN_ELEMENT payload');
      return;
    }

    // If element already exists, update it instead of creating a duplicate
    var existing = this.findElementByKey(payload.key);
    if (existing) {
      existing.className = payload.classes || '';
      if (payload.textContent) {
        existing.textContent = payload.textContent;
      }
      // Pen node edits re-send with fresh markup; only a payload CARRYING
      // markup may replace innerHTML (task-107) — markup-less re-inserts
      // must not clobber existing SVG (task-106 contract).
      if (payload.staticMarkup && !payload.slotType) {
        existing.innerHTML = payload.staticMarkup;
      }
    } else {
      this._createDrawnElement(payload);
    }

    this.scanThen(null, 50);
    this.reportContentHeight();
  };

  IFrameBridge.prototype.handleRemoveDrawnElement = function(payload) {
    if (!payload || !payload.key) return;

    var el = this.findElementByKey(payload.key);
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
      this.scanThen(null, 50);
      this.reportContentHeight();
    }
  };

  IFrameBridge.prototype.handleUpdateSlotPlaceholder = function(payload) {
    if (!payload || !payload.key) return;
    var el = this.findElementByKey(payload.key);
    if (!el) return;
    var placeholder = el.querySelector('[data-slot-placeholder]');
    if (placeholder) {
      placeholder.innerHTML =
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<line x1="7" y1="8" x2="17" y2="8"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="7" y1="16" x2="13" y2="16"/></svg>' +
        '<span style="font-size:12px;">Blog: ' + (payload.collectionName || 'connected') + '</span>';
    }
  };

  IFrameBridge.prototype._reorderChildElements = function(childKeys) {
    if (!Array.isArray(childKeys) || childKeys.length < 2) return;

    var self = this;
    var elements = [];
    for (var i = 0; i < childKeys.length; i++) {
      var el = self.findElementByKey(childKeys[i]);
      if (el) elements.push(el);
    }

    if (elements.length < 2) return;

    var parent = elements[0].parentElement;
    if (!parent) return;

    for (var j = 1; j < elements.length; j++) {
      if (elements[j].parentElement !== parent) return;
    }

    for (var k = 0; k < elements.length; k++) {
      parent.appendChild(elements[k]);
    }
  };

IFrameBridge.prototype.handleRemoveElementFromDOM = function(payload) {
    if (!payload || !payload.key) return;

    var el = this.findElementByKey(payload.key);
    if (el && el.parentNode) {
      this.applyPrediction(function() { el.parentNode.removeChild(el); });
    }
  };

IFrameBridge.prototype.handleRequestPreviewRefresh = function(payload) {
    if (!payload || !payload.key) return;
    var key = payload.key;
    var element = this.findElementByKey(key);
    if (!element) return;

    // Re-capture bg image preview
    this.captureAndSendBgImagePreview(element, key);

    // Image loading can outlive the parent's delayed refresh request.
    if (element.tagName === 'IMG') this.captureAndSendImagePreview(element, key);
  };

IFrameBridge.prototype.handleDrillDown = function(event, target, key) {
    this.contextKey = key;

    var blogCtx = this._resolveBlogClickContext(event.target);
    var childTarget = this.findEditableElement(blogCtx.resolvedTarget, true, false);
    if (!childTarget || childTarget === target) return false;

    var payload = this.buildElementPayload(childTarget, {
      isDoubleClick: false,
      isDirectSelect: false,
      isOutsideContext: false,
      drillDownContext: key
    }, { rawTarget: event.target, clickedCardWrapper: blogCtx.clickedCardWrapper });

    this.sendToParent({ type: 'ELEMENT_CLICK', payload: payload });
    this.captureAndSendBgImagePreview(childTarget, payload.key);
    return true;
  };

IFrameBridge.prototype.handleGetElementSectionHtml = function(payload) {
    if (!payload || !payload.key) return;
    var key = payload.key;
    var element = this.findElementByKey(key);
    var html = null;
    if (element) {
      var rootSection = this.findRootSection(element);
      if (rootSection) {
        html = rootSection.outerHTML;
      } else {
        html = element.outerHTML;
      }
    }
    this.sendToParent({
      type: 'ELEMENT_SECTION_HTML',
      payload: { key: key, html: html },
    });
  };

/** Element-clipboard: cleaned outerHTML of a clone (live DOM never mutated). Always replies. */
IFrameBridge.prototype.handleGetElementCopyHtml = function(payload) {
    if (!payload || !payload.key || !payload.requestId) return;
    var element = this.findElementByKey(payload.key);
    if (!element) {
      this.sendToParent({ type: 'ELEMENT_COPY_HTML', payload: { requestId: payload.requestId, key: payload.key, html: null } });
      return;
    }
    this.sendToParent({ type: 'ELEMENT_COPY_HTML', payload: { requestId: payload.requestId, key: payload.key, html: this.cleanClone(element).outerHTML } });
  };

/** A detached copy with every editor bookkeeping attribute (data-key, data-sq-*,
 *  data-astro-*, contenteditable) removed from it and its descendants. The live
 *  DOM is never mutated. Shared by the element clipboard and text commits. */
IFrameBridge.prototype.cleanClone = function(element) {
    var clone = element.cloneNode(true);
    var nodes = [clone];
    var descendants = clone.querySelectorAll('*');
    for (var i = 0; i < descendants.length; i++) nodes.push(descendants[i]);
    for (var n = 0; n < nodes.length; n++) {
      var attrs = Array.prototype.slice.call(nodes[n].attributes);
      for (var a = 0; a < attrs.length; a++) {
        var name = attrs[a].name;
        if (name === 'data-key' || name === 'contenteditable' || name.indexOf('data-sq-') === 0 || name.indexOf('data-astro-') === 0) nodes[n].removeAttribute(name);
      }
    }
    return clone;
  };

IFrameBridge.prototype.isClickOutsideContext = function(target, key) {
    if (!this.contextKey || this.contextKey === key) return false;
    var contextElement = this.findElementByKey(this.contextKey);
    return contextElement && !contextElement.contains(target);
  };

/** task-120: page switch without navigation. Parent posts SET_PAGE, then the
 *  new page's RENDER. Clears page-scoped state; the DOM swap itself is RENDER's job. */
IFrameBridge.prototype.handleSetPage = function(payload) {
    var wasObserving = this.mutationObserverStarted;
    this.stopMutationObserver();
    window.scrollTo(0, 0);
    if (this.editingElement) this.exitEditModeCleanup();
    this.removeSelectionHighlight();
    this.clearHighlightElement();
    this.handleSetAIActiveHighlights({ keys: [] });
    if (this._sqPreviewFinalize) this._sqPreviewFinalize('setpage'); // preview must not leak across pages
    this.resetRescanBudget();
    // task-120 (5.4): rect cache is page-scoped — source keys repeat across pages.
    this._lastRectByKey = {};
    this._currentPageId = (payload && payload.pageId) || null;
    if (wasObserving) this.startMutationObserver();
  };

/** task-206: component-viewer demo — mutate the rendered .sq-media in place
 *  (count grows/shrinks placeholder slots; vars set the --sq-media-* knobs).
 *  There is no invocation to write in the viewer, so this is display-only. */
IFrameBridge.prototype.handleSetMediaDemo = function(payload) {
    if (!payload) return;
    var root = document.querySelector('[data-sq-unit]');
    if (!root) return;
    if (typeof payload.count === 'number' && payload.count >= 1) {
      root.style.setProperty('--sq-media-count', String(payload.count));
      var slots = root.querySelectorAll('[data-sq-media-slot]');
      var i;
      for (i = slots.length - 1; i >= payload.count; i--) {
        slots[i].parentNode.removeChild(slots[i]);
      }
      for (i = slots.length; i < payload.count; i++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sq-media-placeholder';
        b.setAttribute('data-sq-media-slot', String(i));
        b.setAttribute('data-sq-media', 'true');
        b.setAttribute('aria-label', 'Add media');
        root.appendChild(b);
      }
    }
    var vars = payload.vars || {};
    for (var k in vars) {
      if (!Object.prototype.hasOwnProperty.call(vars, k)) continue;
      if (vars[k] == null) root.style.removeProperty('--sq-media-' + k);
      else root.style.setProperty('--sq-media-' + k, vars[k] + 'px');
    }
    // The selection overlay must travel WITH the change, not after the
    // debounced resize-observer pass — push fresh rects synchronously.
    this.sendRectsUpdate();
  };

  // Chromium fixed-layer raster bug (2026-08-23, verified Chrome 144/macOS):
  // when the embedder nests this iframe under two clipping ancestors (the
  // editor's h-screen shell + canvas clip), the regions of a position:fixed
  // element that sit outside the interior clip at the layer's FIRST raster
  // are never rastered again — panning/zooming the canvas reveals blank
  // pixels, forever. Only re-creating the composited layer re-rasters at the
  // current clip, and the fresh raster SURVIVES the restore. Toggling
  // will-change:transform for ~2 frames does exactly that. The parent sends
  // REPAINT_FIXED on iframe ready, canvas pan/zoom settle and window resize;
  // armFixedRepaintOnResize covers in-frame viewport changes (breakpoint
  // width, local viewport-height drag).
  IFrameBridge.prototype.handleRepaintFixed = function() {
    if (this._fixedRepaintRestore) return; // toggle in flight — its raster is already fresh
    var toRestore = [];
    var self = this;
    var setRepaintStyle = function(el, value) {
      var before = el.getAttribute('style');
      el.style.willChange = value;
      if (!self._heightMutationObserver) return;
      // Record exact bridge-owned transitions, not whole elements/properties:
      // a concurrent author style edit must still renew automatic fitting.
      self._heightRepaintStyles = self._heightRepaintStyles || new WeakMap();
      var writes = self._heightRepaintStyles.get(el) || [];
      writes.push({ before: before, after: el.getAttribute('style') });
      self._heightRepaintStyles.set(el, writes);
    };
    var all = document.body ? document.body.getElementsByTagName('*') : [];
    // ponytail: full-document computed-style sweep; runs only on discrete
    // settle events — index fixed elements at scan time if it ever measures hot
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.style && el.style.willChange) continue; // already layerized; never clobber inline value
      var cs;
      try { cs = window.getComputedStyle(el); } catch (e) { continue; }
      if (cs.position !== 'fixed') continue;
      setRepaintStyle(el, 'transform');
      toRestore.push(el);
    }
    if (toRestore.length === 0) return;
    // setTimeout, not rAF: Chrome freezes rAF in local cross-origin iframes (task-146)
    this._fixedRepaintRestore = setTimeout(function() {
      self._fixedRepaintRestore = null;
      for (var j = 0; j < toRestore.length; j++) {
        setRepaintStyle(toRestore[j], '');
      }
    }, 64);
  };

  // In-frame viewport resizes re-layerize fixed elements too (media queries
  // can flip an element TO fixed at the new width; its layer then rasters
  // under whatever clip happens to apply — same bug, different entry).
  IFrameBridge.prototype.armFixedRepaintOnResize = function() {
    var self = this;
    var timer = null;
    window.addEventListener('resize', function() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(function() {
        timer = null;
        self.handleRepaintFixed();
      }, 150);
    });
  };


  
  /**
   * Restore the baseline text for a key. Sent by the parent's undo observer
   * when a sourceText entry is removed entirely (undo to before the first
   * edit) — i.e. "go back to the pre-override source text".
   */
  IFrameBridge.prototype.handleRestoreOriginalText = function(payload) {
    var key = payload && payload.key;
    if (!key) return;
    var element = this.findElementByKey(key);
    if (!element) return;
    // An element whose text holds inline markup restores that markup, so the
    // <br>/<span> comes back with the text (flat textContent would drop it).
    if (this.originalMarkupByKey && this.originalMarkupByKey[key] !== undefined) {
      element.innerHTML = this.originalMarkupByKey[key];
    } else if (this.originalTextByKey[key] !== undefined) {
      element.textContent = this.originalTextByKey[key];
    }
  };

  /**
   * Enter text edit mode on an element (contentEditable).
   * Sets a 300ms grace period to ignore stray clicks from overlay pointer-events toggle.
   * Registers blur, input, and selectionchange handlers (cleaned up in exitEditModeCleanup).
   */
  IFrameBridge.prototype.handleEnterEditMode = function(payload) {
    var key = payload && payload.key;
    var element = this.findElementByKey(key);
    if (!element || this.editingElement) return;

    var self = this;

    // Setup state
    this._editGraceUntil = Date.now() + 300;
    this.savedSelectionRange = null;
    this.editingElement = element;
    this.originalTextContent = element.textContent;
    if (key && this.hasInlineMarkup(element)) {
      // Such text commits as markup (see exitEditModeCleanup); keep the
      // first-seen inner markup so an undo can put it back on screen.
      this.originalMarkupByKey = this.originalMarkupByKey || {};
      if (this.originalMarkupByKey[key] === undefined) this.originalMarkupByKey[key] = element.innerHTML;
    }
    if (key) {
      if (payload && payload.originalText !== undefined) {
        // Authoritative pre-override source text from the parent (which owns
        // staticMarkup). Stored unconditionally so a baseline captured from an
        // already-overridden DOM (reload-with-override) never goes stale.
        this.originalTextByKey[key] = payload.originalText;
      } else if (!this.originalTextByKey[key]) {
        // Fallback: first-seen DOM text (drawn elements and other keys the
        // parent cannot resolve a source baseline for).
        this.originalTextByKey[key] = element.textContent;
      }
    }
    // Text, never structure: no ⌘B/⌘I/paste formatting the commit would drop (audit #38).
    element.contentEditable = 'plaintext-only';
    // Seamless canvas Task 1.7: a restored draft (typed before a crash or a
    // document replacement). The baselines above stay the FILE text, so exit
    // reports the change and commits it.
    var draftMarkup = payload && typeof payload.draftMarkup === 'string' ? payload.draftMarkup : null;
    if (draftMarkup !== null) element.innerHTML = draftMarkup;

    // Selection change handler - reports text selection for link editing
    var selectionHandler = function() {
      try {
        if (self.linkInteracting) return;
        var selPayload = self.buildSelectionPayload(key);
        // task-120 (5.3): selectionchange fires per caret twitch — skip the
        // send when the payload is identical to the last one.
        var sig = JSON.stringify(selPayload);
        if (sig === self._lastTextSelectionSig) return;
        self._lastTextSelectionSig = sig;
        self.sendToParent({ type: 'TEXT_SELECTION_CHANGED', payload: selPayload });
      } catch (err) {
        console.error('[Link] selectionHandler error:', err);
      }
    };
    document.addEventListener('selectionchange', selectionHandler);
    element._selectionHandler = selectionHandler;

    // Content editor: the block toolbar needs a RECT, which the shared
    // selection payload does not carry (the design-mode link flow consumes that
    // one, so it is not ours to reshape). Additive and stamp-gated, so every
    // other surface is unaffected.
    // Input handler - updates content height and debounces rect updates for overlay repositioning
    var inputHandler = function() {
      self.reportContentHeight();
      self.scheduleTextDraft();
      if (element._rectUpdateTimeout) clearTimeout(element._rectUpdateTimeout);
      element._rectUpdateTimeout = setTimeout(function() {
        var rect = element.getBoundingClientRect();
        var elementKey = element.getAttribute('data-key') || element.getAttribute('data-sq-source');
        if (elementKey) {
          self.sendToParent({
            type: 'RECT_UPDATED',
            payload: {
              key: elementKey,
              rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            },
            timestamp: Date.now()
          });
        }
      }, 150);
    };
    element.addEventListener('input', inputHandler);
    element._inputHandler = inputHandler;

    // Blur handler - delayed to tolerate transient blur during cross-frame focus settling
    this.editBlurHandler = function() {
      setTimeout(function() {
        if (self.editingElement === element && document.activeElement !== element) {
          self.exitEditModeCleanup();
        }
      }, 200);
    };
    element.addEventListener('blur', this.editBlurHandler);

    // Window blur handler - exits edit mode when iframe loses focus (not during link interaction).
    // Uses document.hasFocus() to distinguish real focus loss from transient blur.
    this.windowBlurHandler = function() {
      setTimeout(function() {
        if (self.editingElement === element && !self.linkInteracting && !document.hasFocus()) {
          element.blur();
        }
      }, 300);
    };
    window.addEventListener('blur', this.windowBlurHandler);

    // Focus and select all text (a restored draft continues at its end instead)
    element.focus();
    var range = document.createRange();
    range.selectNodeContents(element);
    if (draftMarkup !== null) range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Seamless canvas (plan 2026-10-04 Task 1.6): mirror typed text to the parent,
  // which keeps it in <project>/.sq/drafts until the commit is accepted.
  // ponytail: 300 ms trailing debounce + flush on pagehide/hidden/boundary.
  // Ceiling: an Electron renderer crash loses ≤300 ms of typing.
  IFrameBridge.prototype.scheduleTextDraft = function() {
    var self = this;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(function() { self._draftTimer = null; self.flushTextDraft(); }, 300);
  };

  IFrameBridge.prototype.flushTextDraft = function() {
    var el = this.editingElement;
    if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }
    if (!el) return;
    var key = el.getAttribute('data-key') || el.getAttribute('data-sq-source');
    if (!key) return;
    this.sendToParent({ type: 'TEXT_DRAFT', payload: {
      key: key, file: (el.getAttribute('data-sq-source') || '').split(':')[0],
      sourceVersion: el.getAttribute('data-sq-source-version') || '',
      markup: this.sanitizeLinkHtml(this.cleanClone(el).innerHTML), page: location.pathname } });
  };



  
  /**
   * Sanitize innerHTML by removing dangerous attributes from all elements.
   * Removes: event handlers (onclick, onload, etc.), javascript: URLs, class attributes from links.
   * Returns sanitized HTML string.
   */
  IFrameBridge.prototype.sanitizeLinkHtml = function(innerHTML) {
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = innerHTML;

    // Dangerous attributes to remove from ALL elements
    var dangerousAttrs = [
      'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onmousemove',
      'onkeydown', 'onkeyup', 'onkeypress', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset',
      'onload', 'onunload', 'onerror', 'onabort', 'onscroll', 'onresize', 'oncontextmenu',
      'ondrag', 'ondragstart', 'ondragend', 'ondragover', 'ondragenter', 'ondragleave', 'ondrop',
      'oncopy', 'oncut', 'onpaste', 'oninput', 'oninvalid', 'onsearch', 'onselect', 'ontouchstart',
      'ontouchmove', 'ontouchend', 'ontouchcancel', 'onwheel', 'onanimationstart', 'onanimationend',
      'ontransitionend', 'onpointerdown', 'onpointerup', 'onpointermove', 'onpointercancel'
    ];

    // Remove dangerous attributes from all elements
    tempDiv.querySelectorAll('*').forEach(function(el) {
      dangerousAttrs.forEach(function(attr) {
        el.removeAttribute(attr);
      });

      // Remove any attribute starting with 'on' (catch-all for event handlers)
      Array.from(el.attributes).forEach(function(attr) {
        if (attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    // Sanitize <a> tags specifically
    tempDiv.querySelectorAll('a').forEach(function(a) {
      // Remove class attribute
      a.removeAttribute('class');

      // Sanitize href - remove javascript: URLs
      var href = a.getAttribute('href');
      if (href) {
        var cleanHref = href.trim().toLowerCase();
        if (cleanHref.startsWith('javascript:') || cleanHref.startsWith('data:') || cleanHref.startsWith('vbscript:')) {
          a.removeAttribute('href');
        }
      }
    });

    // Remove <script> tags entirely
    tempDiv.querySelectorAll('script').forEach(function(s) { s.remove(); });

    return tempDiv.innerHTML;
  };

  /**
   * Find the markup element and key for persistence.
   * Climbs to ancestor with instance-child key if needed.
   * Returns { element, key }.
   */
  IFrameBridge.prototype.resolveMarkupTarget = function(element, key) {
    var markupElement = element;
    var markupKey = key;

    if (!this.isInstanceChildKey(markupKey)) {
      var ancestorResult = this.findAncestorWithInstanceChildKey(markupElement);
      if (ancestorResult) {
        markupElement = ancestorResult.element;
        markupKey = ancestorResult.key;
      }
    }

    return { element: markupElement, key: markupKey };
  };

  /**
   * Handle wrapping selected text in a link.
   */
  IFrameBridge.prototype.handleWrapSelectionInLink = function(payload) {
    var key = payload.key;
    var href = payload.href;
    var target = payload.target;
    var self = this;

    var selection = document.getSelection();
    var range = null;

    // Try to get current selection first
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      range = selection.getRangeAt(0);
    }
    // Fall back to saved selection (used when focus left iframe to LinkBlock)
    else if (this.savedSelectionRange && this.savedSelectionRange.key === key) {
      var el = this.findElementByKey(key);
      range = this.reconstructRangeFromSaved(this.savedSelectionRange, el);
    }

    if (!range) {
      console.warn('[Link] No valid range available');
      return;
    }

    // Check for cross-boundary selection
    if (range.startContainer !== range.endContainer) {
      var startParent = range.startContainer.parentElement;
      var endParent = range.endContainer.parentElement;
      // Check containment with null safety (avoid optional chaining for browser compatibility)
      var startContainsEnd = startParent && endParent && startParent.contains(endParent);
      var endContainsStart = endParent && startParent && endParent.contains(startParent);
      if (startParent !== endParent && !startContainsEnd && !endContainsStart) {
        return;
      }
    }

    var element = this.findElementByKey(key);
    if (!element) {
      console.warn('[Link] Parent element not found for key:', key);
      return;
    }

    // Temporarily make element contentEditable if using saved range
    var wasContentEditable = element.isContentEditable;
    if (!wasContentEditable) {
      element.contentEditable = 'true';
    }

    // Create link element
    var link = document.createElement('a');
    link.href = href;
    if (target) {
      link.target = target;
    }

    // Calculate and set data-key BEFORE surroundContents
    var createdLinkKey = null;
    var isInstanceKey = /^el-[^:]+:[a-z]+-\d+$/i.test(key);
    if (isInstanceKey) {
      var colonIdx = key.indexOf(':');
      var instanceId = key.substring(0, colonIdx);

      var maxLinkIndex = -1;
      var existingLinks = document.querySelectorAll('[data-key^="' + instanceId + ':a-"]');
      existingLinks.forEach(function(existingLink) {
        var existingKey = existingLink.getAttribute('data-key');
        var match = existingKey.match(/:a-(\d+)$/);
        if (match) {
          var idx = parseInt(match[1], 10);
          if (idx > maxLinkIndex) maxLinkIndex = idx;
        }
      });
      createdLinkKey = instanceId + ':a-' + (maxLinkIndex + 1);
      link.setAttribute('data-key', createdLinkKey);
    }

    try {
      range.surroundContents(link);
    } catch (e) {
      console.warn('[Link] surroundContents failed:', e.message);
      if (!wasContentEditable) {
        element.contentEditable = 'false';
      }
      return;
    }

    if (!wasContentEditable) {
      element.contentEditable = 'false';
    }

    // Determine which element's markup to report for persistence
    var markup = self.resolveMarkupTarget(element, key);

    self.sendToParent({
      type: 'MARKUP_CHANGED',
      payload: {
        key: markup.key,
        innerHTML: self.sanitizeLinkHtml(markup.element.innerHTML),
        linkKey: link.getAttribute('data-key'),
        href: href,
        target: target
      }
    });

    // Exit text edit mode.
    // EDIT_MODE_EXITED carries plain text (matches exitEditModeCleanup() at line ~1179);
    // the inline <a> we just inserted is persisted separately via MARKUP_CHANGED above.
    // Sending innerHTML here would corrupt the text override with HTML and falsely trip
    // the textContent !== originalText change-detection in ViewportFrame's handler.
    // See task-017 / systems.json text-editing knownIssues.
    var editKey = self.editingElement ? self.editingElement.getAttribute('data-key') : null;
    var newText = self.editingElement ? self.editingElement.textContent : '';

    selection.removeAllRanges();

    if (editKey) {
      self.sendToParent({
        type: 'EDIT_MODE_EXITED',
        payload: { key: editKey, textContent: newText, originalText: self.originalTextContent || newText }
      });
    }

    // Set contentEditable to false before clearing editingElement
    if (self.editingElement) {
      self.editingElement.contentEditable = 'false';
      self.editingElement.blur();
    }

    self.editingElement = null;
    self.originalTextContent = null;
    // Reset linkInteracting so future TEXT_SELECTION_CHANGED messages aren't blocked
    self.linkInteracting = false;

    // Re-scan elements and select the new link
    self.scanThen(function() {
      requestAnimationFrame(function() {
        var freshLink = self.requireElement(createdLinkKey, 'Could not find link by key');
        if (!freshLink) return;

        var linkRect = freshLink.getBoundingClientRect();
        if (linkRect.width === 0 && linkRect.height === 0) {
          var rangeForRect = document.createRange();
          rangeForRect.selectNodeContents(freshLink);
          var rects = rangeForRect.getClientRects();
          if (rects.length > 0) linkRect = rects[0];
        }

        self.sendToParent({
          type: 'ELEMENT_CLICK',
          payload: {
            key: createdLinkKey,
            tagName: 'a',
            classes: freshLink.className || '',
            rect: self.buildRect(linkRect)
          }
        });
      });
    });

    self.removeSelectionHighlight();
    self.savedSelectionRange = null;
  };

  /**
   * Handle unwrapping a link (removing the <a> tag but keeping content).
   */
  IFrameBridge.prototype.handleUnwrapLink = function(payload) {
    var key = payload.key;
    var linkSelector = payload.linkSelector;
    var self = this;

    var element = this.findElementByKey(key);
    if (!element) return;

    var link = null;
    var parentElementForSelection = element;

    // If the element itself is an <a> tag, unwrap it
    if (element.tagName.toLowerCase() === 'a') {
      link = element;
      var parent = element.parentElement;
      while (parent && parent !== document.body) {
        if (parent.hasAttribute('data-key')) {
          parentElementForSelection = parent;
          break;
        }
        parent = parent.parentElement;
      }
    } else {
      // Try to find link at current cursor/selection position
      var selection = document.getSelection();
      if (selection && selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        var linkAtCursor = self.findClosestLink(range.commonAncestorContainer);
        if (linkAtCursor && element.contains(linkAtCursor)) {
          link = linkAtCursor;
        }
      }

      if (!link) {
        link = element.querySelector('a[data-key="' + linkSelector + '"]') || element.querySelector('a');
      }
    }

    if (!link) return;

    // Replace link with its contents
    var linkContent = link.innerHTML || link.textContent || '';
    if (linkContent) {
      link.outerHTML = linkContent;
    } else if (link.parentNode) {
      link.parentNode.removeChild(link);
    }

    var selection = document.getSelection();
    if (selection) selection.removeAllRanges();
    // Reset linkInteracting so future TEXT_SELECTION_CHANGED messages aren't blocked
    self.linkInteracting = false;

    // Determine markup element for persistence
    var baseElement = element.tagName.toLowerCase() === 'a' ? parentElementForSelection : element;
    var baseKey = baseElement.getAttribute('data-key') || key;
    var markup = self.resolveMarkupTarget(baseElement, baseKey);

    self.sendToParent({
      type: 'MARKUP_CHANGED',
      payload: { key: markup.key, innerHTML: self.sanitizeLinkHtml(markup.element.innerHTML) }
    });

    // Store reference for async callback (element may be re-rendered)
    var selectElement = parentElementForSelection;

    self.scanThen(function() {
      var clickPayload = self.buildElementPayload(selectElement, {
        isDoubleClick: false,
        hasChildren: false,
        isDirectSelect: true,
        isOutsideContext: false,
        computedStyles: false
      });
      self.sendToParent({ type: 'ELEMENT_CLICK', payload: clickPayload });
    });
  };


  
  // Interpolated from bridge/globalShortcuts.ts — THE one list of bare-key
  // editor shortcuts. Never hardcode keys here; add them there.
  var SQ_BARE_SHORTCUT_KEYS = ["v","a","t","r","o","l","p","1","2","3","4","5","6"];
  var SQ_SHIFTED_SHORTCUT_CODE = "Digit1";
  var SQ_COMBO_SHORTCUT_KEYS = ["s","k","g","z","y","j","c","x","v","d","0","=","+","-","_"];
  // bridge/shortcutKey.js verbatim: the frame reads a key exactly as the editor does.
  var sqShortcutKey = function shortcutKey(e) {
  var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key.length !== 1 || /[a-z0-9]/.test(key) || e.altKey) return key;
  var digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return digit[1];
  var letter = /^Key([A-Z])$/.exec(e.code);
  return letter && key.charCodeAt(0) > 127 ? letter[1].toLowerCase() : key;
};

  IFrameBridge.prototype.setupEventListeners = function() {
    this.boundHandlers = {
      mousedown: this.handleMouseDown.bind(this),
      mouseup: this.handleMouseUp.bind(this),
      mousemove: this.handleMouseMove.bind(this),
      mouseleave: this.handleMouseLeave.bind(this),
      click: this.handleNativeClick.bind(this),
      wheel: this.handleWheel.bind(this),
      keydown: this.handleKeyDown.bind(this),
      dragover: this.handleFileDragOver.bind(this),
      drop: this.handleFileDrop.bind(this)
    };

    if (this.mode === 'design') {
      this.addDesignModeListeners();
    }
  };

  IFrameBridge.prototype.handleKeyDown = function(event) {
    // Handle Escape to cancel flow drag
    if (event.key === 'Escape' && this._flowDrag._state) {
      this._flowDrag.handleCancel();
      event.preventDefault();
      return;
    }
    // Handle Escape to exit text edit mode
    if (event.key === 'Escape' && this.editingElement) {
      this.exitEditModeCleanup();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Focus inside this (cross-origin) iframe means the PARENT's document
    // keydown listener never fires — this relay is the only way an editor
    // shortcut survives. Forward by rule for modifier combos and control keys;
    // bare letters/digits need the explicit allowlist, because they are
    // otherwise indistinguishable from the user typing on the real page.
    var hasModifier = event.metaKey || event.ctrlKey;
    var isForwardableKey = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete'].indexOf(event.key) !== -1;
    var isBareShortcut = !hasModifier && !event.shiftKey && !event.altKey &&
      SQ_BARE_SHORTCUT_KEYS.indexOf(sqShortcutKey(event)) !== -1;
    // Shift+1 (zoom to fit) is the one SHIFTED bare shortcut; shifted Digit1
    // reports key '!' so it has to be matched on event.code.
    var isShiftedShortcut = !hasModifier && event.shiftKey && !event.altKey &&
      event.code === SQ_SHIFTED_SHORTCUT_CODE;

    if (!hasModifier && !isForwardableKey && !isBareShortcut && !isShiftedShortcut) return;

    // Text entry inside the preview keeps its keystrokes — a shortcut letter is
    // just a character to a form field, and swallowing it here would break
    // typing on the real page (and in-place text editing).
    var target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable)) {
      return;
    }

    this.sendToParent({
      type: 'KEYBOARD_EVENT',
      payload: {
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey
      }
    });

    // Prevent default for forwardable keys and the combos the editor handles;
    // any other combo (⌘W, ⌘Q, ⌘M, ⌘,) still reaches the app menu.
    if (isForwardableKey || (hasModifier && SQ_COMBO_SHORTCUT_KEYS.indexOf(sqShortcutKey(event)) !== -1)) {
      event.preventDefault();
    }
  };

  IFrameBridge.prototype.addDesignModeListeners = function() {
    if (this.listenersActive) return;
    this.listenersActive = true;
    this.toggleDesignModeListeners(true);
  };

  IFrameBridge.prototype.removeDesignModeListeners = function() {
    if (!this.listenersActive) return;
    this.listenersActive = false;
    this.toggleDesignModeListeners(false);
  };

  // ── Preview mode (task-116) ────────────────────────────
  // Design mode intercepts everything (click/hover/drag/wheel); preview drops
  // every one of those listeners so the page behaves natively, and swaps in a
  // single link listener. Repeat sends are a no-op — the parent re-sends
  // SET_MODE on every IFRAME_READY, which fires on each HMR full-reload.
  IFrameBridge.prototype.handleSetMode = function(payload) {
    var newMode = (payload && payload.mode) || 'design';
    // Design viewport height rides SET_MODE: one message says what mode the
    // frame is in AND what a vh means there (vh-pin.ts). A breakpoint change
    // re-sends with the same mode and a new height.
    var height = payload && payload.designViewportHeight;
    var validHeight = typeof height === 'number' && isFinite(height) && height > 0;
    if (newMode !== this.mode) {
      this.mode = newMode;
      if (this.mode === 'design') {
        this.addDesignModeListeners();
        this.removePreviewListeners();
      } else {
        this.removeDesignModeListeners();
        this.addPreviewListeners();
      }
      this.updateDesignModeStyles();
    }
    if (this.mode !== 'design') { this.unpinDesignViewport(); return; }
    if (validHeight) this.pinDesignViewport(height);
  };

  IFrameBridge.prototype.addPreviewListeners = function() {
    if (this.previewListenersActive) return;
    this.previewListenersActive = true;
    if (!this.boundPreviewNavClick) {
      this.boundPreviewNavClick = this.handlePreviewLinkClick.bind(this);
    }
    if (!this.boundPreviewKeyDown) {
      this.boundPreviewKeyDown = this.handlePreviewKeyDown.bind(this);
    }
    document.addEventListener('click', this.boundPreviewNavClick, true);
    document.addEventListener('keydown', this.boundPreviewKeyDown, true);
  };

  IFrameBridge.prototype.removePreviewListeners = function() {
    if (!this.previewListenersActive) return;
    this.previewListenersActive = false;
    document.removeEventListener('click', this.boundPreviewNavClick, true);
    document.removeEventListener('keydown', this.boundPreviewKeyDown, true);
  };

  /**
   * Esc is preview's escape hatch — but the moment the user clicks anything
   * (the whole point of preview) the focus is INSIDE this iframe, so the
   * editor's own document-level keydown listener never sees the key. Confirmed
   * live: document.activeElement in the parent becomes the IFRAME.
   *
   * Forward Escape and NOTHING else (preview is read-only) over the existing
   * KEYBOARD_EVENT channel, which the parent re-dispatches on its own document.
   */
  IFrameBridge.prototype.handlePreviewKeyDown = function(event) {
    if (event.key !== 'Escape') return;
    this.sendToParent({
      type: 'KEYBOARD_EVENT',
      payload: {
        key: 'Escape',
        code: 'Escape',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false
      }
    });
  };

  /**
   * Internal links carry the PUBLISHED href ('/' or '/slug' — see pageHref in
   * utils/slugify.ts), but this iframe is served at /preview/{projectId}/{pageId}
   * and no such route exists. Letting the click through would 404 the iframe and
   * take the bridge with it, so the parent resolves the href to a page instead.
   * Everything genuinely external stays native.
   */
  IFrameBridge.prototype.handlePreviewLinkClick = function(event) {
    // task-132 local mode: the iframe serves REAL routes — let the browser
    // (or the site's own router) navigate natively (nothing below prevents the
    // default there). But the editor must FOLLOW the navigation (parity gap
    // 25/58: the doc kept naming the old page, so the task-133 wrong-file
    // guard refused every structural op until a manual page click) — so an
    // internal link still sends the SAME PREVIEW_NAVIGATE announce WC uses,
    // and the parent maps the route to the doc page and selects it.
    var isLocal = !!window.__SQ_LOCAL_MODE__;
    var link = this.findClosestLink(event.target);
    if (!link) return;

    // Blog-card post links: the card's <a> href points at the published post
    // route ('/blog/posts/slug'), which findPageByHref cannot match (posts
    // are slug-driven). Send slug + slot key instead so the parent opens the
    // designed post page. Anchor-gated: postLinkMode 'none' renders bare
    // cards (no <a>) and correctly stays inert. WC only — a LOCAL blog card
    // points at a real route the site serves itself, so it falls through to
    // the generic internal-link announce below.
    if (!isLocal && link.hasAttribute('data-sq-post-slug')) {
      var postsWrapper = link.closest('[data-blog-source="posts"], [data-key$=":posts"]');
      // Both wrapper key shapes ('<slotId>:div-N' / '<slotId>:posts') carry
      // the slot id as their first segment.
      var wrapperKey = postsWrapper && postsWrapper.getAttribute('data-key');
      var slotKey = wrapperKey ? wrapperKey.split(':')[0] : null;
      if (slotKey) {
        event.preventDefault();
        this.sendToParent({
          type: 'PREVIEW_NAVIGATE',
          payload: { postSlug: link.getAttribute('data-sq-post-slug'), slotKey: slotKey }
        });
        return;
      }
    }
    if (link.target && link.target !== '_self') return;   // new tab/window
    if (link.hasAttribute('download')) return;

    var raw = link.getAttribute('href');
    if (!raw) return;
    if (raw.charAt(0) === '#') return;                    // in-page anchor: native scroll (D1)

    var url;
    try { url = new URL(link.href); } catch (e) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;  // mailto:, tel:
    if (url.origin !== window.location.origin) return;                 // cross-origin

    // Local: announce only — the navigation itself stays native (files-truth,
    // task-132). WC: block the click, or the iframe 404s off the bare shell.
    if (!isLocal) event.preventDefault();
    // pathname, not the raw attribute: drops a cross-page '#anchor' suffix that
    // would otherwise miss the parent's matcher. The anchor scroll is lost.
    this.sendToParent({ type: 'PREVIEW_NAVIGATE', payload: { href: url.pathname } });
  };

  IFrameBridge.prototype.handleNativeClick = function(event) {
    var target = this.findEditableElement(event.target, true);
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  IFrameBridge.prototype.handleMouseDown = function(event) {
    // Outside text editing a double-click selects or edits elements, never words (audit #40).
    if (event.detail > 1 && !this.editingElement) event.preventDefault();
    this.mouseDownTarget = event.target;
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
    this.isDragging = false;
  };

  IFrameBridge.prototype.handleMouseUp = function(event) {
    var dx = Math.abs(event.clientX - this.mouseDownPos.x);
    var dy = Math.abs(event.clientY - this.mouseDownPos.y);
    var isClick = dx < CLICK_MOVE_THRESHOLD_PX && dy < CLICK_MOVE_THRESHOLD_PX;

    if (isClick && !this.isDragging) {
      this.handleClick(event);
    }

    this.isDragging = false;
    this.mouseDownTarget = null;
  };

  IFrameBridge.prototype.handleWheel = function(event) {
    // task-132 local mode: the iframe IS a real scrollable viewport (fixed
    // device height; vh sites need it). Plain wheel scrolls the page
    // natively; only zoom gestures (ctrl/meta) forward to the canvas.
    if (window.__SQ_LOCAL_MODE__ && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // task-120 (5.3): wheel events outpace paint — accumulate deltas and
    // flush ONE message per animation frame (position/modifiers = latest).
    var self = this;
    if (!this._wheelAccum) {
      this._wheelAccum = { deltaX: 0, deltaY: 0 };
    }
    this._wheelAccum.deltaX += event.deltaX;
    this._wheelAccum.deltaY += event.deltaY;
    this._wheelAccum.clientX = event.clientX;
    this._wheelAccum.clientY = event.clientY;
    this._wheelAccum.ctrlKey = event.ctrlKey;
    this._wheelAccum.metaKey = event.metaKey;
    if (this._wheelRaf) return;
    this._wheelRaf = requestAnimationFrame(function() {
      self._wheelRaf = 0;
      var acc = self._wheelAccum;
      self._wheelAccum = null;
      if (!acc) return;
      self.sendToParent({
        type: 'WHEEL',
        payload: {
          deltaX: acc.deltaX,
          deltaY: acc.deltaY,
          clientX: acc.clientX,
          clientY: acc.clientY,
          ctrlKey: acc.ctrlKey,
          metaKey: acc.metaKey
        }
      });
    });
  };

  IFrameBridge.prototype.handleClick = function(event) {
    try {
      if (this._blogCardKeysDirty) {
        this._ensureBlogCardKeys();
      }

      // Prevent link navigation in design mode
      if (this.preventLinkNavigation(event.target)) {
        event.preventDefault();
      }

      // Clicked outside editing element - exit edit mode (unless within grace period)
      if (this.editingElement && event.target !== this.editingElement && !this.editingElement.contains(event.target) && Date.now() > this._editGraceUntil) {
        this.exitEditModeCleanup();
      }

      // Handle clicks within editing element
      if (this.editingElement && (event.target === this.editingElement || this.editingElement.contains(event.target))) {
        // Only set cursor for single clicks; multi-clicks use native selection
        if (event.detail === 1) {
          this.setCaretAtPoint(event.clientX, event.clientY);
        }
        return;
      }

      // A ⌘D copy painted before its write lands has no real key for ~70 ms;
      // selecting it pinned a temporary key every later edit refused ("not
      // saved", 2026-11-08). Ignore the click — the pending selection moves
      // to the copy the moment its key lands.
      if (event.target && event.target.closest && event.target.closest('[data-sq-predicted]')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      var isDirectSelect = event.metaKey || event.ctrlKey;
      var isShift = !!event.shiftKey; // multi-select toggle: the host decides, the bridge never drills
      var blogCtx = this._resolveBlogClickContext(event.target);

      var target = this.findEditableElement(blogCtx.resolvedTarget, true, isDirectSelect);
      if (!target) return;

      var key = this.getElementKey(target);
      if (!key) return;

      event.preventDefault();
      event.stopPropagation();

      var now = Date.now();
      var isDoubleClick = (key === this.lastClickKey) && (now - this.lastClickTime < DOUBLE_CLICK_THRESHOLD_MS);
      this.lastClickKey = key;
      this.lastClickTime = now;

      var hasChildren = this.hasBlockChildren(target);

      // Double-click with children: drill down AND select child under cursor
      if (isDoubleClick && hasChildren && !isDirectSelect && !isShift) {
        if (this.handleDrillDown(event, target, key)) {
          // Reset so the next click is a fresh single-click — prevents rapid
          // tapping on the same area from chain-drilling slot → :posts → :post-link.
          this.lastClickKey = null;
          this.lastClickTime = 0;
          return;
        }
      }

      var payload = this.buildElementPayload(target, {
        isDoubleClick: isDoubleClick,
        isDirectSelect: isDirectSelect,
        isOutsideContext: this.isClickOutsideContext(target, key),
        altKey: event.altKey,
        shiftKey: isShift
      }, { rawTarget: event.target, clickedCardWrapper: blogCtx.clickedCardWrapper });

      this.sendToParent({ type: 'ELEMENT_CLICK', payload: payload });

      // Async: capture bg image preview and send as follow-up message
      this.captureAndSendBgImagePreview(target, key);
    } catch (error) {
      console.error('[IFrameBridge] handleClick error:', error);
    }
  };

  IFrameBridge.prototype.handleMouseMove = function(event) {
    if (this.mouseDownTarget && event.buttons > 0) {
      var dx = Math.abs(event.clientX - this.mouseDownPos.x);
      var dy = Math.abs(event.clientY - this.mouseDownPos.y);
      if (dx > DRAG_START_THRESHOLD_PX || dy > DRAG_START_THRESHOLD_PX) {
        this.isDragging = true;
      }
    }

    if (this.isDragging || event.buttons > 0) return;

    if (this.throttledHover) return;
    var self = this;
    this.throttledHover = setTimeout(function() { self.throttledHover = null; }, HOVER_THROTTLE_MS);

    var target = this.findEditableElement(event.target, true);
    if (!target) {
      if (this.lastHoveredKey) {
        this.lastHoveredKey = null;
        this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
      }
      return;
    }

    var key = this.getElementKey(target);
    if (!key || key === this.lastHoveredKey) return;

    this.lastHoveredKey = key;
    var parentEl = this.findEditableElement(target.parentElement);
    var parentKey = parentEl ? this.getElementKey(parentEl) : null;

    this.sendToParent({
      type: 'ELEMENT_HOVER',
      payload: {
        key: key,
        tagName: target.tagName.toLowerCase(),
        computedStyles: this.getComputedStyles(target),
        rect: this.rectOf(target),
        parentKey: parentKey
      }
    });
  };

  // ── task-141: direct canvas file drop — no arming step ──────────────────
  // OS file drags never reach handleMouseMove (no mousemove during drag), so
  // dragover reuses the hover-outline pipeline to highlight the drop target.
  IFrameBridge.prototype.handleFileDragOver = function(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    if (!types || Array.prototype.indexOf.call(types, 'Files') === -1) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (this.throttledHover) return;
    var self = this;
    this.throttledHover = setTimeout(function() { self.throttledHover = null; }, HOVER_THROTTLE_MS);

    var target = this.findEditableElement(event.target, true);
    if (!target) {
      if (this.lastHoveredKey) {
        this.lastHoveredKey = null;
        this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
      }
      return;
    }
    var key = this.getElementKey(target);
    if (!key || key === this.lastHoveredKey) return;
    this.lastHoveredKey = key;
    this.sendToParent({
      type: 'ELEMENT_HOVER',
      payload: {
        key: key,
        tagName: target.tagName.toLowerCase(),
        computedStyles: this.getComputedStyles(target),
        rect: this.rectOf(target),
        parentKey: null
      }
    });
  };

  IFrameBridge.prototype.handleFileDrop = function(event) {
    var dt = event.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.lastHoveredKey) {
      this.lastHoveredKey = null;
      this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
    }
    // directSelect: a file drop applies to the element UNDER THE CURSOR —
    // outermost-ancestor resolution made every drop target the page root,
    // so imgs (incl. content-bound astro <Image>) were unreachable (task-142).
    var target = this.findEditableElement(event.target, true, true);
    var payload = null;
    if (target) {
      payload = this.buildElementPayload(target, { computedStyles: true });
      // <a> ancestors are not drop targets (design rule 6 exclusion)
      payload.insideAnchor = !!(target.closest && target.closest('a'));
    }
    // File objects survive postMessage via structured clone
    this.sendToParent({
      type: 'CANVAS_FILE_DROP',
      payload: { target: payload, files: Array.prototype.slice.call(dt.files) }
    });
  };

  IFrameBridge.prototype.handleMouseLeave = function() {
    // If a flow drag is active, don't kill the drag — it may be
    // exiting for reparent mode or layers panel handoff
    if (this._flowDrag && this._flowDrag._state) {
      // Hide ghost — it's now outside the iframe
      if (this._flowDrag._state.ghost) {
        this._flowDrag._state.ghost.style.display = 'none';
      }
      this._flowDrag._cleanupIndicators();
      this.sendToParent({
        type: 'DRAG_ELEMENT_EXIT_IFRAME',
        payload: { key: this._flowDrag._state.key }
      });
      // Still clear hover state
      if (this.lastHoveredKey) {
        this.lastHoveredKey = null;
        this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
      }
      return;
    }
    this.isDragging = false;
    this.mouseDownTarget = null;
    if (this.lastHoveredKey) {
      this.lastHoveredKey = null;
      this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
    }
  };


  

/** task-120: cheap content hash — byteLength + folded first/last 64 bytes.
 *  ponytail: not collision-proof; upgrade to SHA-1 via crypto.subtle if two
 *  real assets ever share length AND boundary bytes. */
IFrameBridge.prototype._hashAssetBytes = function(arrayBuffer) {
    var view = new Uint8Array(arrayBuffer);
    var h = 5381;
    var n = view.length;
    for (var i = 0; i < Math.min(64, n); i++) h = ((h << 5) + h + view[i]) | 0;
    for (var j = Math.max(0, n - 64); j < n; j++) h = ((h << 5) + h + view[j]) | 0;
    return n + ':' + h;
  };

IFrameBridge.prototype.handleTransferAsset = function(payload) {
    if (!payload || !payload.assetId || !payload.arrayBuffer) return;

    // task-120: stable asset identity. Identical bytes → keep the existing
    // blob URL and skip every rewrite (rehydration double-sends become free).
    // Byte change (re-upload) is the ONLY path that touches URLs.
    this._assetHashes = this._assetHashes || {};
    var hash = this._hashAssetBytes(payload.arrayBuffer);
    var prevUrl = this._assetMap[payload.assetId];
    if (prevUrl && this._assetHashes[payload.assetId] === hash) return;

    var blob = new Blob([payload.arrayBuffer], { type: payload.mimeType || 'application/octet-stream' });
    var blobUrl = URL.createObjectURL(blob);
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    this._assetMap[payload.assetId] = blobUrl;
    this._assetHashes[payload.assetId] = hash;

    // Inject/update CSS overrides for sq-asset: class selectors → blob URLs
    // This survives HMR re-renders (Tailwind CDN generates CSS with raw sq-asset: URLs,
    // so we need !important overrides that persist regardless of DOM mutations)
    this.updateAssetStyleSheet();

    // Fonts stylesheet may hold unresolved sq-asset: refs for this asset
    this.updateFontsStyleSheet();

    // Re-apply any class updates that had unresolved sq-asset: refs
    var pending = this._pendingAssetClasses;
    var keys = Object.keys(pending);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var p = pending[key];
      if (p.classes.indexOf('sq-asset:' + payload.assetId) !== -1) {
        // The apply core, not the gated entry: replaying a stored payload must neither create nor refresh a hold.
        this.applyClassCore(p);
        delete pending[key];
      }
    }

    // Also re-apply any pending image attribute updates
    var pendingImg = this._pendingAssetImages;
    if (pendingImg) {
      var imgKeys = Object.keys(pendingImg);
      for (var j = 0; j < imgKeys.length; j++) {
        var imgKey = imgKeys[j];
        var imgPayload = pendingImg[imgKey];
        if (imgPayload.value.indexOf('sq-asset:' + payload.assetId) !== -1) {
          this.handleUpdateImageAttribute(imgPayload);
          delete pendingImg[imgKey];
        }
      }
    }

    // Also fix img src and inline styles in the DOM
    this.resolveAssetRefsInDOM();
  };

IFrameBridge.prototype.resolveAssetRef = function(value) {
    if (!value || typeof value !== 'string') return value;
    if (value.indexOf('sq-asset:') !== 0) return value;
    var assetId = value.slice(9); // "sq-asset:".length === 9
    return this._assetMap[assetId] || value;
  };

IFrameBridge.prototype.resolveAssetRefs = function(str) {
    if (!str || typeof str !== 'string') return str;
    if (str.indexOf('sq-asset:') === -1) return str;
    var self = this;
    return str.replace(/sq-asset:([a-f0-9-]+)/g, function(match, assetId) {
      return self._assetMap[assetId] || match;
    });
  };

IFrameBridge.prototype.resolveAssetRefsInDOM = function() {
    if (Object.keys(this._assetMap).length === 0) return;
    var self = this;
    // Scan ALL elements — after HMR re-render, elements may lack data-key/data-sq-source
    var allElements = document.body.querySelectorAll('*');
    for (var i = 0; i < allElements.length; i++) {
      var el = allElements[i];

      // Check classes for sq-asset: refs
      var classes = el.className;
      if (typeof classes === 'string' && classes.indexOf('sq-asset:') !== -1) {
        // className stays canonical — resolution is applied via inline style
        // + the #sq-asset-overrides stylesheet only (blob-poisoning fix)
        var resolved = self.resolveAssetRefs(classes);
        var bgMatch = resolved.match(/bg-\[url\(['"]?(.+?)['"]?\)\]/);
        if (bgMatch && bgMatch[1].indexOf('sq-asset:') === -1) {
          el.style.backgroundImage = "url('" + bgMatch[1] + "')";
        }
      }

      // Check img/video src for sq-asset: refs
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
        var src = el.getAttribute('src');
        if (src && src.indexOf('sq-asset:') === 0) {
          var resolvedSrc = self.resolveAssetRef(src);
          if (resolvedSrc !== src) {
            el.src = resolvedSrc;
          }
        }
      }

      // Check inline style for sq-asset: refs (e.g. background-image)
      var bgStyle = el.style.backgroundImage;
      if (bgStyle && bgStyle.indexOf('sq-asset:') !== -1) {
        var resolvedBg = bgStyle.replace(/sq-asset:([a-f0-9-]+)/g, function(match, id) {
          return self._assetMap[id] || match;
        });
        if (resolvedBg !== bgStyle) {
          el.style.backgroundImage = resolvedBg;
        }
      }
    }
  };

IFrameBridge.prototype.updateAssetStyleSheet = function() {
    var styleId = 'sq-asset-overrides';
    var style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.head.appendChild(style);
    }

    var rules = [];
    var assetIds = Object.keys(this._assetMap);
    for (var i = 0; i < assetIds.length; i++) {
      var assetId = assetIds[i];
      var blobUrl = this._assetMap[assetId];
      // Escape the selector: bg-[url('sq-asset:xxx')] → .bg-\[url\(\'sq-asset\:xxx\'\)\]
      var escaped = 'bg-\\[url\\(\\\'sq-asset\\:' + assetId + '\\\'\\)\\]';
      rules.push('.' + escaped + ' { background-image: url(\'' + blobUrl + '\') !important; }');
    }

    style.textContent = rules.join('\n');
  };


  

IFrameBridge.prototype.handleSetFontsCss = function(payload) {
    if (!payload || typeof payload.css !== 'string') return;
    this._fontsCssRaw = payload.css;
    this.updateFontsStyleSheet();
  };

IFrameBridge.prototype.updateFontsStyleSheet = function() {
    if (typeof this._fontsCssRaw !== 'string' || !this._fontsCssRaw) return;
    var resolved = this.resolveAssetRefs(this._fontsCssRaw);
    var style = document.getElementById('sq-fonts');
    // task-120: re-assigning identical CSS makes the browser re-evaluate
    // @font-face and can re-flash fonts (FOUT). Skip when unchanged.
    if (style && this._lastFontsCss === resolved) return;
    if (!style) {
      style = document.createElement('style');
      style.id = 'sq-fonts';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = resolved;
    this._lastFontsCss = resolved;
  };


  

IFrameBridge.prototype._cardContentRoot = function(wrapper) {
    if (!wrapper) return null;
    return wrapper.tagName === 'A' ? wrapper.firstElementChild : wrapper;
  };

IFrameBridge.prototype._ensureBlogCardKeys = function() {
    if (!this._blogCardInfo || this._blogCardInfo.length === 0) return;

    var anyFixed = false;

    for (var i = 0; i < this._blogCardInfo.length; i++) {
      var info = this._blogCardInfo[i];

      var postsWrapper = this.findElementByKey(info.postsWrapperKey);

      // Fallback: find by structure (after HMR, data-key on drawn elements may be lost)
      if (!postsWrapper) {
        var slotEl = this.findElementByKey(info.slotKey);
        if (!slotEl) {
          var blogSlots = document.querySelectorAll('[data-slot-type="blog"]');
          for (var bs = 0; bs < blogSlots.length; bs++) {
            var bsKey = blogSlots[bs].getAttribute('data-key');
            if (bsKey === info.slotKey || (!bsKey && blogSlots.length === 1)) {
              slotEl = blogSlots[bs];
              if (!bsKey) slotEl.setAttribute('data-key', info.slotKey);
              break;
            }
          }
        }
        if (slotEl) {
          var slotChildren = slotEl.children;
          for (var sc = 0; sc < slotChildren.length; sc++) {
            var child = slotChildren[sc];
            if (child.tagName && child.tagName.toLowerCase() === 'div') {
              if (child.children.length > 0) {
                postsWrapper = child;
                var pwKey = child.getAttribute('data-key');
                if (!pwKey || pwKey.indexOf('dynamic:') === 0) {
                  child.setAttribute('data-key', info.postsWrapperKey);
                }
                break;
              }
            }
          }
        }
      }

      if (!postsWrapper) continue;

      var pwCurrentKey = postsWrapper.getAttribute('data-key');
      if (!pwCurrentKey || pwCurrentKey.indexOf('dynamic:') === 0) {
        postsWrapper.setAttribute('data-key', info.postsWrapperKey);
      }

      var firstChild = postsWrapper.firstElementChild;
      if (!firstChild) continue;

      var cardRoot;
      var firstChildTag = firstChild.tagName ? firstChild.tagName.toLowerCase() : '';

      if (firstChildTag === 'a') {
        var anchorKey = info.slotKey + ':post-link';
        var currentAnchorKey = firstChild.getAttribute('data-key');
        if (!currentAnchorKey || currentAnchorKey.indexOf('dynamic:') === 0) {
          firstChild.setAttribute('data-key', anchorKey);
        }
        cardRoot = firstChild.firstElementChild;
      } else if (firstChildTag === 'div' && firstChild.style && firstChild.style.cssText.indexOf('align-items:center') !== -1) {
        continue;
      } else {
        cardRoot = firstChild;
      }

      if (!cardRoot) continue;

      var tagCounts = {};
      var elements = [cardRoot];
      var descendants = cardRoot.querySelectorAll('*');
      for (var d = 0; d < descendants.length; d++) {
        elements.push(descendants[d]);
      }

      for (var j = 0; j < elements.length; j++) {
        var el = elements[j];
        var tag = el.tagName.toLowerCase();
        if (MARKUP_SKIP_TAGS.indexOf(tag) !== -1) continue;

        var index = tagCounts[tag] || 0;
        tagCounts[tag] = index + 1;

        var expectedKey = info.cardElementId + ':' + tag + '-' + index;
        var currentKey = el.getAttribute('data-key');

        if (!currentKey || currentKey.indexOf('dynamic:') === 0) {
          el.setAttribute('data-key', expectedKey);
          anyFixed = true;
        }
      }
    }

    if (!anyFixed) {
      this._blogCardKeysDirty = false;
    }
  };

IFrameBridge.prototype._findCardWrapperUnder = function(element, postsWrapper) {
    var slot = null;
    var children = postsWrapper.children;
    for (var c = 0; c < children.length; c++) {
      if (children[c].tagName === 'SLOT') { slot = children[c]; break; }
    }
    var container = slot || postsWrapper;
    var w = element;
    while (w && w.parentElement !== container) w = w.parentElement;
    return w || null;
  };

IFrameBridge.prototype._findClickedCardWrapper = function(rawTarget, ctx) {
    if (!rawTarget) return null;
    var el = rawTarget.nodeType === 1 ? rawTarget : rawTarget.parentElement;
    if (!el) return null;
    ctx = ctx || this._findPostsWrapperAncestor(el);
    if (!ctx) return null;
    return this._findCardWrapperUnder(el, ctx.postsWrapper);
  };

IFrameBridge.prototype._findPostsWrapperAncestor = function(element) {
    if (!element) return null;
    var cur = element.nodeType === 1 ? element : element.parentElement;
    while (cur && cur !== document.body) {
      var ck = cur.getAttribute('data-key');
      // Legacy drawn-slot path: posts wrapper is registered via
      // `_blogCardInfo`. Match exactly so legacy slots keep working.
      if (ck && this._blogCardInfo && this._blogCardInfo.length > 0) {
        for (var i = 0; i < this._blogCardInfo.length; i++) {
          if (ck === this._blogCardInfo[i].postsWrapperKey) {
            return { postsWrapper: cur, blogInfo: this._blogCardInfo[i] };
          }
        }
      }
      // Regular-instance path (task-028): the wrapper carries
      // `data-blog-source="posts"`. The first child of that wrapper IS the
      // real BlogCard instance — its data-key prefix is the cardElementId.
      // We synthesise a blogInfo on the fly so downstream redirect logic
      // (_resolveToFirstBlogCard, _resolveBlogClickContext) keeps working
      // without depending on _blogCardInfo bookkeeping.
      if (cur.getAttribute && cur.getAttribute('data-blog-source') === 'posts') {
        // Descend <slot> levels AND the injected post-link <a> — the card's
        // key prefix is the cardElementId; the anchor's is the slot id.
        var firstCard = cur.firstElementChild;
        while (firstCard && (firstCard.tagName === 'SLOT' || firstCard.tagName === 'A')) {
          firstCard = firstCard.firstElementChild;
        }
        if (firstCard) {
          var firstKey = firstCard.getAttribute('data-key') || '';
          var cardElementId = firstKey.split(':')[0];
          if (cardElementId && firstKey.indexOf('dynamic:') !== 0) {
            return {
              postsWrapper: cur,
              // slotKey must be the SLOT INSTANCE id (post-link redirect
              // builds '<slotKey>:post-link'), not the wrapper's full key.
              blogInfo: { cardElementId: cardElementId, slotKey: (ck || '').split(':')[0] },
            };
          }
        }
      }
      cur = cur.parentElement;
    }
    return null;
  };

IFrameBridge.prototype._getCardTagIndex = function(element, cardRoot) {
    var tag = element.tagName.toLowerCase();
    if (MARKUP_SKIP_TAGS.indexOf(tag) !== -1) return -1;

    var allInCard = [cardRoot];
    var desc = cardRoot.querySelectorAll('*');
    for (var d = 0; d < desc.length; d++) allInCard.push(desc[d]);

    var tagIndex = 0;
    for (var j = 0; j < allInCard.length; j++) {
      var cur = allInCard[j];
      if (cur === element) return tagIndex;
      if (cur.tagName.toLowerCase() === tag && MARKUP_SKIP_TAGS.indexOf(cur.tagName.toLowerCase()) === -1) {
        tagIndex++;
      }
    }
    return -1;
  };

IFrameBridge.prototype._mapFirstCardElementToClickedCard = function(firstCardEl, clickedCardWrapper) {
    if (!firstCardEl || !clickedCardWrapper) return null;

    var postsWrapper = clickedCardWrapper.parentElement;
    if (!postsWrapper) return null;
    var firstWrapper = postsWrapper.firstElementChild;
    if (!firstWrapper || firstWrapper === clickedCardWrapper) return null;

    // Wrapping anchor case — both wrappers are the equivalent element.
    if (firstCardEl === firstWrapper) return clickedCardWrapper;

    var firstRoot = this._cardContentRoot(firstWrapper);
    var clickedRoot = this._cardContentRoot(clickedCardWrapper);
    if (!firstRoot || !clickedRoot) return null;
    if (firstCardEl === firstRoot) return clickedRoot;

    var idx = this._getCardTagIndex(firstCardEl, firstRoot);
    if (idx < 0) return null;

    // _getCardTagIndex counts root + descendants, so include clickedRoot when its tag matches.
    var tag = firstCardEl.tagName.toLowerCase();
    if (MARKUP_SKIP_TAGS.indexOf(tag) !== -1) return null;
    var desc = clickedRoot.querySelectorAll(tag);
    var match = clickedRoot.tagName.toLowerCase() === tag ? clickedRoot : null;
    if (match && idx === 0) return match;
    var skipFirst = match ? 1 : 0;
    return desc[idx - skipFirst] || null;
  };

IFrameBridge.prototype._resolveBlogClickContext = function(rawTarget) {
    var ctx = this._findPostsWrapperAncestor(rawTarget);
    if (!ctx) return { clickedCardWrapper: null, resolvedTarget: rawTarget };
    var clickedCardWrapper = this._findClickedCardWrapper(rawTarget, ctx);
    var redirected = this._resolveToFirstBlogCard(rawTarget, ctx);
    return {
      clickedCardWrapper: clickedCardWrapper,
      resolvedTarget: redirected ? redirected.element : rawTarget
    };
  };

IFrameBridge.prototype._resolveToFirstBlogCard = function(element, ctx) {
    if (element && element.nodeType !== 1) element = element.parentElement;
    if (!element) return null;
    ctx = ctx || this._findPostsWrapperAncestor(element);
    if (!ctx) return null;

    // Already-keyed (non-dynamic) elements are first-card / source-tracked — no redirect needed.
    var existingKey = element.getAttribute('data-key');
    if (existingKey && existingKey.indexOf('dynamic:') !== 0) return null;

    var cardWrapper = this._findCardWrapperUnder(element, ctx.postsWrapper);
    if (!cardWrapper) return null;
    // First-card protection: a real (non-dynamic) data-key on the card
    // wrapper means it IS the first card — already the source of truth,
    // no redirect needed. Complements the click-target check above.
    var wrapperKey = cardWrapper.getAttribute('data-key');
    if (wrapperKey && wrapperKey.indexOf('dynamic:') !== 0) return null;

    // User clicked the wrapping <a> of a non-first card. Only the first card's
    // anchor has data-key (slotKey + ':post-link'); redirect there so Yjs
    // lookups, isInsideBlogSlot and LinkBlock visibility resolve consistently.
    if (element === cardWrapper && cardWrapper.tagName === 'A') {
      var postLinkKey = ctx.blogInfo.slotKey + ':post-link';
      var firstAnchor = this.findElementByKey(postLinkKey);
      return firstAnchor ? { element: firstAnchor, key: postLinkKey } : null;
    }

    var cardRoot = this._cardContentRoot(cardWrapper);
    if (!cardRoot) return null;

    var tagIndex = this._getCardTagIndex(element, cardRoot);
    if (tagIndex < 0) return null;

    var firstCardKey = ctx.blogInfo.cardElementId + ':' + element.tagName.toLowerCase() + '-' + tagIndex;
    var firstCardEl = this.findElementByKey(firstCardKey);
    return firstCardEl ? { element: firstCardEl, key: firstCardKey } : null;
  };



  

IFrameBridge.prototype.applySelectionHighlight = function() {
    this.removeSelectionHighlight();

    var saved = this.savedSelectionRange;
    if (!saved || !saved.key) return;

    var element = this.findElementByKey(saved.key);
    if (!element) return;

    var range = this.reconstructRangeFromSaved(saved, element);
    if (!range) return;

    this.createSelectionOverlay(range.getBoundingClientRect());
  };

IFrameBridge.prototype.removeSelectionHighlight = function() {
    // Remove all highlight overlays (in case multiple were created)
    var overlays = document.querySelectorAll('[data-sq-selection-highlight]');
    overlays.forEach(function(overlay) {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
    this.selectionHighlightElement = null;
  };

IFrameBridge.prototype.clearHighlightElement = function() {
    var overlays = document.querySelectorAll('[data-sq-ai-highlight]');
    overlays.forEach(function(overlay) {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    });
    this._aiHighlightOverlay = null;
  };

IFrameBridge.prototype.createSelectionOverlay = function(rect) {
    if (!rect || rect.width === 0 || rect.height === 0) return;

    var overlay = document.createElement('div');
    overlay.setAttribute('data-sq-selection-highlight', 'true');
    overlay.style.cssText = [
      'position: fixed',
      'pointer-events: none',
      'background-color: rgba(59, 130, 246, 0.3)',
      'border-radius: 2px',
      'z-index: 999999',
      'top: ' + rect.top + 'px',
      'left: ' + rect.left + 'px',
      'width: ' + rect.width + 'px',
      'height: ' + rect.height + 'px'
    ].join(';');

    document.body.appendChild(overlay);
    this.selectionHighlightElement = overlay;
  };

IFrameBridge.prototype.handleHighlightElement = function(payload) {
    this.clearHighlightElement();
    if (!payload || !payload.key) return;

    var element = this.findElementByKey(payload.key);
    if (!element) return;

    var rect = element.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    var overlay = document.createElement('div');
    overlay.setAttribute('data-sq-ai-highlight', 'true');
    overlay.style.cssText = [
      'position: fixed',
      'pointer-events: none',
      'top: ' + rect.top + 'px',
      'left: ' + rect.left + 'px',
      'width: ' + rect.width + 'px',
      'height: ' + rect.height + 'px',
      'border: 2px solid #a855f7',
      'background: rgba(168, 85, 247, 0.08)',
      'z-index: 999999',
      'box-sizing: border-box',
      'border-radius: 4px',
      'transition: opacity 0.15s ease'
    ].join(';');

    document.body.appendChild(overlay);
    this._aiHighlightOverlay = overlay;
  };

  // AI-activity styles, shared by the highlight overlays (here) and the
  // commit stagger (dom-updates handleRender). Color knob: --sq-ai-hue.
  IFrameBridge.prototype._sqEnsureAIStyles = function() {
    if (document.getElementById('sq-ai-pulse-style')) return;
    var style = document.createElement('style');
    style.id = 'sq-ai-pulse-style';
    style.textContent =
      // Rings live in the canvas (AIGlowRings) — nothing in here draws them.
      // Dissolve-in: 0 opacity + blur → sharp (same language as stream
      // preview .sq-ai-new). appear = highlight-driven (stripped on the next
      // highlight set); stagger = commit-driven one-by-one build.
      '.sq-ai-appear{animation:sq-ai-in 0.5s ease-out both}' +
      '.sq-ai-stagger{animation:sq-ai-in 0.5s ease-out both}' +
      '@keyframes sq-ai-in{from{opacity:0;filter:blur(10px)}to{opacity:1;filter:blur(0)}}' +
      '@media (prefers-reduced-motion: reduce){.sq-ai-appear,.sq-ai-stagger{animation:none}}';
    document.head.appendChild(style);
  };

  // Animate a REAL element with a self-cleaning class. The class MUST come
  // off afterwards: getElementClasses returns raw className, so a leaked
  // sq-ai-* class would be echoed into Yjs by the next click/scan
  // (class-pollution, same family as the blob-poisoning bug). animationend
  // covers the normal path; the timeout covers prefers-reduced-motion
  // (animation:none never fires animationend).
  IFrameBridge.prototype._sqAIAppear = function(el, cls, delayMs) {
    el.classList.add(cls);
    if (delayMs) el.style.animationDelay = delayMs + 'ms';
    var done = function() {
      el.classList.remove(cls);
      el.style.animationDelay = '';
    };
    el.addEventListener('animationend', done, { once: true });
    setTimeout(done, 2500);
  };

IFrameBridge.prototype.handleSetAIActiveHighlights = function(payload) {
    var keys = (payload && payload.keys) || [];

    this._aiActiveKeys = keys;
    // Run-active flag gates the commit stagger. It rides the payload because
    // it CANNOT be inferred from keys: the first commit's RENDER reliably
    // beats the first result-time key dispatch. Fallback (payload without the
    // field, e.g. older senders/tests): infer from keys.
    this._aiRunActive = payload && payload.runActive !== undefined
      ? !!payload.runActive
      : keys.length > 0;

    // Strip stale appear classes so a future re-highlight re-animates.
    // (Remove+re-add in the same tick is never observed by the browser —
    // an element kept in the new set does NOT restart its animation.)
    var appeared = document.querySelectorAll('.sq-ai-appear');
    for (var ap = 0; ap < appeared.length; ap++) {
      appeared[ap].classList.remove('sq-ai-appear');
    }

    if (keys.length === 0) {
      this.sendToParent({ type: 'AI_ACTIVE_RECTS', payload: { rects: [] } });
      return;
    }

    this._sqEnsureAIStyles();
    this._sqSyncAIRects(keys, true);
  };

  // Collect the section rects for a highlight set and hand them to the parent,
  // which draws the rings. doAppear runs the inner-element dissolve — OFF for
  // the RENDER refresh, which only re-measures (re-appearing would restart the
  // animation on every commit). Returns how many keys resolved; a 0-rect
  // (hidden / not-yet-rendered) key counts as unresolved so RENDER retries.
  IFrameBridge.prototype._sqSyncAIRects = function(keys, doAppear) {
    var self = this;
    var rects = [];   // section rings, drawn by the PARENT (see glowRing.ts)
    var stroked = []; // section elements already reported (dedup across keys)
    var resolved = 0;

    // The stroke lives on SECTIONS only. Returns true when the section is
    // reported (now or already), false when its rect is 0x0 (retry later).
    // MUST be the raw border box: rectOf() falls back to the union of the
    // element's CHILDREN when the box measures 0x0, which draws the ring around
    // the CONTENT — visibly inset from the section's real edges (live 2026-07-25).
    function strokeSection(sectionEl, keyLabel) {
      if (stroked.indexOf(sectionEl) !== -1) return true;
      var r = sectionEl.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      rects.push({ key: keyLabel, rect: self.buildRect(r) });
      stroked.push(sectionEl);
      return true;
    }

    for (var k = 0; k < keys.length; k++) {
      var el = self.findElementByKey(keys[k]);
      // Created elements: result.data.elementId is a bare id, but the DOM
      // only carries child keys stamped "<id>:tag-n" (addKeysToMarkup puts
      // no bare id on any node — confirmed via runtime logs, resolved=0 on
      // every created section). Prefix-match the first stamped child.
      if (!el && keys[k].indexOf(':') === -1 && keys[k].indexOf('/') === -1) {
        el = document.querySelector('[data-key^="' + self.escapeCssSelector(keys[k]) + ':"]');
      }
      if (!el) continue;
      var root = self.findRootSection(el);
      if (root !== el) {
        // Inner element: dissolve the element itself AND stroke its
        // enclosing section — "AI grabs this section" while it edits
        // anything inside it. Self-cleaning class (see _sqAIAppear).
        if (doAppear) self._sqAIAppear(el, 'sq-ai-appear', 0);
        resolved++;
        if (root) strokeSection(root, self.getElementKey(root) || keys[k]);
        continue;
      }
      if (strokeSection(el, keys[k])) resolved++;
    }

    // Rects are viewport-relative like every other reported rect: the design
    // iframe is sized to the WHOLE page (no inner scroll), so they are stable
    // document coordinates and the parent needs no scroll sync. RENDER
    // re-measures, which is what keeps them fresh as commits move sections.
    this.sendToParent({ type: 'AI_ACTIVE_RECTS', payload: { rects: rects } });
    return resolved;
  };

IFrameBridge.prototype.handlePickElementAtPoint = function(payload) {
    if (!payload) return;
    var element = document.elementFromPoint(payload.x, payload.y);
    if (!element || element === document.body || element === document.documentElement) return;
    var target = this.findEditableElement(element, true, false) || element;
    var key = this.getElementKey(target);
    if (!key) return;
    var rootSection = this.findRootSection(target);
    this.sendToParent({
      type: 'ELEMENT_PICKED',
      payload: {
        key: key,
        tagName: target.tagName.toLowerCase(),
        classes: this.getElementClasses(target),
        sectionHTML: rootSection.outerHTML
      }
    });
  };


  


/** Text holding elements (<br>, <span>, <strong>…) commits as markup — flat
 *  textContent would drop them (audit #3) — unless a link carrier already owns
 *  this element's markup. Editing is plaintext-only, so the elements are the
 *  ones that were there. */
IFrameBridge.prototype.hasInlineMarkup = function(element) {
    return element.children.length > 0 && !element.querySelector('a');
};

/** Inner markup to commit for such text, bookkeeping attributes stripped;
 *  null = plain text is exact. Rides the same markup channel links use. */
IFrameBridge.prototype.editedInlineMarkup = function(element) {
    return this.hasInlineMarkup(element) ? this.sanitizeLinkHtml(this.cleanClone(element).innerHTML) : null;
};

IFrameBridge.prototype.exitEditModeCleanup = function() {
    if (!this.editingElement) return;
    this._editGraceUntil = 0;

    var element = this.editingElement;
    var editKey = element.getAttribute('data-key') || element.getAttribute('data-sq-source');
    var newText = element.textContent;
    var inlineMarkup = newText !== this.originalTextContent && editKey ? this.editedInlineMarkup(element) : null;

    // Remove event listeners to prevent double-firing
    if (this.editBlurHandler) {
      element.removeEventListener('blur', this.editBlurHandler);
      this.editBlurHandler = null;
    }
    if (element._selectionHandler) {
      document.removeEventListener('selectionchange', element._selectionHandler);
      delete element._selectionHandler;
    }
    if (element._inputHandler) {
      element.removeEventListener('input', element._inputHandler);
      delete element._inputHandler;
    }
    if (element._rectUpdateTimeout) {
      clearTimeout(element._rectUpdateTimeout);
      delete element._rectUpdateTimeout;
    }
    if (this.windowBlurHandler) {
      window.removeEventListener('blur', this.windowBlurHandler);
      this.windowBlurHandler = null;
    }

    element.contentEditable = 'false';
    element.blur();

    var selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    // The commit's draft is on disk BEFORE the commit is sent (seamless canvas
    // D8: the parent clears it only once the commit is accepted). The 300 ms
    // debounce would otherwise fire after exit with nothing to flush, and a
    // refused commit lost fast-typed text entirely (desktop 2026-10-04).
    var original = this.originalTextContent;
    if (newText !== original || inlineMarkup !== null) this.flushTextDraft();
    else if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }

    // A markup write carries the whole edit; it then reports the text as
    // unchanged so the parent does not also write a flattened plain-text copy.
    if (inlineMarkup !== null) this.sendToParent({ type: 'MARKUP_CHANGED', payload: { key: editKey, innerHTML: inlineMarkup } });
    this.sendToParent({
      type: 'EDIT_MODE_EXITED',
      payload: { key: editKey, textContent: newText, originalText: inlineMarkup !== null ? newText : this.originalTextContent }
    });

    var changed = newText !== this.originalTextContent;
    this.editingElement = null;
    this.originalTextContent = null;
    // Seamless canvas: run a refresh held during the edit (source-refresh.ts).
    if (this.onEditExitedForRefresh) this.onEditExitedForRefresh(element, changed, original);
  };

IFrameBridge.prototype.findTextNode = function(element, textContent) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent === textContent) {
        return walker.currentNode;
      }
    }
    return null;
  };

IFrameBridge.prototype.findTextNodeContaining = function(element, substring) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      var nodeText = walker.currentNode.textContent;
      if (nodeText) {
        var idx = nodeText.indexOf(substring);
        if (idx !== -1) {
          return { node: walker.currentNode, index: idx };
        }
      }
    }
    return null;
  };

IFrameBridge.prototype.reconstructRangeFromSaved = function(saved, element) {
    if (!saved || !element) return null;

    if (saved.startOffset !== undefined && saved.endOffset !== undefined) {
      var textNode = this.findTextNode(element, saved.textContent);
      // Use local variables to avoid mutating saved object
      var startOffset = saved.startOffset;
      var endOffset = saved.endOffset;

      if (!textNode) {
        var result = this.findTextNodeContaining(element, saved.selectedText);
        if (result) {
          textNode = result.node;
          // Update local variables, not the saved object
          startOffset = result.index;
          endOffset = result.index + saved.selectedText.length;
        }
      }

      if (textNode && startOffset < textNode.length && endOffset <= textNode.length) {
        var range = document.createRange();
        range.setStart(textNode, startOffset);
        range.setEnd(textNode, endOffset);
        return range;
      }
    }

    return saved.range || null;
  };

IFrameBridge.prototype.setCaretAtPoint = function(x, y) {
    var range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    if (range) {
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

IFrameBridge.prototype.getEditableParentKey = function(element) {
    var parentEl = this.findEditableElement(element.parentElement);
    return parentEl ? this.getElementKey(parentEl) : null;
  };




IFrameBridge.prototype.findClosestLink = function(node) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return node.parentElement ? node.parentElement.closest('a') : null;
    }
    return node.closest ? node.closest('a') : null;
  };

IFrameBridge.prototype.preventLinkNavigation = function(target) {
    if (!target) return;
    if (target.tagName === 'A' || target.closest('a')) {
      return true;
    }
    return false;
  };

IFrameBridge.prototype.callHmrFunction = function(funcName, payload, resultType) {
    var self = this;

    if (typeof window[funcName] === 'function') {
      window[funcName](payload);
      return;
    }

    var retryCount = 0;
    var maxRetries = 20;
    var checkInterval = setInterval(function() {
      retryCount++;
      if (typeof window[funcName] === 'function') {
        clearInterval(checkInterval);
        window[funcName](payload);
      } else if (retryCount >= maxRetries) {
        clearInterval(checkInterval);
        console.error('[IFrameBridge] HMR module not available after retries');
        self.sendToParent({
          type: resultType,
          payload: {
            requestId: payload.requestId,
            success: false,
            error: 'HMR module not available'
          }
        });
      }
    }, 100);
  };

IFrameBridge.prototype.handleWriteText = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_TEXT payload:', payload);
      return;
    }
    this.callHmrFunction('__SQ_WRITE_TEXT__', payload, 'SQ_WRITE_TEXT_RESULT');
  };

IFrameBridge.prototype.handleWriteImage = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.attribute) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_IMAGE payload:', payload);
      return;
    }
    this.callHmrFunction('__SQ_WRITE_IMAGE__', payload, 'SQ_WRITE_IMAGE_RESULT');
  };

// task-140 media fill: container -> img/video tag swap in the real file
IFrameBridge.prototype.handleWriteTagSwap = function(payload) {
    // task-141: kind 'container' (un-resolve) legitimately carries src: ''
    var srcOk = payload && (payload.kind === 'container' || (payload.kind === 'image-fill' && payload.imageFill && typeof payload.imageFill.expectedTag === 'string' && payload.imageFill.change) || !!payload.src);
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.kind || !srcOk) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_TAG_SWAP payload:', payload);
      return;
    }
    this.callHmrFunction('__SQ_WRITE_TAG_SWAP__', payload, 'SQ_WRITE_TAG_SWAP_RESULT');
  };

// task-133 structural ops: insert/remove/move keyed elements + import
// management in the real source file (local/server write channel).

// Task 10 sweep: shared invalid-payload rejection. Without the reply the
// parent's BaseViteWriter burns its full 10s timeout on a malformed payload;
// the failure reply mirrors callHmrFunction's retry-exhaustion shape. No
// requestId → nothing to reply to (console.error only).
IFrameBridge.prototype.rejectInvalidWrite = function(payload, msgType, resultType) {
    console.error('[IFrameBridge] Invalid ' + msgType + ' payload:', payload);
    if (payload && payload.requestId) {
      this.sendToParent({
        type: resultType,
        payload: { requestId: payload.requestId, success: false, error: 'invalid payload' }
      });
    }
  };

IFrameBridge.prototype.handleWriteInsert = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.markup || !payload.position) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_INSERT', 'SQ_WRITE_INSERT_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_INSERT__', payload, 'SQ_WRITE_INSERT_RESULT');
  };

// Fix 1 (task-148): page-body append — sourceLocation carries the page FILE
// only (no line/column: component-only pages have no DOM anchor at all).
IFrameBridge.prototype.handleWriteAppendPage = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.markup) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_APPEND_PAGE', 'SQ_WRITE_APPEND_PAGE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_APPEND_PAGE__', payload, 'SQ_WRITE_APPEND_PAGE_RESULT');
  };

IFrameBridge.prototype.handleWriteRemove = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_REMOVE', 'SQ_WRITE_REMOVE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_REMOVE__', payload, 'SQ_WRITE_REMOVE_RESULT');
  };

IFrameBridge.prototype.handleWriteMove = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.targetLocation || !payload.position) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_MOVE', 'SQ_WRITE_MOVE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_MOVE__', payload, 'SQ_WRITE_MOVE_RESULT');
  };

// task-133 Task 8: verbatim restore of previously removed bytes (undo inverse
// of remove/move) — text is the byte-exact removedSource, never re-indented.
IFrameBridge.prototype.handleWriteRestore = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.text) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_RESTORE', 'SQ_WRITE_RESTORE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_RESTORE__', payload, 'SQ_WRITE_RESTORE_RESULT');
  };

// live-smoke Critical: region restore — byte-exact inverse of an insert/move
// splice. segment may legitimately be '' (own-line splice inverse = delete
// the inserted lines), so validate its TYPE, not truthiness.
IFrameBridge.prototype.handleWriteRestoreRegion = function(payload) {
    var lineCountOk = payload && typeof payload.lineCount === 'number' && payload.lineCount >= 1;
    var segmentOk = payload && typeof payload.segment === 'string';
    if (!payload || !payload.sourceLocation || !payload.requestId || !lineCountOk || !segmentOk) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_RESTORE_REGION', 'SQ_WRITE_RESTORE_REGION_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_RESTORE_REGION__', payload, 'SQ_WRITE_RESTORE_REGION_RESULT');
  };

IFrameBridge.prototype.handleWriteImport = function(payload) {
    // An empty string names a side-effect addition, never an unnamed removal.
    var nameOk = payload && typeof payload.name === 'string' && (payload.name !== '' || payload.remove === undefined || payload.remove === false);
    var pathOk = payload && (payload.remove === true || (typeof payload.importPath === 'string' && payload.importPath.length > 0));
    if (!payload || !payload.sourceLocation || !payload.requestId || !nameOk || !pathOk) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_IMPORT', 'SQ_WRITE_IMPORT_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_IMPORT__', payload, 'SQ_WRITE_IMPORT_RESULT');
  };

IFrameBridge.prototype.handleUpdateImageAttribute = function(payload) {
    if (!payload.key || !payload.attribute) return;

    var element = this.findElementByKey(payload.key);
    if (!element) return;

    // Validate element is an img or video
    var tag = element.tagName.toLowerCase();
    if (tag !== 'img' && tag !== 'video') return;

    // Video boolean attrs arrive as 'true'/'false' strings (see ImageAttributes).
    // Set BOTH attribute and property — attributes alone don't affect an
    // already-loaded media element (e.g. muted).
    var VIDEO_BOOL_ATTRS = ['autoplay', 'loop', 'muted', 'controls'];
    if (tag === 'video' && VIDEO_BOOL_ATTRS.indexOf(payload.attribute) !== -1) {
      var on = payload.value === 'true';
      if (on) { element.setAttribute(payload.attribute, ''); } else { element.removeAttribute(payload.attribute); }
      element[payload.attribute] = on;
      if (payload.attribute === 'autoplay' && on && element.paused) {
        var p = element.play();
        if (p && p.catch) p.catch(function() {});
      }
      return;
    }

    // task-151: pre-override baseline, per attribute, first-wins — the class
    // tier's capture, for images. The scan payload cannot stand in for it: it
    // reports boundAssetPath and (since task-186 FIX-2) the src value alone —
    // never alt/loading — which is why an undo that removed a
    // sourceImageAttributes entry used to repaint through nothing. null records
    // "the source had no such attribute", so the restore can remove it again
    // instead of setting it to "".
    if (!this._restoringImageAttrs) {
      var baseline = this.originalImageAttrsByKey[payload.key];
      if (!baseline) {
        baseline = {};
        this.originalImageAttrsByKey[payload.key] = baseline;
      }
      if (baseline[payload.attribute] === undefined) {
        baseline[payload.attribute] = element.hasAttribute(payload.attribute)
          ? element.getAttribute(payload.attribute)
          : null;
      }
    }

    // Resolve sq-asset: references to iframe-origin blob URLs
    var resolvedValue = this.resolveAssetRef(payload.value);

    // If asset not yet transferred, queue for deferred resolution
    if (resolvedValue.indexOf('sq-asset:') === 0) {
      this._pendingAssetImages[payload.key] = payload;
      return;
    }

    // No-op guard: the scan re-apply (reapplySourceImageAttrOverrides) re-posts
    // this attribute on EVERY scan (it can't equality-check parent-side). Re-setting
    // img.src to its current value makes the browser re-fetch the image — a visible
    // flash on every scan, e.g. right after a frame is drawn. Skip when unchanged.
    if (element.getAttribute(payload.attribute) === resolvedValue) return;

    // Update the attribute directly
    this.updateAttribute(element, payload.attribute, resolvedValue);
  };

/**
 * "Put this image back the way the source renders it" — the image counterpart of
 * RESTORE_ORIGINAL_CLASSES / RESTORE_ORIGINAL_TEXT. Sent when an undo REMOVES a
 * sourceImageAttributes entry. `payload.attributes` names the attributes the
 * removed entry held; absent = every attribute this bridge ever overrode for the
 * key. Attributes with no captured baseline are left alone — the same
 * do-nothing-rather-than-guess rule the class restore uses.
 */
IFrameBridge.prototype.handleRestoreOriginalImageAttributes = function(payload) {
    var key = payload && payload.key;
    if (!key) return;
    var baseline = this.originalImageAttrsByKey[key];
    if (!baseline) return;

    var element = this.findElementByKey(key);
    if (!element) return;

    var names = (payload.attributes && payload.attributes.length)
      ? payload.attributes
      : Object.keys(baseline);

    this._restoringImageAttrs = true;
    try {
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var original = baseline[name];
        if (original === undefined) continue;
        if (original === null) element.removeAttribute(name);
        else this.updateAttribute(element, name, original);
        delete baseline[name];
      }
    } finally {
      this._restoringImageAttrs = false;
    }
    if (Object.keys(baseline).length === 0) delete this.originalImageAttrsByKey[key];
  };


  
  // Attributes the editor owns on user elements; the server never sends them.
  var SQ_EDITOR_ATTR = /^(data-key|data-drawn|data-mode|data-slot-|data-drag-|data-reparent-|data-sq-(ai-|selection-|media)|contenteditable$)/;

  IFrameBridge.prototype.installSourceRefresh = function() {
    var self = this;
    // A boundary's marker and scroll (documentBoundary): the URL is clean before anything
    // reads or reports it (navigation detection is installed after this).
    try {
      var here = new URL(location.href);
      if (here.searchParams.has('sq-b')) {
        here.searchParams.delete('sq-b');
        history.replaceState(history.state, '', here.href);
        var at = JSON.parse(sessionStorage.getItem('sq-b-scroll') || 'null');
        sessionStorage.removeItem('sq-b-scroll');
        if (at && at[0] === location.pathname) this.restoreBoundaryScroll(at[1], at[2]);
      }
    } catch (e) {}
    this._refreshDone = Promise.resolve();
    this._refreshDirty = false;
    this._refreshRunning = false;
    this._refreshRetry = null;
    // Style carriers the SERVER rendered (vs. ones Vite injects at runtime):
    // only those may be removed when a fresh page no longer carries them.
    this._serverHeadKeys = {};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function() { self.recordServerHead(document); }, { once: true });
    else this.recordServerHead(document);
    // The document is going away (link click, crash recovery, app quit): keep the typed text.
    window.addEventListener('pagehide', function() { self.flushTextDraft(); });
    document.addEventListener('visibilitychange', function() { if (document.visibilityState === 'hidden') self.flushTextDraft(); });
    // Layer 3 (cases 21/22): never move targets under a live pointer gesture
    // or an IME composition — hold the refresh, run it when they end.
    this._gestureSince = 0;
    this._composingSince = 0;
    var resume = function() { setTimeout(function() { self.resumeHeldRefresh(); }, 0); };
    document.addEventListener('pointerdown', function() { self._gestureSince = Date.now(); }, true);
    document.addEventListener('pointerup', function() { self._gestureSince = 0; resume(); }, true);
    document.addEventListener('pointercancel', function() { self._gestureSince = 0; resume(); }, true);
    document.addEventListener('mouseup', resume, true); // flow drag clears its state on mouseup
    document.addEventListener('compositionstart', function() { self._composingSince = Date.now(); }, true);
    document.addEventListener('compositionend', function() { self._composingSince = 0; resume(); }, true);
    window.__SQ_VITE_RELOAD__ = function(reason) {
      if (reason === 'reconnect') { self.documentBoundary('reconnect'); return true; }
      self.requestSourceRefresh();
      return true;
    };
  };

  // ponytail: a gesture whose end never reaches this frame (pointerup outside
  // it) expires after 10 s; the held-refresh poll then runs it.
  var SQ_HOLD_MAX_MS = 10000;
  IFrameBridge.prototype.refreshHeld = function() {
    var now = Date.now();
    return (this._gestureSince && now - this._gestureSince < SQ_HOLD_MAX_MS)
      || (this._composingSince && now - this._composingSince < SQ_HOLD_MAX_MS)
      || !!(this._flowDrag && this._flowDrag._state);
  };

  IFrameBridge.prototype.holdRefresh = function() {
    var self = this;
    this._refreshQueued = true;
    if (this._heldPoll) return;
    this._heldPoll = setTimeout(function() { self._heldPoll = null; self.resumeHeldRefresh(); }, 250);
  };

  IFrameBridge.prototype.resumeHeldRefresh = function() {
    if (!this._refreshQueued) return;
    if (this.refreshHeld()) { this.holdRefresh(); return; }
    this._refreshQueued = false;
    this.requestSourceRefresh();
  };

  IFrameBridge.prototype.requestSourceRefresh = function() {
    var self = this;
    if (this.refreshHeld()) { this.holdRefresh(); return; }
    this._refreshDirty = true;
    if (this._refreshRunning) return;
    this._refreshRunning = true;
    this._refreshDone = (async function() {
      try {
        while (self._refreshDirty) {
          self._refreshDirty = false;
          var html = await self.fetchOwnHtml();
          if (html === null) { self.scheduleRefreshRetry(); return; }
          if (self._refreshDirty) continue; // stale response: refetch (case 20)
          if (self.refreshHeld()) { self.holdRefresh(); return; }  // a gesture began during the fetch
          await self.applySourceHtml(html);
        }
      } finally { self._refreshRunning = false; }
    })();
  };

  /** Parent asks for a re-render from source (Reset/Push/stale scan, Task 2.6). */
  IFrameBridge.prototype.handleRefreshFromSource = function() {
    this.requestSourceRefresh();
  };

  IFrameBridge.prototype.fetchOwnHtml = async function() {
    try {
      var r = await fetch(location.href.split('#')[0], { headers: { Accept: 'text/html' }, cache: 'no-store' });
      if (!r.ok) return null;
      return await r.text();
    } catch (e) { return null; }
  };

  // Case 23: one silent retry after 1 s; the next Vite reload also heals it.
  IFrameBridge.prototype.scheduleRefreshRetry = function() {
    var self = this;
    if (this._refreshRetry) return;
    this._refreshRetry = setTimeout(function() { self._refreshRetry = null; self.requestSourceRefresh(); }, 1000);
  };

  var SQ_REFRESH_DEFER = {};

  IFrameBridge.prototype.applySourceHtml = async function(html) {
    var next = new DOMParser().parseFromString(html, 'text/html');
    if (this.refreshBlockedByEdit(next)) { this._refreshDeferred = true; return; }
    // Case 25: a response with nothing we tagged (error JSON, foreign page) is not this page.
    // A torn write (truncate → write) renders an empty page for an instant: re-read once first.
    if (!next.body.querySelector('[data-sq-source]') && document.body.querySelector('[data-sq-source]')) {
      if (!this._untaggedRetried) { this._untaggedRetried = true; this.scheduleRefreshRetry(); return; }
      this._untaggedRetried = false; this.documentBoundary('shape'); return;
    }
    this._untaggedRetried = false;
    var head = this.planHead(next.head);
    if (!head) { this.documentBoundary('shape'); return; }
    // New stylesheets load BEFORE the body changes (case 12: no unstyled flash).
    if (head.loads.length) {
      head.insertLinks();
      await Promise.race([Promise.all(head.loads), new Promise(function(r) { setTimeout(r, 2000); })]);
      if (this._refreshDirty) return;                       // a newer change is queued; it re-plans
      if (this.refreshBlockedByEdit(next)) { this._refreshDeferred = true; return; }
    }
    var plan = [];
    this._morphSeq++;          // one refresh = one verification miss at most per held key
    this._morphTouched = [];   // what this refresh changes (SOURCE_CHANGED, ledger A)
    try { if (!this.planMorph(document.body, next.body, plan)) { this.documentBoundary('shape'); return; } }
    catch (e) {
      if (e === SQ_REFRESH_DEFER) { this._refreshDeferred = true; return; }
      console.warn('[sq] morph failed', e); this.documentBoundary('shape'); return;
    }
    var observing = this.mutationObserverStarted;
    this.stopMutationObserver();
    try {
      head.apply();
      for (var i = 0; i < plan.length; i++) plan[i]();
      this.releaseDetachedClassHolds();   // a held node the morph removed loses its hold: no re-assert by key
      this.resetDocumentKeyCaches();
      this.reapplyLocalOverridesNow();
      this.refreshProjectCssLinks();
    } catch (e) {
      console.warn('[sq] morph failed', e); this.documentBoundary('shape'); return;   // case 25
    } finally { if (observing) this.startMutationObserver(); }
    this.scanElements();
    this.sendToParent({ type: 'SOURCE_OK' }); // case 24: a good render clears the error status
    try { this.reportSourceChanged(this._morphTouched); } catch (e) { console.warn('[sq] change report failed', e); }  // D2
    this._morphTouched = null;
  };

  /** Agent edits on the canvas (docs/plans/2026-11-10-agent-canvas-flash-design.md):
   *  the keys of what the morph changed. Never decides whose edit it
   *  was — the editor attributes it. Keys are read after the scan (A13). */
  IFrameBridge.prototype.reportSourceChanged = function(nodes) {
    var keys = [], seen = {}, i;
    for (i = 0; nodes && i < nodes.length && keys.length < 200; i++) {   // D5
      var n = nodes[i];
      if (!n || n.nodeType !== 1 || n === document.body || !document.body.contains(n)) continue;
      var keyed = n.closest('[data-key]');
      if (!keyed || keyed === document.body) continue;
      var key = keyed.getAttribute('data-key');
      if (seen[key]) continue;
      seen[key] = true; keys.push(key);
    }
    if (keys.length) this.sendToParent({ type: 'SOURCE_CHANGED', payload: { keys: keys } });
  };
  // Line shifts rewrite data-sq-source/data-key, every save bumps data-sq-source-version,
  // a component edit rewrites every data-astro-cid-*: none is a change the user should see (A3).
  var SQ_NOT_A_CHANGE = /^(data-sq-|data-key$|data-astro-)/;
  function sqClassWithoutAI(v) { return (v || '').split(/\s+/).filter(function(c) { return c && c.indexOf('sq-ai-') !== 0; }).join(' '); }
  IFrameBridge.prototype.morphTouch = function(n) { if (this._morphTouched && n) this._morphTouched.push(n); };

  /** The morph identity: source coordinate + placement + usage (plan D2). */
  function sqMorphKey(el) {
    var src = el.nodeType === 1 && el.getAttribute('data-sq-source');
    return src ? src + '	' + (el.getAttribute('data-sq-placement') || '') + '	' + (el.getAttribute('data-sq-usage') || '') : null;
  }
  function sqHasScript(el) { return el.tagName === 'SCRIPT' || !!(el.querySelector && el.querySelector('script')); }

  /**
   * Keyed morph of live's children into fresh's (morphdom-style, no
   * dependency — owner decision 1). Plans every change before any mutation:
   * returns false → boundary; throws SQ_REFRESH_DEFER when it would touch the
   * element being edited. Pairing per fresh child: (a) first unused live
   * sibling with the same key (FIFO, so loops pair in order); (b) else the
   * live child at the cursor when it has the same tag and is unkeyed or keyed
   * with a key the fresh list no longer has (a shifted coordinate); (c) else a
   * clone of the fresh node. Unpaired live children are removed.
   */
  IFrameBridge.prototype.planMorph = function(live, fresh, plan) {
    var editing = this.editingElement;
    var liveKids = [], freshKids = [], freshKeys = {}, byKey = {}, used = new Set(), desired = [], i;
    for (i = 0; i < live.childNodes.length; i++) if (!this.isEditorNode(live.childNodes[i])) liveKids.push(live.childNodes[i]);
    for (i = 0; i < fresh.childNodes.length; i++) freshKids.push(fresh.childNodes[i]);
    for (i = 0; i < freshKids.length; i++) { var fk = sqMorphKey(freshKids[i]); if (fk) freshKeys[fk] = true; }
    for (i = 0; i < liveKids.length; i++) { var lk = sqMorphKey(liveKids[i]); if (lk) (byKey[lk] = byKey[lk] || []).push(liveKids[i]); }
    var cursor = 0;
    for (i = 0; i < freshKids.length; i++) {
      var f = freshKids[i], m = null, key = sqMorphKey(f), c;
      if (key && byKey[key]) {
        while (!m && byKey[key].length) { c = byKey[key].shift(); if (!used.has(c) && c.tagName === f.tagName) m = c; }
      }
      if (!m) {
        while (cursor < liveKids.length && used.has(liveKids[cursor])) cursor++;
        c = liveKids[cursor];
        if (c && c !== editing && c.nodeType === f.nodeType && (c.nodeType !== 1
            || (c.tagName === f.tagName && (!sqMorphKey(c) || !freshKeys[sqMorphKey(c)])))) { m = c; cursor++; }
      }
      if (m && m.tagName === 'ASTRO-ISLAND' && !this.sameIsland(m, f)) m = null;  // case 15: replace that island alone
      if (m) {
        used.add(m);
        if (!this.planPair(m, f, plan)) return false;
        desired.push(m);
      } else {
        if (f.nodeType === 1 && sqHasScript(f)) return false;          // case 14: scripts never re-run in place
        var imported = document.importNode(f, true);
        desired.push(imported);
        if (f.nodeType === 1 || (f.nodeType === 3 && f.data.trim())) this.morphTouch(f.nodeType === 1 ? imported : live);  // A4
      }
    }
    var removed = [];
    for (i = 0; i < liveKids.length; i++) {
      var r = liveKids[i];
      if (used.has(r)) continue;
      if (editing && (r === editing || (r.nodeType === 1 && r.contains(editing)))) throw SQ_REFRESH_DEFER;
      if (r.nodeType === 1 && sqHasScript(r)) return false;
      removed.push(r);
      if (r.nodeType === 1 || (r.nodeType === 3 && r.data.trim())) this.morphTouch(live);   // A5: the container shows where
    }
    this.morphTouchMoves(liveKids, desired, used);
    var self = this;
    plan.push(function() {
      var next = function(n) { while (n && self.isEditorNode(n)) n = n.nextSibling; return n; };
      var at = next(live.firstChild);
      for (var d = 0; d < desired.length; d++) {
        if (desired[d] === at) at = next(at.nextSibling);
        else live.insertBefore(desired[d], at);
      }
      for (var x = 0; x < removed.length; x++) if (removed[x].parentNode === live) live.removeChild(removed[x]);
    });
    return true;
  };

  /** A6: a kept element moved when BOTH its neighbours among the kept ones
   *  changed — so a removal or an insert never reads as its siblings moving. */
  IFrameBridge.prototype.morphTouchMoves = function(liveKids, desired, used) {
    if (!this._morphTouched) return;
    var before = liveKids.filter(function(n) { return used.has(n) && n.nodeType === 1; });
    var after = desired.filter(function(n) { return used.has(n) && n.nodeType === 1; });
    if (before.length < 2) return;
    for (var i = 0; i < after.length; i++) {
      var j = before.indexOf(after[i]);
      if (before[j - 1] !== after[i - 1] && before[j + 1] !== after[i + 1]) this.morphTouch(after[i]);
    }
  };

  /** One paired node: patch it in place, recurse unless its subtree is protected. */
  IFrameBridge.prototype.planPair = function(x, y, plan) {
    if (x.nodeType !== 1) {
      if (x.data !== y.data) { this.morphTouch(x.parentNode); plan.push(function() { x.data = y.data; }); }  // A1
      return true;
    }
    var tag = x.tagName;
    if (tag === 'SCRIPT') return x.outerHTML === y.outerHTML;               // case 14
    if (tag === 'ASTRO-ISLAND') return true;                                  // case 16: kept untouched
    this.planAttrPatch(x, y, plan);
    if (x === this.editingElement) return true;                               // typed subtree is never touched
    if (this.isHeldEdit(x, y)) return true;
    // Playback continues; user-typed form values stay (case 2.1 rules).
    if ((tag === 'VIDEO' || tag === 'AUDIO' || tag === 'IFRAME') && x.getAttribute('src') === y.getAttribute('src')) return true;
    if (tag === 'TEXTAREA') return true;
    return this.planMorph(x, y, plan);
  };

  /** Head carriers by key (Task 2.2). Returns null → boundary (a new or changed script). */
  IFrameBridge.prototype.planHead = function(freshHead) {
    var self = this, head = document.head, ops = [], links = [], loads = [];
    var keyOf = function(el) { return self.headCarrierKey(el); };
    var liveByKey = {}, liveScripts = {}, i, el;
    for (i = 0; i < head.children.length; i++) {
      el = head.children[i];
      if (el.tagName === 'SCRIPT') liveScripts[el.outerHTML] = true;
      var lk = keyOf(el);
      if (lk && !liveByKey[lk]) liveByKey[lk] = el;
    }
    // Added/changed head scripts cannot run in place. A live script the fresh
    // page lacks (runtime-injected analytics, our tailwind loader) is left alone.
    var freshKeys = {}, prev = null;
    for (i = 0; i < freshHead.children.length; i++) {
      el = freshHead.children[i];
      if (el.tagName === 'SCRIPT') { if (!liveScripts[el.outerHTML]) return null; continue; }
      if (el.tagName === 'TITLE') {
        var title = el.textContent;
        if (document.title !== title) ops.push(function() { document.title = title; });
        continue;
      }
      var key = keyOf(el);
      if (!key) continue;
      freshKeys[key] = true;
      var live = liveByKey[key];
      if (live) {
        if (key.indexOf('style:') === 0 && live.textContent !== el.textContent) ops.push((function(l, t) { return function() { l.textContent = t; }; })(live, el.textContent));
        if (key.indexOf('meta:') === 0 && live.getAttribute('content') !== el.getAttribute('content')) ops.push((function(l, v) { return function() { l.setAttribute('content', v || ''); }; })(live, el.getAttribute('content')));
        prev = live;
        continue;
      }
      var node = document.importNode(el, true);
      var after = prev;
      if (el.tagName === 'LINK') {
        links.push({ node: node, after: after });
        loads.push(new Promise(function(r) { node.addEventListener('load', r); node.addEventListener('error', r); }));
      } else {
        ops.push((function(n, a) { return function() { if (a && a.parentNode === head) a.after(n); else head.appendChild(n); }; })(node, after));
      }
      prev = node;
    }
    for (var k in liveByKey) {
      if (freshKeys[k]) continue;
      // Only what the server once rendered may go; Vite's runtime styles stay.
      if (this._serverHeadKeys[k]) ops.push((function(l) { return function() { if (l.parentNode) l.parentNode.removeChild(l); }; })(liveByKey[k]));
    }
    for (var fkey in freshKeys) this._serverHeadKeys[fkey] = true;
    return {
      loads: loads,
      insertLinks: function() { for (var j = 0; j < links.length; j++) { var l = links[j]; if (l.after && l.after.parentNode === head) l.after.after(l.node); else head.appendChild(l.node); } links = []; },
      apply: function() { this.insertLinks(); for (var j = 0; j < ops.length; j++) ops[j](); },
    };
  };

  /** Style carriers + keyed metas; anything else in <head> is not reconciled. */
  IFrameBridge.prototype.headCarrierKey = function(el) {
    if (el.tagName === 'STYLE' && el.hasAttribute('data-vite-dev-id')) return 'style:' + el.getAttribute('data-vite-dev-id');
    // Our own inline viewer styles (SqComponentView's backdrop) carry a key too.
    if (el.tagName === 'STYLE' && el.hasAttribute('data-sq-head')) return 'style:sq:' + el.getAttribute('data-sq-head');
    if (el.tagName === 'LINK' && (el.getAttribute('rel') || '').toLowerCase() === 'stylesheet') return 'link:' + this.hmrHref(el.getAttribute('href') || '');
    if (el.tagName === 'META') {
      var n = el.getAttribute('name') || el.getAttribute('property') || el.getAttribute('http-equiv');
      return n ? 'meta:' + n : null;
    }
    return null;
  };

  /**
   * Every stylesheet <link> to the project's own sources — in <head> OR in the
   * body (the component master view renders them there) — is re-fetched after
   * a refresh. Its URL never changes while its CONTENT does (Tailwind
   * regenerates on every source edit), so a kept link goes stale and, loaded
   * after the fresh styles, outranks newer rules: a padding set to 0 at xl kept
   * rendering the old sm:px-6 (owner 2026-10-06, measured in the canvas). The
   * stamped copy loads next to the old one; the old is removed once it loaded
   * (no unstyled flash). One refresh per link at a time.
   */
  IFrameBridge.prototype.refreshProjectCssLinks = function() {
    var self = this;
    Array.prototype.forEach.call(document.querySelectorAll('link[rel="stylesheet"]'), function(old) {
      if (old._sqCssRefreshing || !self.isProjectCssLink(old)) return;
      old._sqCssRefreshing = true;
      var fresh = old.cloneNode(false);
      fresh.setAttribute('href', self.hmrHref(old.getAttribute('href') || '', String(Date.now())));
      var settle = function() { clearTimeout(timer); if (old.parentNode) old.parentNode.removeChild(old); };
      var timer = setTimeout(settle, 5000);
      fresh.addEventListener('load', settle, { once: true });
      fresh.addEventListener('error', settle, { once: true });
      old.after(fresh);
    });
  };

  /** A stylesheet link served from this instance's own project sources. */
  IFrameBridge.prototype.isProjectCssLink = function(link) {
    try { var u = new URL(link.getAttribute('href') || '', location.href); return u.origin === location.origin && u.pathname.indexOf('/src/') === 0; }
    catch (e) { return false; }
  };

  /** The href with the t stamp set (stamp given) or removed (none): path + query, same-origin. */
  IFrameBridge.prototype.hmrHref = function(href, stamp) {
    try {
      var u = new URL(href, location.href);
      if (stamp) u.searchParams.set('t', stamp); else u.searchParams.delete('t');
      return u.pathname + u.search;
    } catch (e) { return href; }
  };


  /** The head style carriers the server rendered at load (see installSourceRefresh). */
  IFrameBridge.prototype.recordServerHead = function(doc) {
    var els = doc.head ? doc.head.children : [];
    for (var i = 0; i < els.length; i++) { var k = this.headCarrierKey(els[i]); if (k) this._serverHeadKeys[k] = true; }
  };

  IFrameBridge.prototype.sameIsland = function(x, y) {
    var attrs = ['component-url', 'renderer-url', 'props', 'client', 'component-export'];
    for (var i = 0; i < attrs.length; i++) if (x.getAttribute(attrs[i]) !== y.getAttribute(attrs[i])) return false;
    return true;
  };

  IFrameBridge.prototype.planAttrPatch = function(x, y, plan) {
    for (var i = 0; i < y.attributes.length; i++) {
      var at = y.attributes[i];
      if (SQ_EDITOR_ATTR.test(at.name)) continue;
      // Our own ?t= stamp on a refreshed project stylesheet is the same link.
      if (x.tagName === 'LINK' && at.name === 'href' && this.hmrHref(x.getAttribute('href') || '') === this.hmrHref(at.value)) continue;
      // instant-edit P0b: a held class is not the file's to overwrite until the file carries it (dom-updates.ts);
      // the verification of a settled hold happens here too, whether or not the fresh class differs.
      if (at.name === 'class' || at.name === 'style') {
        var held = this.classHoldFor(x);
        if (held && at.name === 'class' && this.holdSkipsClassPatch(held, at.value)) continue;
        if (held && at.name === 'style' && held.inlineBg) continue;   // the bg-image inline fallback
      }
      if (x.getAttribute(at.name) !== at.value) {
        // Our self-cleaning animation classes (sq-ai-*) are not the server's: same
        // class otherwise = no patch, so a refresh never cuts a dissolve short.
        if (at.name === 'class' && sqClassWithoutAI(x.getAttribute('class')) === sqClassWithoutAI(at.value)) continue;
        plan.push((function(el, n, v) { return function() { el.setAttribute(n, v); }; })(x, at.name, at.value));
        if (!SQ_NOT_A_CHANGE.test(at.name)) this.morphTouch(x);   // A2
      }
    }
    // The element moved in its file (a line added above it): the key the scan
    // derived from the OLD location goes, so the rescan stamps the new one —
    // else a click selects by the stale line (live 2026-10-10: the date <p>
    // read as the <h3> above it after a backdrop note added a line).
    var oldSrc = x.getAttribute('data-sq-source'), newSrc = y.getAttribute('data-sq-source'), key = x.getAttribute('data-key');
    // Same for an untracked node that gains a source (a predicted ⌘D copy): its
    // `dynamic:` stand-in key would otherwise win the rescan and route edits away.
    var moved = oldSrc && newSrc && oldSrc !== newSrc && key && (key === oldSrc || key.indexOf(oldSrc + '#') === 0 || key.indexOf(oldSrc + '~') === 0);
    if (moved || (!oldSrc && newSrc && key && key.indexOf('dynamic:') === 0)) {
      plan.push((function(el) { return function() { el.removeAttribute('data-key'); }; })(x));
    }
    for (var j = x.attributes.length - 1; j >= 0; j--) {
      var name = x.attributes[j].name;
      if (!y.hasAttribute(name) && !SQ_EDITOR_ATTR.test(name)) {
        if (name === 'class' || name === 'style') {
          var heldGone = this.classHoldFor(x);
          if (heldGone && name === 'class' && this.holdSkipsClassPatch(heldGone, '')) continue;
          if (heldGone && name === 'style' && heldGone.inlineBg) continue;
        }
        plan.push((function(el, n) { return function() { el.removeAttribute(n); }; })(x, name));
        // An empty style/class (left by an editor animation's cleanup) shows nothing.
        if (!SQ_NOT_A_CHANGE.test(name) && !((name === 'style' || name === 'class') && !(x.getAttribute(name) || '').trim())) this.morphTouch(x);
      }
    }
  };

  /** D2: keys are positional. During an edit, patch only when the new HTML
   *  provably holds the SAME element: identical key AND identical version.
   *  Then position = identity (the file is unchanged up to that element). */
  IFrameBridge.prototype.refreshBlockedByEdit = function(next) {
    var el = this.editingElement;
    if (!el) return false;
    var src = el.getAttribute('data-sq-source');
    if (!src) return true;
    var want = [src, el.getAttribute('data-sq-source-version') || '', el.getAttribute('data-sq-placement') || '', el.getAttribute('data-sq-usage') || ''];
    var all = next.querySelectorAll('[data-sq-source]');
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (c.getAttribute('data-sq-source') === want[0] && (c.getAttribute('data-sq-source-version') || '') === want[1]
          && (c.getAttribute('data-sq-placement') || '') === want[2] && (c.getAttribute('data-sq-usage') || '') === want[3]) return false;
    }
    return true;
  };

  /** Edit exit: run a refresh that was deferred, and hold the just-typed text
   *  until the served file carries it — the commit write is still in flight,
   *  and patching the old file text back would flash it.
   *  ponytail: 10 s cap; a failed commit then shows the file text (files are truth). */
  IFrameBridge.prototype.onEditExitedForRefresh = function(element, changed, original) {
    if (element && changed) this._heldEdit = { el: element, until: Date.now() + 10000, original: original == null ? null : String(original),
      version: element.getAttribute('data-sq-source-version') || '' };
    if (!this._refreshDeferred) return;
    this._refreshDeferred = false;
    this.requestSourceRefresh();
  };

  IFrameBridge.prototype.isHeldEdit = function(live, fresh) {
    var held = this._heldEdit;
    if (!held || held.el !== live) return false;
    // Keys are positional: hold only while the fresh node is provably the
    // element that was edited — the file is unchanged (same version) or it
    // still renders the text the edit started from (the commit has not landed).
    // Anything else is another element on a reused key (a reorder) or a newer
    // truth: release (desktop 2026-10-04: typed text painted onto 'Hello post').
    var same = (fresh.getAttribute('data-sq-source-version') || '') === held.version
      || (held.original !== null && fresh.textContent === held.original);
    if (live.textContent !== fresh.textContent && Date.now() < held.until && same) return true;
    this._heldEdit = null;
    return false;
  };

  /** Nodes the bridge injected into <body> (drag ghost, placeholders, highlights, AI preview). */
  IFrameBridge.prototype.isEditorNode = function(n) {
    return n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')
      || n.hasAttribute('data-sq-selection-highlight')
      || n.hasAttribute('data-sq-ai-preview') || n.hasAttribute('data-sq-ai-highlight') || n === this._aiHighlightOverlay
      || n === this.selectionHighlightElement);
  };

  /** A fresh load starts these empty; a refresh must too, or a reused key
   *  inherits another element's baseline. The edited element keeps its own. */
  IFrameBridge.prototype.resetDocumentKeyCaches = function() {
    var el = this.editingElement;
    var keep = el ? (el.getAttribute('data-key') || el.getAttribute('data-sq-source')) : null;
    var pick = function(map, extra) {
      var out = {}; if (keep && map && map[keep] !== undefined) out[keep] = map[keep];
      for (var h = 0; extra && h < extra.length; h++) if (map && map[extra[h]] !== undefined) out[extra[h]] = map[extra[h]];
      return out;
    };
    // A held key keeps its undo baseline too: the next apply would otherwise capture the HELD value as the baseline.
    this.originalClassesByKey = pick(this.originalClassesByKey, Object.keys(this._classHoldByKey));
    this.originalTextByKey = pick(this.originalTextByKey);
    this.originalImageAttrsByKey = pick(this.originalImageAttrsByKey);
    this.originalMarkupByKey = pick(this.originalMarkupByKey);
    this._preAppliedFileClasses = {};
    this._scannedLayouts = null;
    this._gridProbeCache = null;
  };

  /** D4: the #sq-ov overrides, same function the pre-paint path uses. */
  IFrameBridge.prototype.reapplyLocalOverridesNow = function() {
    if (!window.__SQ_LOCAL_MODE__) return;
    var overrides = null;
    try { var h = location.hash || ''; if (h.indexOf('#sq-ov=') === 0) overrides = JSON.parse(decodeURIComponent(h.slice(7))); } catch (e) { overrides = null; }
    if (!overrides || typeof overrides !== 'object') return;
    var counts = {}, seen = new WeakSet();
    var tagged = document.querySelectorAll('[data-sq-source]');
    for (var i = 0; i < tagged.length; i++) this.applyLocalOverrideTo(tagged[i], overrides, counts, seen);
  };

  /** Layer 1 boundary: never lose typed text, then let the document go — as a same-origin
   *  REPLACE, never a reload: a reload is not eligible for the paint-hold view transition
   *  (sq-source-plugin armLocalRuntimeHtml), and without it Chromium shows one blank frame
   *  between the new document's commit and first paint (A4/A5, log-proven 2026-11-10). */
  IFrameBridge.prototype.documentBoundary = function(reason) {
    try { this.flushTextDraft(); } catch (e) {}
    // A reload restored the scroll; the replace starts at the top: carry it (preview mode).
    try { if (window.scrollX || window.scrollY) sessionStorage.setItem('sq-b-scroll', JSON.stringify([location.pathname, window.scrollX, window.scrollY])); } catch (e) {}
    console.info('[sq] document boundary:', reason);
    location.replace(this.boundaryUrl(location.href));
  };

  /** A new URL even when only the #sq-ov fragment would differ (that would be a same-document
   *  fragment navigation, not a new document); installSourceRefresh drops sq-b again. */
  IFrameBridge.prototype.boundaryUrl = function(href) {
    var url = new URL(href);
    url.searchParams.set('sq-b', String(Date.now()));
    return url.href;
  };

  /** Like a reload's scroll restoration: re-apply every frame while the page grows, until it
   *  holds on a loaded page, the user scrolls, or ~10 s. */
  IFrameBridge.prototype.restoreBoundaryScroll = function(x, y) {
    var stopped = false, frames = 0;
    var stop = function() { stopped = true; };
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function(t) { window.addEventListener(t, stop, { once: true, capture: true, passive: true }); });
    var pin = function() {
      if (stopped) return;
      window.scrollTo(x, y);
      var held = Math.abs(window.scrollX - x) < 1 && Math.abs(window.scrollY - y) < 1;
      if ((!held || document.readyState !== 'complete') && ++frames < 600) requestAnimationFrame(pin);
    };
    requestAnimationFrame(pin);
  };



  

  IFrameBridge.prototype._sqLuminance = function(rgbStr) {
    var m = rgbStr.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    var parts = m[1].split(',');
    if (parts.length >= 4 && parseFloat(parts[3]) === 0) return null; // transparent
    var c = [0, 1, 2].map(function(i) {
      var v = parseFloat(parts[i]) / 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };

  IFrameBridge.prototype._sqEffectiveBg = function(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      var bg = window.getComputedStyle(node).backgroundColor;
      var lum = this._sqLuminance(bg);
      if (lum !== null) return lum;
      node = node.parentElement;
    }
    return 1; // ponytail: default white; gradient/image backgrounds are not judged
  };

  IFrameBridge.prototype.handleVerifyLayout = function(payload) {
    if (!payload || !payload.requestId) return;
    var keys = payload.keys || [];
    var findings = [];
    var self = this;

    // Page-level: horizontal scroll
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      findings.push({ key: 'page', severity: 'error', issue: 'page has horizontal scroll', suggestion: 'find the element wider than the viewport and constrain it' });
    }

    keys.forEach(function(key) {
      var el = self.findElementByKey(key);
      if (!el) {
        findings.push({ key: key, severity: 'error', issue: 'element not found in rendered page', suggestion: 'key may be stale — your change was ALREADY APPLIED; call read_page_content for fresh keys and re-verify. Do NOT re-add the content.' });
        return;
      }
      var r = el.getBoundingClientRect();

      if ((r.width === 0 || r.height === 0) && (el.textContent || '').trim()) {
        findings.push({ key: key, severity: 'error', issue: 'zero-size element with content', suggestion: 'check display/height classes' });
        return;
      }

      // Overflow beyond parent (static flow only)
      var parent = el.parentElement;
      if (parent && parent !== document.body) {
        var pr = parent.getBoundingClientRect();
        if (pr.width > 0 && (r.right > pr.right + 1 || r.left < pr.left - 1)) {
          findings.push({ key: key, severity: 'error', issue: 'overflows parent horizontally by ' + Math.round(Math.max(r.right - pr.right, pr.left - r.left)) + 'px', suggestion: 'reduce width/padding or allow wrapping' });
        }
      }

      // Sibling overlap — only when both are in static flow (absolute overlap is intentional).
      // Flow = not absolute/fixed/sticky (jsdom computes position as '' — treat as flow too).
      var isFlow = function(p) { return p !== 'absolute' && p !== 'fixed' && p !== 'sticky'; };
      var pos = window.getComputedStyle(el).position;
      if (parent && isFlow(pos)) {
        var sibs = parent.children;
        for (var i = 0; i < sibs.length; i++) {
          var sib = sibs[i];
          if (sib === el) continue;
          var sp = window.getComputedStyle(sib).position;
          if (!isFlow(sp)) continue;
          var sr = sib.getBoundingClientRect();
          var ox = Math.min(r.right, sr.right) - Math.max(r.left, sr.left);
          var oy = Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top);
          if (ox > 8 && oy > 8) {
            findings.push({ key: key, severity: 'error', issue: 'overlaps sibling <' + sib.tagName.toLowerCase() + '> by ' + Math.round(ox) + 'x' + Math.round(oy) + 'px', suggestion: 'check margins/positioning' });
            break;
          }
        }
      }

      // Text contrast (WCAG-ish; ponytail: 4.5 flat threshold, no large-text nuance)
      var hasText = (el.textContent || '').trim().length > 0 && el.children.length === 0;
      if (hasText) {
        var fg = self._sqLuminance(window.getComputedStyle(el).color);
        if (fg !== null) {
          var bg = self._sqEffectiveBg(el);
          var ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
          if (ratio < 4.5) {
            findings.push({ key: key, severity: 'warning', issue: 'text contrast ' + ratio.toFixed(1) + ':1 (below 4.5:1 AA)', suggestion: 'darken text or change background' });
          }
        }
      }
    });

    this.sendToParent({ type: 'LAYOUT_VERIFIED', payload: { requestId: payload.requestId, findings: findings } });
  };


  

  IFrameBridge.prototype._sqPreviewSanitize = function(root) {
    var scripts = root.querySelectorAll('script');
    for (var i = 0; i < scripts.length; i++) scripts[i].remove();
    var all = root.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      for (var k = el.attributes.length - 1; k >= 0; k--) {
        var a = el.attributes[k];
        var name = a.name.toLowerCase();
        var url = a.value.replace(/\s/g, '').toLowerCase();
        if (name.indexOf('on') === 0 ||
            name === 'data-key' || name === 'data-sq-source' || name === 'data-with-props' ||
            ((name === 'href' || name === 'src') && (url.indexOf('javascript:') === 0 || url.indexOf('vbscript:') === 0))) {
          el.removeAttribute(a.name);
        }
      }
    }
  };

  // Shared style block — section/text/busy paints can each be the first to
  // need it (a text-only or busy-only stream never creates the container).
  IFrameBridge.prototype._sqPreviewEnsureStyle = function() {
    if (document.getElementById('sq-ai-preview-style')) return;
    var st = document.createElement('style');
    st.id = 'sq-ai-preview-style';
    st.textContent =
      // Flat activity fill (Rectangle 50). Hue knob: --sq-ai-hue "r, g, b".
      // Ring + fill are drawn by the PARENT (AIGlowRings) — see _sqReportPreviewRect.
      '[data-sq-ai-preview]{box-sizing:border-box}' +
      // Streamed elements are REAL content dissolving in: 0 opacity + blur → sharp.
      '.sq-ai-new{animation:sq-in 0.5s ease-out both}' +
      '@keyframes sq-in{from{opacity:0;filter:blur(10px)}to{opacity:1;filter:blur(0)}}' +
      '[data-sq-ai-typing]::after{content:"";display:inline-block;width:2px;height:1em;' +
      'background:rgba(var(--sq-ai-hue,95,170,255),0.9);vertical-align:text-bottom;margin-left:1px;' +
      'animation:sq-caret 0.8s step-end infinite}' +
      '@keyframes sq-caret{50%{opacity:0}}' +
      // Busy pulse: class-only edit in flight on this element.
      '[data-sq-ai-busy]{animation:sq-busy 1.2s ease-in-out infinite}' +
      '@keyframes sq-busy{50%{opacity:0.55}}' +
      '@media (prefers-reduced-motion: reduce){.sq-ai-new,[data-sq-ai-busy]{animation:none}}';
    document.head.appendChild(st);
  };

  // Watchdog: if END never arrives (dropped relay, mid-run reload), no preview
  // artifact — container, caret, busy pulse — may squat on the canvas forever.
  // Every paint of every mode re-arms it.
  IFrameBridge.prototype._sqArmPreviewWatchdog = function() {
    var self = this;
    if (this._sqPreviewWatchdog) clearTimeout(this._sqPreviewWatchdog);
    this._sqPreviewWatchdog = setTimeout(function() {
      self.handleStreamPreviewEnd();
    }, 8000);
  };

  IFrameBridge.prototype.handleStreamPreview = function(payload) {
    if (!payload || !payload.mode) return;
    this._sqArmPreviewWatchdog();

    if (payload.mode === 'busy') {
      var busyTarget = this.findElementByKey(payload.targetKey);
      if (!busyTarget) return; // stale key — executor's normal failure path informs the model
      this._sqPreviewEnsureStyle();
      busyTarget.setAttribute('data-sq-ai-busy', 'true');
      return;
    }

    if (payload.mode === 'text') {
      var target = this.findElementByKey(payload.targetKey);
      if (!target) return; // stale key — executor's normal failure path informs the model
      this._sqPreviewEnsureStyle();
      // Save the original ONCE so the no-commit paths (watchdog, SET_PAGE,
      // cancel) can restore instead of baking truncated text into the DOM.
      if (!target.hasAttribute('data-sq-ai-orig')) {
        target.setAttribute('data-sq-ai-orig', target.textContent || '');
      }
      target.removeAttribute('data-sq-ai-busy'); // busy → text upgrade
      target.setAttribute('data-sq-ai-typing', 'true');
      target.textContent = payload.partial;
      return;
    }

    // section mode
    // A new stream while removal is pending (back-to-back tool calls) reuses
    // the live container — no disappear/reappear flicker between sections.
    if (this._sqPreviewEndPending) {
      this._sqPreviewEndPending = false;
      if (this._sqPreviewFallback) { clearTimeout(this._sqPreviewFallback); this._sqPreviewFallback = null; }
    }
    var c = document.querySelector('[data-sq-ai-preview]');
    var content;
    if (!c) {
      // Fresh container = fresh dissolve counter. A counter surviving a
      // finalize-without-END (SET_PAGE, watchdog) suppressed the dissolve-in
      // for the next stream's first N elements.
      this._sqPreviewCount = 0;
      c = document.createElement('div');
      c.setAttribute('data-sq-ai-preview', 'true');
      c.style.pointerEvents = 'none';
      c.style.position = 'relative';
      c.style.transition = 'opacity 300ms ease';

      content = document.createElement('div');
      content.setAttribute('data-sq-ai-preview-content', 'true');
      c.appendChild(content);

      document.body.appendChild(c);
      this._sqPreviewEnsureStyle();
    } else {
      content = c.querySelector('[data-sq-ai-preview-content]');
    }
    content.innerHTML = payload.partial; // innerHTML never executes scripts; handlers stripped below
    this._sqPreviewSanitize(content);

    // Progressive build: elements past the previous render's count are NEW —
    // pop them in with a stagger so growth is visible element by element.
    // ponytail: document-order index works because streamed markup only
    // appends; a rewriting model would re-animate a few tail elements, fine.
    var els = content.querySelectorAll('*');
    var prevCount = this._sqPreviewCount || 0;
    for (var n = prevCount; n < els.length; n++) {
      els[n].classList.add('sq-ai-new');
      els[n].style.animationDelay = Math.min((n - prevCount) * 70, 630) + 'ms';
    }
    this._sqPreviewCount = els.length;

    this.reportContentHeight(); // grow the frame live so the preview is on screen
    this._sqReportPreviewRect(c);
  };

  // The streaming container's ring is drawn by the canvas, exactly like the
  // section rings: it paints outside its own box, and the container spans the
  // full page width, so an in-iframe ring loses both side strokes to the frame
  // edge. Re-reported on every paint — the container grows as content streams.
  // null = preview gone, clear it.
  IFrameBridge.prototype._sqReportPreviewRect = function(c) {
    var r = c && c.getBoundingClientRect();
    var rect = r && r.height ? this.buildRect(r) : null;
    // Text growing inside an already-sized container reports the same box every
    // paint (paints are throttled to 10/s, and each one re-renders ViewportFrame
    // in the parent) — only send when the box actually moved.
    var last = this._sqLastPreviewRect;
    if (last === undefined ? rect === null : JSON.stringify(last) === JSON.stringify(rect)) return;
    this._sqLastPreviewRect = rect;
    this.sendToParent({ type: 'AI_PREVIEW_RECT', payload: { rect: rect } });
  };

  // Render handshake (flashes DID show up live): END only marks removal as
  // pending — the container is held until the committed content's RENDER
  // applies, so the swap is a same-frame replace instead of
  // fade → blank gap → appear. Fallback timer covers a RENDER that never comes.
  IFrameBridge.prototype.handleStreamPreviewEnd = function(payload) {
    var self = this;
    this._sqPreviewCount = 0;
    if (this._sqPreviewWatchdog) { clearTimeout(this._sqPreviewWatchdog); this._sqPreviewWatchdog = null; }
    var typing = document.querySelectorAll('[data-sq-ai-typing]');
    for (var i = 0; i < typing.length; i++) typing[i].removeAttribute('data-sq-ai-typing');
    var busy = document.querySelectorAll('[data-sq-ai-busy]');
    for (var b = 0; b < busy.length; b++) busy[b].removeAttribute('data-sq-ai-busy');
    var origs = document.querySelectorAll('[data-sq-ai-orig]');
    for (var o = 0; o < origs.length; o++) {
      // Cancelled run: no commit will follow — put the original text back.
      // Normal END: keep the streamed text (the commit overwrites it moments
      // later); restoring here would flash the old text.
      if (payload && payload.cancelled) origs[o].textContent = origs[o].getAttribute('data-sq-ai-orig');
      origs[o].removeAttribute('data-sq-ai-orig');
    }
    if (!document.querySelector('[data-sq-ai-preview]')) return;
    this._sqPreviewEndPending = true;
    if (this._sqPreviewFallback) clearTimeout(this._sqPreviewFallback);
    this._sqPreviewFallback = setTimeout(function() { self._sqPreviewFinalize('fallback-2s'); }, 2000);
  };

  // Actual removal — called by the END fallback (the commit is a file write → HMR),
  // or handleSetPage (page switch must not leak the container). Full cleanup:
  // every timer and the dissolve counter die with the container.
  IFrameBridge.prototype._sqPreviewFinalize = function(trigger) {
    this._sqPreviewEndPending = false;
    this._sqPreviewCount = 0;
    if (this._sqPreviewFallback) { clearTimeout(this._sqPreviewFallback); this._sqPreviewFallback = null; }
    if (this._sqPreviewWatchdog) { clearTimeout(this._sqPreviewWatchdog); this._sqPreviewWatchdog = null; }
    // No-commit path (watchdog fallback, SET_PAGE): restore original text so a
    // cancelled stream doesn't bake truncated text into the DOM.
    var origs = document.querySelectorAll('[data-sq-ai-orig]');
    for (var o = 0; o < origs.length; o++) {
      origs[o].textContent = origs[o].getAttribute('data-sq-ai-orig');
      origs[o].removeAttribute('data-sq-ai-orig');
    }
    var typing = document.querySelectorAll('[data-sq-ai-typing]');
    for (var t = 0; t < typing.length; t++) typing[t].removeAttribute('data-sq-ai-typing');
    var busy = document.querySelectorAll('[data-sq-ai-busy]');
    for (var b = 0; b < busy.length; b++) busy[b].removeAttribute('data-sq-ai-busy');
    var c = document.querySelector('[data-sq-ai-preview]');
    if (!c) return;
    if (c.parentNode) c.parentNode.removeChild(c);
    this._sqReportPreviewRect(null);
    this.reportContentHeight(); // shrink the frame back — see height contract above
  };


  // ── Initialize ─────────────────────────────────────────

  window.__SQ_BRIDGE__ = new IFrameBridge();
})();

