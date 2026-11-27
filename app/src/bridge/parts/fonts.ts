/**
 * IFrameBridge Part: Project Fonts
 *
 * Receives baked @font-face CSS (with sq-asset: URLs) via SET_FONTS_CSS,
 * resolves refs against _assetMap, and maintains <style id="sq-fonts">.
 * Re-resolved on every TRANSFER_ASSET so late-arriving bytes self-heal.
 */
export const BRIDGE_FONTS = `

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

// FONT_FAMILIES: every family this page declares (@font-face from any
// stylesheet, loaded or not) — the font picker lists the site's own fonts.
IFrameBridge.prototype.reportFontFamilies = function() {
    // Chrome serializes a spaced family as a CSS string: "Open Sans". The editor dedupes.
    var families = Array.from(document.fonts || [], function(face) {
      return String(face.family || '').replace(/^\\s*["']|["']\\s*$/g, '').trim();
    }).filter(Boolean);
    this.sendToParent({ type: 'FONT_FAMILIES', payload: { fontFamilies: families } });
  };

// The CSS tab, a picked font and CSS HMR change only <head>, which scans ignore.
IFrameBridge.prototype.watchFontFamilies = function() {
    var self = this, timer = null;
    new MutationObserver(function() {
      clearTimeout(timer);
      timer = setTimeout(function() { self.reportFontFamilies(); }, 300);
    }).observe(document.head || document.documentElement, { childList: true, subtree: true, characterData: true });
  };
`;
