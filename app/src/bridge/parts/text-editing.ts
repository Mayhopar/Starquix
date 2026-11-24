/**
 * Bridge Part: Text Editing (baseline capture + restore)
 *
 * handleEnterEditMode (owns the originalTextByKey capture site) and
 * handleRestoreOriginalText. Extracted byte-faithful from
 * preview-template/public/scripts/bridge.js (task-049, invariants TI-1/TI-2);
 * the snapshot-parity guard keeps the two sides aligned.
 */
export const BRIDGE_TEXT_EDITING = `
  /**
   * Restore the baseline text for a key. Sent by the parent's undo observer
   * when a sourceText entry is removed entirely (undo to before the first
   * edit) — i.e. "go back to the pre-override source text".
   */
  IFrameBridge.prototype.handleRestoreOriginalText = function(payload) {
    var key = payload && payload.key;
    if (!key) return;
    var element = this.findElementByKey(key);
    if (!element) return;
    // An element whose text holds inline markup restores that markup, so the
    // <br>/<span> comes back with the text (flat textContent would drop it).
    if (this.originalMarkupByKey && this.originalMarkupByKey[key] !== undefined) {
      element.innerHTML = this.originalMarkupByKey[key];
    } else if (this.originalTextByKey[key] !== undefined) {
      element.textContent = this.originalTextByKey[key];
    }
  };

  /**
   * Enter text edit mode on an element (contentEditable).
   * Sets a 300ms grace period to ignore stray clicks from overlay pointer-events toggle.
   * Registers blur, input, and selectionchange handlers (cleaned up in exitEditModeCleanup).
   */
  IFrameBridge.prototype.handleEnterEditMode = function(payload) {
    var key = payload && payload.key;
    var element = this.findElementByKey(key);
    if (!element || this.editingElement) return;

    var self = this;

    // Setup state
    this._editGraceUntil = Date.now() + 300;
    this.savedSelectionRange = null;
    this.editingElement = element;
    this.originalTextContent = element.textContent;
    if (key && this.hasInlineMarkup(element)) {
      // Such text commits as markup (see exitEditModeCleanup); keep the
      // first-seen inner markup so an undo can put it back on screen.
      this.originalMarkupByKey = this.originalMarkupByKey || {};
      if (this.originalMarkupByKey[key] === undefined) this.originalMarkupByKey[key] = element.innerHTML;
    }
    if (key) {
      if (payload && payload.originalText !== undefined) {
        // Authoritative pre-override source text from the parent (which owns
        // staticMarkup). Stored unconditionally so a baseline captured from an
        // already-overridden DOM (reload-with-override) never goes stale.
        this.originalTextByKey[key] = payload.originalText;
      } else if (!this.originalTextByKey[key]) {
        // Fallback: first-seen DOM text (drawn elements and other keys the
        // parent cannot resolve a source baseline for).
        this.originalTextByKey[key] = element.textContent;
      }
    }
    // Text, never structure: no ⌘B/⌘I/paste formatting the commit would drop (audit #38).
    element.contentEditable = 'plaintext-only';
    // Seamless canvas Task 1.7: a restored draft (typed before a crash or a
    // document replacement). The baselines above stay the FILE text, so exit
    // reports the change and commits it.
    var draftMarkup = payload && typeof payload.draftMarkup === 'string' ? payload.draftMarkup : null;
    if (draftMarkup !== null) element.innerHTML = draftMarkup;

    // Selection change handler - reports text selection for link editing
    var selectionHandler = function() {
      try {
        if (self.linkInteracting) return;
        var selPayload = self.buildSelectionPayload(key);
        // task-120 (5.3): selectionchange fires per caret twitch — skip the
        // send when the payload is identical to the last one.
        var sig = JSON.stringify(selPayload);
        if (sig === self._lastTextSelectionSig) return;
        self._lastTextSelectionSig = sig;
        self.sendToParent({ type: 'TEXT_SELECTION_CHANGED', payload: selPayload });
      } catch (err) {
        console.error('[Link] selectionHandler error:', err);
      }
    };
    document.addEventListener('selectionchange', selectionHandler);
    element._selectionHandler = selectionHandler;

    // Content editor: the block toolbar needs a RECT, which the shared
    // selection payload does not carry (the design-mode link flow consumes that
    // one, so it is not ours to reshape). Additive and stamp-gated, so every
    // other surface is unaffected.
    // Input handler - updates content height and debounces rect updates for overlay repositioning
    var inputHandler = function() {
      self.reportContentHeight();
      self.scheduleTextDraft();
      if (element._rectUpdateTimeout) clearTimeout(element._rectUpdateTimeout);
      element._rectUpdateTimeout = setTimeout(function() {
        var rect = element.getBoundingClientRect();
        var elementKey = element.getAttribute('data-key') || element.getAttribute('data-sq-source');
        if (elementKey) {
          self.sendToParent({
            type: 'RECT_UPDATED',
            payload: {
              key: elementKey,
              rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
            },
            timestamp: Date.now()
          });
        }
      }, 150);
    };
    element.addEventListener('input', inputHandler);
    element._inputHandler = inputHandler;

    // Blur handler - delayed to tolerate transient blur during cross-frame focus settling
    this.editBlurHandler = function() {
      setTimeout(function() {
        if (self.editingElement === element && document.activeElement !== element) {
          self.exitEditModeCleanup();
        }
      }, 200);
    };
    element.addEventListener('blur', this.editBlurHandler);

    // Window blur handler - exits edit mode when iframe loses focus (not during link interaction).
    // Uses document.hasFocus() to distinguish real focus loss from transient blur.
    this.windowBlurHandler = function() {
      setTimeout(function() {
        if (self.editingElement === element && !self.linkInteracting && !document.hasFocus()) {
          element.blur();
        }
      }, 300);
    };
    window.addEventListener('blur', this.windowBlurHandler);

    // Focus and select all text (a restored draft continues at its end instead)
    element.focus();
    var range = document.createRange();
    range.selectNodeContents(element);
    if (draftMarkup !== null) range.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  // Seamless canvas (plan 2026-10-04 Task 1.6): mirror typed text to the parent,
  // which keeps it in <project>/.sq/drafts until the commit is accepted.
  // ponytail: 300 ms trailing debounce + flush on pagehide/hidden/boundary.
  // Ceiling: an Electron renderer crash loses ≤300 ms of typing.
  IFrameBridge.prototype.scheduleTextDraft = function() {
    var self = this;
    if (this._draftTimer) clearTimeout(this._draftTimer);
    this._draftTimer = setTimeout(function() { self._draftTimer = null; self.flushTextDraft(); }, 300);
  };

  IFrameBridge.prototype.flushTextDraft = function() {
    var el = this.editingElement;
    if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }
    if (!el) return;
    var key = el.getAttribute('data-key') || el.getAttribute('data-sq-source');
    if (!key) return;
    this.sendToParent({ type: 'TEXT_DRAFT', payload: {
      key: key, file: (el.getAttribute('data-sq-source') || '').split(':')[0],
      sourceVersion: el.getAttribute('data-sq-source-version') || '',
      markup: this.sanitizeLinkHtml(this.cleanClone(el).innerHTML), page: location.pathname } });
  };

`;
