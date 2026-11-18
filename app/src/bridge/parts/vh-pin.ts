/**
 * Bridge Part: Design-viewport vh pin
 *
 * Design mode never scrolls (owner ruling 2026-09-10, ledger
 * docs/plans/2026-09-10-design-mode-no-scroll-ledger.md). The canvas fits the
 * frame to the whole page, which cannot converge while a page has 100vh
 * sections — every frame growth re-grows the section. So in design mode every
 * `vh` (and dvh/svh/lvh) in the document's OWN stylesheets resolves against the
 * breakpoint's design viewport height instead of the iframe: an override
 * stylesheet re-emits each vh-bearing declaration under the same selector and
 * @media/@supports/@layer chain with the token replaced by pixels, !important,
 * last in <head>. Preview mode removes it — real vh, native scroll.
 *
 * Editor rendering aid only: never touches source, export or the built site.
 * Not covered (documented): inline style="…vh", JS reading innerHeight,
 * cross-origin stylesheets (cssRules throws → skipped).
 */
export const BRIDGE_VH_PIN = `
  var VH_TOKEN_RE = /(-?\\d*\\.?\\d+)(d|s|l)?vh\\b/gi;

  /** Override CSS for every same-origin vh declaration, resolved at \`height\`. */
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
    return out.join('\\n');
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
`;
