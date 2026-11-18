/**
 * IFrameBridge Part: Selection/Highlight Overlay
 *
 * Selection highlight box, hover/AI highlight overlays, and point-based
 * element picking (PICK_ELEMENT_AT_POINT) used by the editor's
 * pick-element flows.
 */

export const BRIDGE_SELECTION = `

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
`;
