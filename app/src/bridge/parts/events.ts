/**
 * Bridge Part: Event Listeners
 *
 * Mouse, keyboard, and wheel event handlers for design mode.
 * Click detection, hover tracking, drag initiation.
 */
import { BARE_SHORTCUT_KEYS, SHIFTED_SHORTCUT_CODE, COMBO_SHORTCUT_KEYS } from '../globalShortcuts.ts';
import { shortcutKey } from '../shortcutKey.js';

export const BRIDGE_EVENTS = `
  // Interpolated from bridge/globalShortcuts.ts — THE one list of bare-key
  // editor shortcuts. Never hardcode keys here; add them there.
  var SQ_BARE_SHORTCUT_KEYS = ${JSON.stringify(BARE_SHORTCUT_KEYS)};
  var SQ_SHIFTED_SHORTCUT_CODE = ${JSON.stringify(SHIFTED_SHORTCUT_CODE)};
  var SQ_COMBO_SHORTCUT_KEYS = ${JSON.stringify(COMBO_SHORTCUT_KEYS)};
  // bridge/shortcutKey.js verbatim: the frame reads a key exactly as the editor does.
  var sqShortcutKey = ${shortcutKey};

  IFrameBridge.prototype.setupEventListeners = function() {
    this.boundHandlers = {
      mousedown: this.handleMouseDown.bind(this),
      mouseup: this.handleMouseUp.bind(this),
      mousemove: this.handleMouseMove.bind(this),
      mouseleave: this.handleMouseLeave.bind(this),
      click: this.handleNativeClick.bind(this),
      wheel: this.handleWheel.bind(this),
      keydown: this.handleKeyDown.bind(this),
      dragover: this.handleFileDragOver.bind(this),
      drop: this.handleFileDrop.bind(this)
    };

    if (this.mode === 'design') {
      this.addDesignModeListeners();
    }
  };

  IFrameBridge.prototype.handleKeyDown = function(event) {
    // Handle Escape to cancel flow drag
    if (event.key === 'Escape' && this._flowDrag._state) {
      this._flowDrag.handleCancel();
      event.preventDefault();
      return;
    }
    // Handle Escape to exit text edit mode
    if (event.key === 'Escape' && this.editingElement) {
      this.exitEditModeCleanup();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Focus inside this (cross-origin) iframe means the PARENT's document
    // keydown listener never fires — this relay is the only way an editor
    // shortcut survives. Forward by rule for modifier combos and control keys;
    // bare letters/digits need the explicit allowlist, because they are
    // otherwise indistinguishable from the user typing on the real page.
    var hasModifier = event.metaKey || event.ctrlKey;
    var isForwardableKey = ['Tab', 'Enter', 'Escape', 'Backspace', 'Delete'].indexOf(event.key) !== -1;
    var isBareShortcut = !hasModifier && !event.shiftKey && !event.altKey &&
      SQ_BARE_SHORTCUT_KEYS.indexOf(sqShortcutKey(event)) !== -1;
    // Shift+1 (zoom to fit) is the one SHIFTED bare shortcut; shifted Digit1
    // reports key '!' so it has to be matched on event.code.
    var isShiftedShortcut = !hasModifier && event.shiftKey && !event.altKey &&
      event.code === SQ_SHIFTED_SHORTCUT_CODE;

    if (!hasModifier && !isForwardableKey && !isBareShortcut && !isShiftedShortcut) return;

    // Text entry inside the preview keeps its keystrokes — a shortcut letter is
    // just a character to a form field, and swallowing it here would break
    // typing on the real page (and in-place text editing).
    var target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' || target.isContentEditable)) {
      return;
    }

    this.sendToParent({
      type: 'KEYBOARD_EVENT',
      payload: {
        key: event.key,
        code: event.code,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey
      }
    });

    // Prevent default for forwardable keys and the combos the editor handles;
    // any other combo (⌘W, ⌘Q, ⌘M, ⌘,) still reaches the app menu.
    if (isForwardableKey || (hasModifier && SQ_COMBO_SHORTCUT_KEYS.indexOf(sqShortcutKey(event)) !== -1)) {
      event.preventDefault();
    }
  };

  IFrameBridge.prototype.addDesignModeListeners = function() {
    if (this.listenersActive) return;
    this.listenersActive = true;
    this.toggleDesignModeListeners(true);
  };

  IFrameBridge.prototype.removeDesignModeListeners = function() {
    if (!this.listenersActive) return;
    this.listenersActive = false;
    this.toggleDesignModeListeners(false);
  };

  // ── Preview mode (task-116) ────────────────────────────
  // Design mode intercepts everything (click/hover/drag/wheel); preview drops
  // every one of those listeners so the page behaves natively, and swaps in a
  // single link listener. Repeat sends are a no-op — the parent re-sends
  // SET_MODE on every IFRAME_READY, which fires on each HMR full-reload.
  IFrameBridge.prototype.handleSetMode = function(payload) {
    var newMode = (payload && payload.mode) || 'design';
    // Design viewport height rides SET_MODE: one message says what mode the
    // frame is in AND what a vh means there (vh-pin.ts). A breakpoint change
    // re-sends with the same mode and a new height.
    var height = payload && payload.designViewportHeight;
    var validHeight = typeof height === 'number' && isFinite(height) && height > 0;
    if (newMode !== this.mode) {
      this.mode = newMode;
      if (this.mode === 'design') {
        this.addDesignModeListeners();
        this.removePreviewListeners();
      } else {
        this.removeDesignModeListeners();
        this.addPreviewListeners();
      }
      this.updateDesignModeStyles();
    }
    if (this.mode !== 'design') { this.unpinDesignViewport(); return; }
    if (validHeight) this.pinDesignViewport(height);
  };

  IFrameBridge.prototype.addPreviewListeners = function() {
    if (this.previewListenersActive) return;
    this.previewListenersActive = true;
    if (!this.boundPreviewNavClick) {
      this.boundPreviewNavClick = this.handlePreviewLinkClick.bind(this);
    }
    if (!this.boundPreviewKeyDown) {
      this.boundPreviewKeyDown = this.handlePreviewKeyDown.bind(this);
    }
    document.addEventListener('click', this.boundPreviewNavClick, true);
    document.addEventListener('keydown', this.boundPreviewKeyDown, true);
  };

  IFrameBridge.prototype.removePreviewListeners = function() {
    if (!this.previewListenersActive) return;
    this.previewListenersActive = false;
    document.removeEventListener('click', this.boundPreviewNavClick, true);
    document.removeEventListener('keydown', this.boundPreviewKeyDown, true);
  };

  /**
   * Esc is preview's escape hatch — but the moment the user clicks anything
   * (the whole point of preview) the focus is INSIDE this iframe, so the
   * editor's own document-level keydown listener never sees the key. Confirmed
   * live: document.activeElement in the parent becomes the IFRAME.
   *
   * Forward Escape and NOTHING else (preview is read-only) over the existing
   * KEYBOARD_EVENT channel, which the parent re-dispatches on its own document.
   */
  IFrameBridge.prototype.handlePreviewKeyDown = function(event) {
    if (event.key !== 'Escape') return;
    this.sendToParent({
      type: 'KEYBOARD_EVENT',
      payload: {
        key: 'Escape',
        code: 'Escape',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        altKey: false
      }
    });
  };

  /**
   * Internal links carry the PUBLISHED href ('/' or '/slug' — see pageHref in
   * utils/slugify.ts), but this iframe is served at /preview/{projectId}/{pageId}
   * and no such route exists. Letting the click through would 404 the iframe and
   * take the bridge with it, so the parent resolves the href to a page instead.
   * Everything genuinely external stays native.
   */
  IFrameBridge.prototype.handlePreviewLinkClick = function(event) {
    // task-132 local mode: the iframe serves REAL routes — let the browser
    // (or the site's own router) navigate natively (nothing below prevents the
    // default there). But the editor must FOLLOW the navigation (parity gap
    // 25/58: the doc kept naming the old page, so the task-133 wrong-file
    // guard refused every structural op until a manual page click) — so an
    // internal link still sends the SAME PREVIEW_NAVIGATE announce WC uses,
    // and the parent maps the route to the doc page and selects it.
    var isLocal = !!window.__SQ_LOCAL_MODE__;
    var link = this.findClosestLink(event.target);
    if (!link) return;

    // Blog-card post links: the card's <a> href points at the published post
    // route ('/blog/posts/slug'), which findPageByHref cannot match (posts
    // are slug-driven). Send slug + slot key instead so the parent opens the
    // designed post page. Anchor-gated: postLinkMode 'none' renders bare
    // cards (no <a>) and correctly stays inert. WC only — a LOCAL blog card
    // points at a real route the site serves itself, so it falls through to
    // the generic internal-link announce below.
    if (!isLocal && link.hasAttribute('data-sq-post-slug')) {
      var postsWrapper = link.closest('[data-blog-source="posts"], [data-key$=":posts"]');
      // Both wrapper key shapes ('<slotId>:div-N' / '<slotId>:posts') carry
      // the slot id as their first segment.
      var wrapperKey = postsWrapper && postsWrapper.getAttribute('data-key');
      var slotKey = wrapperKey ? wrapperKey.split(':')[0] : null;
      if (slotKey) {
        event.preventDefault();
        this.sendToParent({
          type: 'PREVIEW_NAVIGATE',
          payload: { postSlug: link.getAttribute('data-sq-post-slug'), slotKey: slotKey }
        });
        return;
      }
    }
    if (link.target && link.target !== '_self') return;   // new tab/window
    if (link.hasAttribute('download')) return;

    var raw = link.getAttribute('href');
    if (!raw) return;
    if (raw.charAt(0) === '#') return;                    // in-page anchor: native scroll (D1)

    var url;
    try { url = new URL(link.href); } catch (e) { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;  // mailto:, tel:
    if (url.origin !== window.location.origin) return;                 // cross-origin

    // Local: announce only — the navigation itself stays native (files-truth,
    // task-132). WC: block the click, or the iframe 404s off the bare shell.
    if (!isLocal) event.preventDefault();
    // pathname, not the raw attribute: drops a cross-page '#anchor' suffix that
    // would otherwise miss the parent's matcher. The anchor scroll is lost.
    this.sendToParent({ type: 'PREVIEW_NAVIGATE', payload: { href: url.pathname } });
  };

  IFrameBridge.prototype.handleNativeClick = function(event) {
    var target = this.findEditableElement(event.target, true);
    if (target) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    }
  };

  IFrameBridge.prototype.handleMouseDown = function(event) {
    // Outside text editing a double-click selects or edits elements, never words (audit #40).
    if (event.detail > 1 && !this.editingElement) event.preventDefault();
    this.mouseDownTarget = event.target;
    this.mouseDownPos = { x: event.clientX, y: event.clientY };
    this.isDragging = false;
  };

  IFrameBridge.prototype.handleMouseUp = function(event) {
    var dx = Math.abs(event.clientX - this.mouseDownPos.x);
    var dy = Math.abs(event.clientY - this.mouseDownPos.y);
    var isClick = dx < CLICK_MOVE_THRESHOLD_PX && dy < CLICK_MOVE_THRESHOLD_PX;

    if (isClick && !this.isDragging) {
      this.handleClick(event);
    }

    this.isDragging = false;
    this.mouseDownTarget = null;
  };

  IFrameBridge.prototype.handleWheel = function(event) {
    // task-132 local mode: the iframe IS a real scrollable viewport (fixed
    // device height; vh sites need it). Plain wheel scrolls the page
    // natively; only zoom gestures (ctrl/meta) forward to the canvas.
    if (window.__SQ_LOCAL_MODE__ && !event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    // task-120 (5.3): wheel events outpace paint — accumulate deltas and
    // flush ONE message per animation frame (position/modifiers = latest).
    var self = this;
    if (!this._wheelAccum) {
      this._wheelAccum = { deltaX: 0, deltaY: 0 };
    }
    this._wheelAccum.deltaX += event.deltaX;
    this._wheelAccum.deltaY += event.deltaY;
    this._wheelAccum.clientX = event.clientX;
    this._wheelAccum.clientY = event.clientY;
    this._wheelAccum.ctrlKey = event.ctrlKey;
    this._wheelAccum.metaKey = event.metaKey;
    if (this._wheelRaf) return;
    this._wheelRaf = requestAnimationFrame(function() {
      self._wheelRaf = 0;
      var acc = self._wheelAccum;
      self._wheelAccum = null;
      if (!acc) return;
      self.sendToParent({
        type: 'WHEEL',
        payload: {
          deltaX: acc.deltaX,
          deltaY: acc.deltaY,
          clientX: acc.clientX,
          clientY: acc.clientY,
          ctrlKey: acc.ctrlKey,
          metaKey: acc.metaKey
        }
      });
    });
  };

  IFrameBridge.prototype.handleClick = function(event) {
    try {
      if (this._blogCardKeysDirty) {
        this._ensureBlogCardKeys();
      }

      // Prevent link navigation in design mode
      if (this.preventLinkNavigation(event.target)) {
        event.preventDefault();
      }

      // Clicked outside editing element - exit edit mode (unless within grace period)
      if (this.editingElement && event.target !== this.editingElement && !this.editingElement.contains(event.target) && Date.now() > this._editGraceUntil) {
        this.exitEditModeCleanup();
      }

      // Handle clicks within editing element
      if (this.editingElement && (event.target === this.editingElement || this.editingElement.contains(event.target))) {
        // Only set cursor for single clicks; multi-clicks use native selection
        if (event.detail === 1) {
          this.setCaretAtPoint(event.clientX, event.clientY);
        }
        return;
      }

      // A ⌘D copy painted before its write lands has no real key for ~70 ms;
      // selecting it pinned a temporary key every later edit refused ("not
      // saved", 2026-11-08). Ignore the click — the pending selection moves
      // to the copy the moment its key lands.
      if (event.target && event.target.closest && event.target.closest('[data-sq-predicted]')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      var isDirectSelect = event.metaKey || event.ctrlKey;
      var isShift = !!event.shiftKey; // multi-select toggle: the host decides, the bridge never drills
      var blogCtx = this._resolveBlogClickContext(event.target);

      var target = this.findEditableElement(blogCtx.resolvedTarget, true, isDirectSelect);
      if (!target) return;

      var key = this.getElementKey(target);
      if (!key) return;

      event.preventDefault();
      event.stopPropagation();

      var now = Date.now();
      var isDoubleClick = (key === this.lastClickKey) && (now - this.lastClickTime < DOUBLE_CLICK_THRESHOLD_MS);
      this.lastClickKey = key;
      this.lastClickTime = now;

      var hasChildren = this.hasBlockChildren(target);

      // Double-click with children: drill down AND select child under cursor
      if (isDoubleClick && hasChildren && !isDirectSelect && !isShift) {
        if (this.handleDrillDown(event, target, key)) {
          // Reset so the next click is a fresh single-click — prevents rapid
          // tapping on the same area from chain-drilling slot → :posts → :post-link.
          this.lastClickKey = null;
          this.lastClickTime = 0;
          return;
        }
      }

      var payload = this.buildElementPayload(target, {
        isDoubleClick: isDoubleClick,
        isDirectSelect: isDirectSelect,
        isOutsideContext: this.isClickOutsideContext(target, key),
        altKey: event.altKey,
        shiftKey: isShift
      }, { rawTarget: event.target, clickedCardWrapper: blogCtx.clickedCardWrapper });

      this.sendToParent({ type: 'ELEMENT_CLICK', payload: payload });

      // Async: capture bg image preview and send as follow-up message
      this.captureAndSendBgImagePreview(target, key);
    } catch (error) {
      console.error('[IFrameBridge] handleClick error:', error);
    }
  };

  IFrameBridge.prototype.handleMouseMove = function(event) {
    if (this.mouseDownTarget && event.buttons > 0) {
      var dx = Math.abs(event.clientX - this.mouseDownPos.x);
      var dy = Math.abs(event.clientY - this.mouseDownPos.y);
      if (dx > DRAG_START_THRESHOLD_PX || dy > DRAG_START_THRESHOLD_PX) {
        this.isDragging = true;
      }
    }

    if (this.isDragging || event.buttons > 0) return;

    if (this.throttledHover) return;
    var self = this;
    this.throttledHover = setTimeout(function() { self.throttledHover = null; }, HOVER_THROTTLE_MS);

    var target = this.findEditableElement(event.target, true);
    if (!target) {
      if (this.lastHoveredKey) {
        this.lastHoveredKey = null;
        this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
      }
      return;
    }

    var key = this.getElementKey(target);
    if (!key || key === this.lastHoveredKey) return;

    this.lastHoveredKey = key;
    var parentEl = this.findEditableElement(target.parentElement);
    var parentKey = parentEl ? this.getElementKey(parentEl) : null;

    this.sendToParent({
      type: 'ELEMENT_HOVER',
      payload: {
        key: key,
        tagName: target.tagName.toLowerCase(),
        computedStyles: this.getComputedStyles(target),
        rect: this.rectOf(target),
        parentKey: parentKey
      }
    });
  };

  // ── task-141: direct canvas file drop — no arming step ──────────────────
  // OS file drags never reach handleMouseMove (no mousemove during drag), so
  // dragover reuses the hover-outline pipeline to highlight the drop target.
  IFrameBridge.prototype.handleFileDragOver = function(event) {
    var types = event.dataTransfer && event.dataTransfer.types;
    if (!types || Array.prototype.indexOf.call(types, 'Files') === -1) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (this.throttledHover) return;
    var self = this;
    this.throttledHover = setTimeout(function() { self.throttledHover = null; }, HOVER_THROTTLE_MS);

    var target = this.findEditableElement(event.target, true);
    if (!target) {
      if (this.lastHoveredKey) {
        this.lastHoveredKey = null;
        this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
      }
      return;
    }
    var key = this.getElementKey(target);
    if (!key || key === this.lastHoveredKey) return;
    this.lastHoveredKey = key;
    this.sendToParent({
      type: 'ELEMENT_HOVER',
      payload: {
        key: key,
        tagName: target.tagName.toLowerCase(),
        computedStyles: this.getComputedStyles(target),
        rect: this.rectOf(target),
        parentKey: null
      }
    });
  };

  IFrameBridge.prototype.handleFileDrop = function(event) {
    var dt = event.dataTransfer;
    if (!dt || !dt.files || dt.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.lastHoveredKey) {
      this.lastHoveredKey = null;
      this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
    }
    // directSelect: a file drop applies to the element UNDER THE CURSOR —
    // outermost-ancestor resolution made every drop target the page root,
    // so imgs (incl. content-bound astro <Image>) were unreachable (task-142).
    var target = this.findEditableElement(event.target, true, true);
    var payload = null;
    if (target) {
      payload = this.buildElementPayload(target, { computedStyles: true });
      // <a> ancestors are not drop targets (design rule 6 exclusion)
      payload.insideAnchor = !!(target.closest && target.closest('a'));
    }
    // File objects survive postMessage via structured clone
    this.sendToParent({
      type: 'CANVAS_FILE_DROP',
      payload: { target: payload, files: Array.prototype.slice.call(dt.files) }
    });
  };

  IFrameBridge.prototype.handleMouseLeave = function() {
    // If a flow drag is active, don't kill the drag — it may be
    // exiting for reparent mode or layers panel handoff
    if (this._flowDrag && this._flowDrag._state) {
      // Hide ghost — it's now outside the iframe
      if (this._flowDrag._state.ghost) {
        this._flowDrag._state.ghost.style.display = 'none';
      }
      this._flowDrag._cleanupIndicators();
      this.sendToParent({
        type: 'DRAG_ELEMENT_EXIT_IFRAME',
        payload: { key: this._flowDrag._state.key }
      });
      // Still clear hover state
      if (this.lastHoveredKey) {
        this.lastHoveredKey = null;
        this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
      }
      return;
    }
    this.isDragging = false;
    this.mouseDownTarget = null;
    if (this.lastHoveredKey) {
      this.lastHoveredKey = null;
      this.sendToParent({ type: 'ELEMENT_HOVER_END', payload: {} });
    }
  };
`;
