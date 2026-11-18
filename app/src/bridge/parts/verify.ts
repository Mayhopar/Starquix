/**
 * IFrameBridge Part: AI layout verification (VERIFY_LAYOUT → LAYOUT_VERIFIED).
 * Computes rendered-DOM facts (overlap, overflow, zero-size, contrast) for the
 * AI agent's verify step — deterministic, no screenshots.
 */

export const BRIDGE_VERIFY = `

  IFrameBridge.prototype._sqLuminance = function(rgbStr) {
    var m = rgbStr.match(/rgba?\\(([^)]+)\\)/);
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
`;
