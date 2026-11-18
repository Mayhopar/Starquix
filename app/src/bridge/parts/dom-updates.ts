/**
 * Bridge Part: DOM Updates
 *
 * Handles all incoming DOM mutations: class updates,
 * text changes, link attributes, element reordering,
 * reparenting, mode switching, and HMR relay.
 */
export const BRIDGE_DOM_UPDATES = `
  

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
   * ⌘D, predicted: a copy of \`key\` after \`anchorKey\` (or inside its end).
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
    var bgUrlMatch = resolvedClasses.match(/bg-\\[url\\(['"]?(.+?)['"]?\\)\\]/);
    var bgUrl = bgUrlMatch ? bgUrlMatch[1] : null;

    // First, update the target element if found by key
    if (targetElement) {
      var currentClasses = this.getElementClasses(targetElement);
      // task-151: THE pre-override baseline. This is the only moment anything
      // in the system still holds the element as the SOURCE renders it — the
      // parent's snapshots hold overrides, and the scan payload reports
      // \`getElementClasses\` live, so it reports the override as soon as any
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
   * The captured baseline wins; \`payload.fallbackClasses\` (the parent's
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
      var bgUrlMatch = resolvedClasses.match(/bg-\\[url\\(['"]?(.+?)['"]?\\)\\]/);
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
`;
