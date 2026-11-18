/**
 * Bridge Part: Design Mode Styles
 *
 * Injects and manages CSS styles for design mode
 * (pointer cursors, visual indicators).
 */
export const BRIDGE_STYLES = `

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
`;
