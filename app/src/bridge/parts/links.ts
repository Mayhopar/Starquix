/**
 * Bridge Part: Links
 *
 * Wrap-selection-in-link and unwrap-link handlers plus their link-only
 * helpers (sanitizeLinkHtml, resolveMarkupTarget). Extracted byte-faithful
 * from preview-template/public/scripts/bridge.js (task-049, invariant LI-5);
 * the snapshot-parity guard keeps the two sides aligned (backslashes are
 * doubled here so the evaluated template literal matches bridge.js exactly).
 */
export const BRIDGE_LINKS = `
  /**
   * Sanitize innerHTML by removing dangerous attributes from all elements.
   * Removes: event handlers (onclick, onload, etc.), javascript: URLs. A link's
   * class stays: an edit keeps every link exactly as the source has it.
   * Returns sanitized HTML string.
   */
  IFrameBridge.prototype.sanitizeLinkHtml = function(innerHTML) {
    var tempDiv = document.createElement('div');
    tempDiv.innerHTML = innerHTML;

    // Dangerous attributes to remove from ALL elements
    var dangerousAttrs = [
      'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover', 'onmouseout', 'onmousemove',
      'onkeydown', 'onkeyup', 'onkeypress', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset',
      'onload', 'onunload', 'onerror', 'onabort', 'onscroll', 'onresize', 'oncontextmenu',
      'ondrag', 'ondragstart', 'ondragend', 'ondragover', 'ondragenter', 'ondragleave', 'ondrop',
      'oncopy', 'oncut', 'onpaste', 'oninput', 'oninvalid', 'onsearch', 'onselect', 'ontouchstart',
      'ontouchmove', 'ontouchend', 'ontouchcancel', 'onwheel', 'onanimationstart', 'onanimationend',
      'ontransitionend', 'onpointerdown', 'onpointerup', 'onpointermove', 'onpointercancel'
    ];

    // Remove dangerous attributes from all elements
    tempDiv.querySelectorAll('*').forEach(function(el) {
      dangerousAttrs.forEach(function(attr) {
        el.removeAttribute(attr);
      });

      // Remove any attribute starting with 'on' (catch-all for event handlers)
      Array.from(el.attributes).forEach(function(attr) {
        if (attr.name.toLowerCase().startsWith('on')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    // Sanitize <a> tags specifically
    tempDiv.querySelectorAll('a').forEach(function(a) {
      // Sanitize href - remove javascript: URLs
      var href = a.getAttribute('href');
      if (href) {
        var cleanHref = href.trim().toLowerCase();
        if (cleanHref.startsWith('javascript:') || cleanHref.startsWith('data:') || cleanHref.startsWith('vbscript:')) {
          a.removeAttribute('href');
        }
      }
    });

    // Remove <script> tags entirely
    tempDiv.querySelectorAll('script').forEach(function(s) { s.remove(); });

    return tempDiv.innerHTML;
  };

  /**
   * Find the markup element and key for persistence.
   * Climbs to ancestor with instance-child key if needed.
   * Returns { element, key }.
   */
  IFrameBridge.prototype.resolveMarkupTarget = function(element, key) {
    var markupElement = element;
    var markupKey = key;

    if (!this.isInstanceChildKey(markupKey)) {
      var ancestorResult = this.findAncestorWithInstanceChildKey(markupElement);
      if (ancestorResult) {
        markupElement = ancestorResult.element;
        markupKey = ancestorResult.key;
      }
    }

    return { element: markupElement, key: markupKey };
  };

  /**
   * Handle wrapping selected text in a link.
   */
  IFrameBridge.prototype.handleWrapSelectionInLink = function(payload) {
    var key = payload.key;
    var href = payload.href;
    var target = payload.target;
    var self = this;

    var selection = document.getSelection();
    var range = null;

    // Try to get current selection first
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      range = selection.getRangeAt(0);
    }
    // Fall back to saved selection (used when focus left iframe to LinkBlock)
    else if (this.savedSelectionRange && this.savedSelectionRange.key === key) {
      var el = this.findElementByKey(key);
      range = this.reconstructRangeFromSaved(this.savedSelectionRange, el);
    }

    if (!range) {
      console.warn('[Link] No valid range available');
      return;
    }

    // Check for cross-boundary selection
    if (range.startContainer !== range.endContainer) {
      var startParent = range.startContainer.parentElement;
      var endParent = range.endContainer.parentElement;
      // Check containment with null safety (avoid optional chaining for browser compatibility)
      var startContainsEnd = startParent && endParent && startParent.contains(endParent);
      var endContainsStart = endParent && startParent && endParent.contains(startParent);
      if (startParent !== endParent && !startContainsEnd && !endContainsStart) {
        return;
      }
    }

    var element = this.findElementByKey(key);
    if (!element) {
      console.warn('[Link] Parent element not found for key:', key);
      return;
    }

    // Temporarily make element contentEditable if using saved range
    var wasContentEditable = element.isContentEditable;
    if (!wasContentEditable) {
      element.contentEditable = 'true';
    }

    // Create link element
    var link = document.createElement('a');
    link.href = href;
    if (target) {
      link.target = target;
    }

    // Calculate and set data-key BEFORE surroundContents
    var createdLinkKey = null;
    var isInstanceKey = /^el-[^:]+:[a-z]+-\\d+$/i.test(key);
    if (isInstanceKey) {
      var colonIdx = key.indexOf(':');
      var instanceId = key.substring(0, colonIdx);

      var maxLinkIndex = -1;
      var existingLinks = document.querySelectorAll('[data-key^="' + instanceId + ':a-"]');
      existingLinks.forEach(function(existingLink) {
        var existingKey = existingLink.getAttribute('data-key');
        var match = existingKey.match(/:a-(\\d+)$/);
        if (match) {
          var idx = parseInt(match[1], 10);
          if (idx > maxLinkIndex) maxLinkIndex = idx;
        }
      });
      createdLinkKey = instanceId + ':a-' + (maxLinkIndex + 1);
      link.setAttribute('data-key', createdLinkKey);
    }

    try {
      range.surroundContents(link);
    } catch (e) {
      console.warn('[Link] surroundContents failed:', e.message);
      if (!wasContentEditable) {
        element.contentEditable = 'false';
      }
      return;
    }

    if (!wasContentEditable) {
      element.contentEditable = 'false';
    }

    // Determine which element's markup to report for persistence
    var markup = self.resolveMarkupTarget(element, key);

    self.sendToParent({
      type: 'MARKUP_CHANGED',
      payload: {
        key: markup.key,
        innerHTML: self.sanitizeLinkHtml(markup.element.innerHTML),
        linkKey: link.getAttribute('data-key'),
        href: href,
        target: target
      }
    });

    // Exit text edit mode.
    // EDIT_MODE_EXITED carries plain text (matches exitEditModeCleanup() at line ~1179);
    // the inline <a> we just inserted is persisted separately via MARKUP_CHANGED above.
    // Sending innerHTML here would corrupt the text override with HTML and falsely trip
    // the textContent !== originalText change-detection in ViewportFrame's handler.
    // See task-017 / systems.json text-editing knownIssues.
    var editKey = self.editingElement ? self.editingElement.getAttribute('data-key') : null;
    var newText = self.editingElement ? self.editingElement.textContent : '';

    selection.removeAllRanges();

    if (editKey) {
      self.sendToParent({
        type: 'EDIT_MODE_EXITED',
        payload: { key: editKey, textContent: newText, originalText: self.originalTextContent || newText }
      });
    }

    // Set contentEditable to false before clearing editingElement
    if (self.editingElement) {
      self.editingElement.contentEditable = 'false';
      self.editingElement.blur();
    }

    self.editingElement = null;
    self.originalTextContent = null;
    // Reset linkInteracting so future TEXT_SELECTION_CHANGED messages aren't blocked
    self.linkInteracting = false;

    // Re-scan elements and select the new link
    self.scanThen(function() {
      requestAnimationFrame(function() {
        var freshLink = self.requireElement(createdLinkKey, 'Could not find link by key');
        if (!freshLink) return;

        var linkRect = freshLink.getBoundingClientRect();
        if (linkRect.width === 0 && linkRect.height === 0) {
          var rangeForRect = document.createRange();
          rangeForRect.selectNodeContents(freshLink);
          var rects = rangeForRect.getClientRects();
          if (rects.length > 0) linkRect = rects[0];
        }

        self.sendToParent({
          type: 'ELEMENT_CLICK',
          payload: {
            key: createdLinkKey,
            tagName: 'a',
            classes: freshLink.className || '',
            rect: self.buildRect(linkRect)
          }
        });
      });
    });

    self.removeSelectionHighlight();
    self.savedSelectionRange = null;
  };

  /**
   * Handle unwrapping a link (removing the <a> tag but keeping content).
   */
  IFrameBridge.prototype.handleUnwrapLink = function(payload) {
    var key = payload.key;
    var linkSelector = payload.linkSelector;
    var self = this;

    var element = this.findElementByKey(key);
    if (!element) return;

    var link = null;
    var parentElementForSelection = element;

    // If the element itself is an <a> tag, unwrap it
    if (element.tagName.toLowerCase() === 'a') {
      link = element;
      var parent = element.parentElement;
      while (parent && parent !== document.body) {
        if (parent.hasAttribute('data-key')) {
          parentElementForSelection = parent;
          break;
        }
        parent = parent.parentElement;
      }
    } else {
      // Try to find link at current cursor/selection position
      var selection = document.getSelection();
      if (selection && selection.rangeCount > 0) {
        var range = selection.getRangeAt(0);
        var linkAtCursor = self.findClosestLink(range.commonAncestorContainer);
        if (linkAtCursor && element.contains(linkAtCursor)) {
          link = linkAtCursor;
        }
      }

      if (!link) {
        link = element.querySelector('a[data-key="' + linkSelector + '"]') || element.querySelector('a');
      }
    }

    if (!link) return;

    // Replace link with its contents
    var linkContent = link.innerHTML || link.textContent || '';
    if (linkContent) {
      link.outerHTML = linkContent;
    } else if (link.parentNode) {
      link.parentNode.removeChild(link);
    }

    var selection = document.getSelection();
    if (selection) selection.removeAllRanges();
    // Reset linkInteracting so future TEXT_SELECTION_CHANGED messages aren't blocked
    self.linkInteracting = false;

    // Determine markup element for persistence
    var baseElement = element.tagName.toLowerCase() === 'a' ? parentElementForSelection : element;
    var baseKey = baseElement.getAttribute('data-key') || key;
    var markup = self.resolveMarkupTarget(baseElement, baseKey);

    self.sendToParent({
      type: 'MARKUP_CHANGED',
      payload: { key: markup.key, innerHTML: self.sanitizeLinkHtml(markup.element.innerHTML) }
    });

    // Store reference for async callback (element may be re-rendered)
    var selectElement = parentElementForSelection;

    self.scanThen(function() {
      var clickPayload = self.buildElementPayload(selectElement, {
        isDoubleClick: false,
        hasChildren: false,
        isDirectSelect: true,
        isOutsideContext: false,
        computedStyles: false
      });
      self.sendToParent({ type: 'ELEMENT_CLICK', payload: clickPayload });
    });
  };
`;
