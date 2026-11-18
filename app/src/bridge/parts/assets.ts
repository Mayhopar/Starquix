/**
 * IFrameBridge Part: Asset Pipeline
 *
 * Receives uploaded assets from the editor as ArrayBuffers (TRANSFER_ASSET),
 * creates iframe-origin blob URLs, and resolves `sq-asset:` references in
 * classes, inline styles, and image attributes — including deferred
 * resolution for elements that arrive after the asset.
 *
 * Constructor state: _assetMap, _pendingAssetClasses, _pendingAssetImages.
 */

export const BRIDGE_ASSETS = `

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
        var bgMatch = resolved.match(/bg-\\[url\\(['"]?(.+?)['"]?\\)\\]/);
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
      // Escape the selector: bg-[url('sq-asset:xxx')] → .bg-\\[url\\(\\'sq-asset\\:xxx\\'\\)\\]
      var escaped = 'bg-\\\\[url\\\\(\\\\\\'sq-asset\\\\:' + assetId + '\\\\\\'\\\\)\\\\]';
      rules.push('.' + escaped + ' { background-image: url(\\'' + blobUrl + '\\') !important; }');
    }

    style.textContent = rules.join('\\n');
  };
`;
