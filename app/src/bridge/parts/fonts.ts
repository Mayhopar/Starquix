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
`;
