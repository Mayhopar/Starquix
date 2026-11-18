/**
 * Bridge Part: Messaging
 *
 * PostMessage communication with parent editor.
 * Message dispatch, handler registration, and ready notification.
 */
export const BRIDGE_MESSAGING = `
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
`;
