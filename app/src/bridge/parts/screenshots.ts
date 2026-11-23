/**
 * Bridge Part: Screenshots & Simulation
 *
 * Page screenshot capture via SVG foreignObject,
 * image inlining, and click/hover simulation.
 */
export const BRIDGE_SCREENSHOTS = `
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
        var match = bg.match(/url\\(["']?((?:https?:\\/\\/|\\/)[^"')]+)["']?\\)/);
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
`;
