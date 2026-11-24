/**
 * IFrameBridge Part: Edit Mode, Links & HMR Relay
 *
 * ContentEditable text editing (enter/exit, caret placement, range
 * reconstruction), link wrap/unwrap + sanitization, and the HMR write
 * relay (SQ_WRITE_TEXT / SQ_WRITE_IMAGE via callHmrFunction with retry).
 *
 * ⚠️ Mind the text-editing guards (blur/detach interactions — see
 * MEMORY.md): DOM-mutating handlers check this.editingElement before
 * touching the DOM. Ported verbatim from bridge.js.
 */

export const BRIDGE_EDIT_MODE = `


/** Text holding elements (<br>, <span>, <strong>…) commits as markup — flat
 *  textContent would drop them (audit #3) — unless a link carrier already owns
 *  this element's markup. Editing is plaintext-only, so the elements are the
 *  ones that were there. */
IFrameBridge.prototype.hasInlineMarkup = function(element) {
    return element.children.length > 0 && !element.querySelector('a');
};

/** Inner markup to commit for such text, bookkeeping attributes stripped;
 *  null = plain text is exact. Rides the same markup channel links use. */
IFrameBridge.prototype.editedInlineMarkup = function(element) {
    return this.hasInlineMarkup(element) ? this.sanitizeLinkHtml(this.cleanClone(element).innerHTML) : null;
};

IFrameBridge.prototype.exitEditModeCleanup = function() {
    if (!this.editingElement) return;
    this._editGraceUntil = 0;

    var element = this.editingElement;
    var editKey = element.getAttribute('data-key') || element.getAttribute('data-sq-source');
    var newText = element.textContent;
    var inlineMarkup = newText !== this.originalTextContent && editKey ? this.editedInlineMarkup(element) : null;

    // Remove event listeners to prevent double-firing
    if (this.editBlurHandler) {
      element.removeEventListener('blur', this.editBlurHandler);
      this.editBlurHandler = null;
    }
    if (element._selectionHandler) {
      document.removeEventListener('selectionchange', element._selectionHandler);
      delete element._selectionHandler;
    }
    if (element._inputHandler) {
      element.removeEventListener('input', element._inputHandler);
      delete element._inputHandler;
    }
    if (element._rectUpdateTimeout) {
      clearTimeout(element._rectUpdateTimeout);
      delete element._rectUpdateTimeout;
    }
    if (this.windowBlurHandler) {
      window.removeEventListener('blur', this.windowBlurHandler);
      this.windowBlurHandler = null;
    }

    element.contentEditable = 'false';
    element.blur();

    var selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    // The commit's draft is on disk BEFORE the commit is sent (seamless canvas
    // D8: the parent clears it only once the commit is accepted). The 300 ms
    // debounce would otherwise fire after exit with nothing to flush, and a
    // refused commit lost fast-typed text entirely (desktop 2026-10-04).
    var original = this.originalTextContent;
    if (newText !== original || inlineMarkup !== null) this.flushTextDraft();
    else if (this._draftTimer) { clearTimeout(this._draftTimer); this._draftTimer = null; }

    // A markup write carries the whole edit; it then reports the text as
    // unchanged so the parent does not also write a flattened plain-text copy.
    if (inlineMarkup !== null) this.sendToParent({ type: 'MARKUP_CHANGED', payload: { key: editKey, innerHTML: inlineMarkup } });
    this.sendToParent({
      type: 'EDIT_MODE_EXITED',
      payload: { key: editKey, textContent: newText, originalText: inlineMarkup !== null ? newText : this.originalTextContent }
    });

    var changed = newText !== this.originalTextContent;
    this.editingElement = null;
    this.originalTextContent = null;
    // Seamless canvas: run a refresh held during the edit (source-refresh.ts).
    if (this.onEditExitedForRefresh) this.onEditExitedForRefresh(element, changed, original);
  };

IFrameBridge.prototype.findTextNode = function(element, textContent) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent === textContent) {
        return walker.currentNode;
      }
    }
    return null;
  };

IFrameBridge.prototype.findTextNodeContaining = function(element, substring) {
    var walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    while (walker.nextNode()) {
      var nodeText = walker.currentNode.textContent;
      if (nodeText) {
        var idx = nodeText.indexOf(substring);
        if (idx !== -1) {
          return { node: walker.currentNode, index: idx };
        }
      }
    }
    return null;
  };

IFrameBridge.prototype.reconstructRangeFromSaved = function(saved, element) {
    if (!saved || !element) return null;

    if (saved.startOffset !== undefined && saved.endOffset !== undefined) {
      var textNode = this.findTextNode(element, saved.textContent);
      // Use local variables to avoid mutating saved object
      var startOffset = saved.startOffset;
      var endOffset = saved.endOffset;

      if (!textNode) {
        var result = this.findTextNodeContaining(element, saved.selectedText);
        if (result) {
          textNode = result.node;
          // Update local variables, not the saved object
          startOffset = result.index;
          endOffset = result.index + saved.selectedText.length;
        }
      }

      if (textNode && startOffset < textNode.length && endOffset <= textNode.length) {
        var range = document.createRange();
        range.setStart(textNode, startOffset);
        range.setEnd(textNode, endOffset);
        return range;
      }
    }

    return saved.range || null;
  };

IFrameBridge.prototype.setCaretAtPoint = function(x, y) {
    var range;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(x, y);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(x, y);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }

    if (range) {
      var selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
  };

IFrameBridge.prototype.getEditableParentKey = function(element) {
    var parentEl = this.findEditableElement(element.parentElement);
    return parentEl ? this.getElementKey(parentEl) : null;
  };




IFrameBridge.prototype.findClosestLink = function(node) {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return node.parentElement ? node.parentElement.closest('a') : null;
    }
    return node.closest ? node.closest('a') : null;
  };

IFrameBridge.prototype.preventLinkNavigation = function(target) {
    if (!target) return;
    if (target.tagName === 'A' || target.closest('a')) {
      return true;
    }
    return false;
  };

IFrameBridge.prototype.callHmrFunction = function(funcName, payload, resultType) {
    var self = this;

    if (typeof window[funcName] === 'function') {
      window[funcName](payload);
      return;
    }

    var retryCount = 0;
    var maxRetries = 20;
    var checkInterval = setInterval(function() {
      retryCount++;
      if (typeof window[funcName] === 'function') {
        clearInterval(checkInterval);
        window[funcName](payload);
      } else if (retryCount >= maxRetries) {
        clearInterval(checkInterval);
        console.error('[IFrameBridge] HMR module not available after retries');
        self.sendToParent({
          type: resultType,
          payload: {
            requestId: payload.requestId,
            success: false,
            error: 'HMR module not available'
          }
        });
      }
    }, 100);
  };

IFrameBridge.prototype.handleWriteText = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_TEXT payload:', payload);
      return;
    }
    this.callHmrFunction('__SQ_WRITE_TEXT__', payload, 'SQ_WRITE_TEXT_RESULT');
  };

IFrameBridge.prototype.handleWriteImage = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.attribute) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_IMAGE payload:', payload);
      return;
    }
    this.callHmrFunction('__SQ_WRITE_IMAGE__', payload, 'SQ_WRITE_IMAGE_RESULT');
  };

// task-140 media fill: container -> img/video tag swap in the real file
IFrameBridge.prototype.handleWriteTagSwap = function(payload) {
    // task-141: kind 'container' (un-resolve) legitimately carries src: ''
    var srcOk = payload && (payload.kind === 'container' || (payload.kind === 'image-fill' && payload.imageFill && typeof payload.imageFill.expectedTag === 'string' && payload.imageFill.change) || !!payload.src);
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.kind || !srcOk) {
      console.error('[IFrameBridge] Invalid SQ_WRITE_TAG_SWAP payload:', payload);
      return;
    }
    this.callHmrFunction('__SQ_WRITE_TAG_SWAP__', payload, 'SQ_WRITE_TAG_SWAP_RESULT');
  };

// task-133 structural ops: insert/remove/move keyed elements + import
// management in the real source file (local/server write channel).

// Task 10 sweep: shared invalid-payload rejection. Without the reply the
// parent's BaseViteWriter burns its full 10s timeout on a malformed payload;
// the failure reply mirrors callHmrFunction's retry-exhaustion shape. No
// requestId → nothing to reply to (console.error only).
IFrameBridge.prototype.rejectInvalidWrite = function(payload, msgType, resultType) {
    console.error('[IFrameBridge] Invalid ' + msgType + ' payload:', payload);
    if (payload && payload.requestId) {
      this.sendToParent({
        type: resultType,
        payload: { requestId: payload.requestId, success: false, error: 'invalid payload' }
      });
    }
  };

IFrameBridge.prototype.handleWriteInsert = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.markup || !payload.position) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_INSERT', 'SQ_WRITE_INSERT_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_INSERT__', payload, 'SQ_WRITE_INSERT_RESULT');
  };

// Fix 1 (task-148): page-body append — sourceLocation carries the page FILE
// only (no line/column: component-only pages have no DOM anchor at all).
IFrameBridge.prototype.handleWriteAppendPage = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.markup) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_APPEND_PAGE', 'SQ_WRITE_APPEND_PAGE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_APPEND_PAGE__', payload, 'SQ_WRITE_APPEND_PAGE_RESULT');
  };

IFrameBridge.prototype.handleWriteRemove = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_REMOVE', 'SQ_WRITE_REMOVE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_REMOVE__', payload, 'SQ_WRITE_REMOVE_RESULT');
  };

IFrameBridge.prototype.handleWriteMove = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.targetLocation || !payload.position) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_MOVE', 'SQ_WRITE_MOVE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_MOVE__', payload, 'SQ_WRITE_MOVE_RESULT');
  };

// task-133 Task 8: verbatim restore of previously removed bytes (undo inverse
// of remove/move) — text is the byte-exact removedSource, never re-indented.
IFrameBridge.prototype.handleWriteRestore = function(payload) {
    if (!payload || !payload.sourceLocation || !payload.requestId || !payload.text) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_RESTORE', 'SQ_WRITE_RESTORE_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_RESTORE__', payload, 'SQ_WRITE_RESTORE_RESULT');
  };

// live-smoke Critical: region restore — byte-exact inverse of an insert/move
// splice. segment may legitimately be '' (own-line splice inverse = delete
// the inserted lines), so validate its TYPE, not truthiness.
IFrameBridge.prototype.handleWriteRestoreRegion = function(payload) {
    var lineCountOk = payload && typeof payload.lineCount === 'number' && payload.lineCount >= 1;
    var segmentOk = payload && typeof payload.segment === 'string';
    if (!payload || !payload.sourceLocation || !payload.requestId || !lineCountOk || !segmentOk) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_RESTORE_REGION', 'SQ_WRITE_RESTORE_REGION_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_RESTORE_REGION__', payload, 'SQ_WRITE_RESTORE_REGION_RESULT');
  };

IFrameBridge.prototype.handleWriteImport = function(payload) {
    // An empty string names a side-effect addition, never an unnamed removal.
    var nameOk = payload && typeof payload.name === 'string' && (payload.name !== '' || payload.remove === undefined || payload.remove === false);
    var pathOk = payload && (payload.remove === true || (typeof payload.importPath === 'string' && payload.importPath.length > 0));
    if (!payload || !payload.sourceLocation || !payload.requestId || !nameOk || !pathOk) {
      this.rejectInvalidWrite(payload, 'SQ_WRITE_IMPORT', 'SQ_WRITE_IMPORT_RESULT');
      return;
    }
    this.callHmrFunction('__SQ_WRITE_IMPORT__', payload, 'SQ_WRITE_IMPORT_RESULT');
  };

IFrameBridge.prototype.handleUpdateImageAttribute = function(payload) {
    if (!payload.key || !payload.attribute) return;

    var element = this.findElementByKey(payload.key);
    if (!element) return;

    // Validate element is an img or video
    var tag = element.tagName.toLowerCase();
    if (tag !== 'img' && tag !== 'video') return;

    // Video boolean attrs arrive as 'true'/'false' strings (see ImageAttributes).
    // Set BOTH attribute and property — attributes alone don't affect an
    // already-loaded media element (e.g. muted).
    var VIDEO_BOOL_ATTRS = ['autoplay', 'loop', 'muted', 'controls'];
    if (tag === 'video' && VIDEO_BOOL_ATTRS.indexOf(payload.attribute) !== -1) {
      var on = payload.value === 'true';
      if (on) { element.setAttribute(payload.attribute, ''); } else { element.removeAttribute(payload.attribute); }
      element[payload.attribute] = on;
      if (payload.attribute === 'autoplay' && on && element.paused) {
        var p = element.play();
        if (p && p.catch) p.catch(function() {});
      }
      return;
    }

    // task-151: pre-override baseline, per attribute, first-wins — the class
    // tier's capture, for images. The scan payload cannot stand in for it: it
    // reports boundAssetPath and (since task-186 FIX-2) the src value alone —
    // never alt/loading — which is why an undo that removed a
    // sourceImageAttributes entry used to repaint through nothing. null records
    // "the source had no such attribute", so the restore can remove it again
    // instead of setting it to "".
    if (!this._restoringImageAttrs) {
      var baseline = this.originalImageAttrsByKey[payload.key];
      if (!baseline) {
        baseline = {};
        this.originalImageAttrsByKey[payload.key] = baseline;
      }
      if (baseline[payload.attribute] === undefined) {
        baseline[payload.attribute] = element.hasAttribute(payload.attribute)
          ? element.getAttribute(payload.attribute)
          : null;
      }
    }

    // Resolve sq-asset: references to iframe-origin blob URLs
    var resolvedValue = this.resolveAssetRef(payload.value);

    // If asset not yet transferred, queue for deferred resolution
    if (resolvedValue.indexOf('sq-asset:') === 0) {
      this._pendingAssetImages[payload.key] = payload;
      return;
    }

    // No-op guard: the scan re-apply (reapplySourceImageAttrOverrides) re-posts
    // this attribute on EVERY scan (it can't equality-check parent-side). Re-setting
    // img.src to its current value makes the browser re-fetch the image — a visible
    // flash on every scan, e.g. right after a frame is drawn. Skip when unchanged.
    if (element.getAttribute(payload.attribute) === resolvedValue) return;

    // Update the attribute directly
    this.updateAttribute(element, payload.attribute, resolvedValue);
  };

/**
 * "Put this image back the way the source renders it" — the image counterpart of
 * RESTORE_ORIGINAL_CLASSES / RESTORE_ORIGINAL_TEXT. Sent when an undo REMOVES a
 * sourceImageAttributes entry. \`payload.attributes\` names the attributes the
 * removed entry held; absent = every attribute this bridge ever overrode for the
 * key. Attributes with no captured baseline are left alone — the same
 * do-nothing-rather-than-guess rule the class restore uses.
 */
IFrameBridge.prototype.handleRestoreOriginalImageAttributes = function(payload) {
    var key = payload && payload.key;
    if (!key) return;
    var baseline = this.originalImageAttrsByKey[key];
    if (!baseline) return;

    var element = this.findElementByKey(key);
    if (!element) return;

    var names = (payload.attributes && payload.attributes.length)
      ? payload.attributes
      : Object.keys(baseline);

    this._restoringImageAttrs = true;
    try {
      for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var original = baseline[name];
        if (original === undefined) continue;
        if (original === null) element.removeAttribute(name);
        else this.updateAttribute(element, name, original);
        delete baseline[name];
      }
    } finally {
      this._restoringImageAttrs = false;
    }
    if (Object.keys(baseline).length === 0) delete this.originalImageAttrsByKey[key];
  };
`;
