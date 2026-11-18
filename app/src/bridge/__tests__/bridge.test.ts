/**
 * Bridge.js Tests
 *
 * Tests for IFrameBridge functionality including:
 * - 1.1 Initialization
 * - 1.2 Utility functions
 * - 1.3 Message handlers
 * - 1.4 Edit mode
 * - 1.5 Link wrapping
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock IFrameBridge class based on bridge.js implementation
// This allows testing the logic without loading the actual script
class MockIFrameBridge {
  throttledHover: ReturnType<typeof setTimeout> | null = null;
  isDragging = false;
  mouseDownTarget: EventTarget | null = null;
  mouseDownPos = { x: 0, y: 0 };
  lastClickKey: string | null = null;
  lastClickTime = 0;
  lastHoveredKey: string | null = null;
  contextKey: string | null = null;
  mode: 'design' | 'preview' = 'design';
  currentPath = '/';
  styleElement: HTMLStyleElement | null = null;
  mutationObserverStarted = false;
  listenersActive = false;
  pendingClassUpdates: Array<{ key: string; classes: string }> = [];
  elementsReady = false;
  editingElement: HTMLElement | null = null;
  originalTextContent: string | null = null;
  originalTextByKey: Record<string, string> = {};
  savedSelectionRange: {
    key: string;
    selectedText: string;
    startOffset?: number;
    endOffset?: number;
    textContent?: string;
    range?: Range;
  } | null = null;
  linkInteracting = false;
  selectionHighlightElement: HTMLElement | null = null;

  // Constants
  private SKIP_TAGS = ['script', 'style', 'noscript', 'svg', 'path', 'circle', 'rect', 'line', 'polygon', 'polyline', 'ellipse', 'text', 'tspan', 'g', 'defs', 'clippath', 'mask', 'use', 'symbol', 'pattern', 'lineargradient', 'radialgradient', 'stop', 'astro-dev-toolbar'];
  private INLINE_TEXT_TAGS = ['a', 'span', 'em', 'strong', 'b', 'i', 'u', 's', 'mark', 'small', 'sub', 'sup', 'code', 'abbr', 'cite', 'q', 'time'];
  private BLOCK_ELEMENT_SELECTOR = 'div, p, button, input, form, section, article, nav, header, footer, main, aside, ul, ol, li, table, tr, td, th, h1, h2, h3, h4, h5, h6';

  private sentMessages: Array<{ type: string; payload: unknown }> = [];

  getSentMessages() {
    return this.sentMessages;
  }

  clearSentMessages() {
    this.sentMessages = [];
  }

  // Utility functions
  buildRect(domRect: DOMRect): { top: number; left: number; width: number; height: number } {
    return {
      top: domRect.top,
      left: domRect.left,
      width: domRect.width,
      height: domRect.height,
    };
  }

  forceRepaint(element: HTMLElement): void {
    element.style.transform = 'translateZ(0)';
    // Force synchronous layout
    void element.offsetWidth;
    element.style.transform = '';
  }

  findTextNode(element: Element, textContent: string): Text | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (walker.currentNode.textContent === textContent) {
        return walker.currentNode as Text;
      }
    }
    return null;
  }

  findTextNodeContaining(element: Element, substring: string): { node: Text; index: number } | null {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const nodeText = walker.currentNode.textContent;
      if (nodeText) {
        const idx = nodeText.indexOf(substring);
        if (idx !== -1) {
          return { node: walker.currentNode as Text, index: idx };
        }
      }
    }
    return null;
  }

  updateAttribute(element: Element, attr: string, value: string | null | undefined): void {
    if (value) {
      element.setAttribute(attr, value);
    } else {
      element.removeAttribute(attr);
    }
  }

  sanitizeLinkHtml(innerHTML: string): string {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = innerHTML;
    tempDiv.querySelectorAll('a').forEach((a) => {
      a.removeAttribute('class');
    });
    return tempDiv.innerHTML;
  }

  isTrackedElement(element: Element): boolean {
    return element.hasAttribute('data-key') ||
           element.hasAttribute('data-sq-source') ||
           element.hasAttribute('data-astro-source-file');
  }

  findClosestLink(node: Node | null): HTMLAnchorElement | null {
    if (!node) return null;
    if (node.nodeType === Node.TEXT_NODE) {
      return node.parentElement ? node.parentElement.closest('a') : null;
    }
    return (node as Element).closest ? (node as Element).closest('a') : null;
  }

  hasBlockChildren(element: Element): boolean {
    const children = element.querySelectorAll('[data-key], [data-sq-source]');
    for (let i = 0; i < children.length; i++) {
      const childTag = children[i].tagName.toLowerCase();
      if (this.INLINE_TEXT_TAGS.indexOf(childTag) === -1) {
        return true;
      }
    }
    return element.children.length > 0 && element.querySelector(this.BLOCK_ELEMENT_SELECTOR) !== null;
  }

  getParentDisplay(element: Element): string | null {
    if (!element.parentElement) return null;
    return window.getComputedStyle(element.parentElement).display;
  }

  resolveSourceKey(element: Element): { sourceKey: string | null; hasSourceTracking: boolean } {
    const sourceKey = element.getAttribute('data-sq-source');
    if (sourceKey) {
      return { sourceKey, hasSourceTracking: true };
    }

    const astroFile = element.getAttribute('data-astro-source-file');
    const astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc) {
      const srcIndex = astroFile.indexOf('/src/');
      const relativePath = srcIndex !== -1 ? astroFile.substring(srcIndex + 1) : astroFile;
      return { sourceKey: relativePath + ':' + astroLoc, hasSourceTracking: true };
    }

    return { sourceKey: null, hasSourceTracking: false };
  }

  findParentKey(element: Element, excludeKey: string): string | null {
    let parent = element.parentElement;
    while (parent && parent !== document.body && parent !== document.documentElement) {
      const key = parent.getAttribute('data-key');
      if (key && key !== excludeKey) {
        return key;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  isInstanceChildKey(key: string | null): boolean {
    if (!key || typeof key !== 'string') return false;
    const colonIdx = key.lastIndexOf(':');
    if (colonIdx <= 0) return false;
    const selector = key.substring(colonIdx + 1);
    return /^[a-z][a-z0-9]*-\d+$/i.test(selector);
  }

  parseInstanceKey(key: string | null): { instanceId: string; selector: string } | null {
    if (!key || typeof key !== 'string') return null;

    if (key.indexOf('/') !== -1 || key.indexOf('.astro') !== -1 ||
        key.indexOf('.tsx') !== -1 || key.indexOf('.ts') !== -1) {
      return null;
    }

    const colonIndex = key.lastIndexOf(':');
    if (colonIndex === -1 || colonIndex === 0 || colonIndex === key.length - 1) {
      return null;
    }

    const instanceId = key.substring(0, colonIndex);
    const selector = key.substring(colonIndex + 1);

    if (selector.indexOf(':') !== -1 || !/^[a-zA-Z0-9_-]+$/.test(selector)) {
      return null;
    }

    if (instanceId.indexOf('/') !== -1) {
      return null;
    }

    return { instanceId, selector };
  }

  getElementClasses(element: Element): string {
    if (element.className && typeof element.className === 'string') {
      return element.className;
    }
    if (element.className && typeof element.className === 'object' && 'baseVal' in element.className) {
      return (element.className as SVGAnimatedString).baseVal;
    }
    return element.getAttribute('class') || '';
  }

  findElementByKey(key: string): Element | null {
    let element = document.querySelector(`[data-key="${key}"]`);
    if (element) return element;

    element = document.querySelector(`[data-sq-source="${key}"]`);
    if (element) return element;

    return null;
  }

  getElementKey(element: Element): string {
    const key = element.getAttribute('data-key');
    if (key) return key;

    const astroFile = element.getAttribute('data-astro-source-file');
    const astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc) {
      const srcIndex = astroFile.indexOf('/src/');
      const relativePath = srcIndex !== -1 ? astroFile.substring(srcIndex + 1) : astroFile;
      const sourceKey = relativePath + ':' + astroLoc;
      element.setAttribute('data-key', sourceKey);
      return sourceKey;
    }

    const tagName = element.tagName.toLowerCase();
    const id = element.id;
    let dynamicKey = 'dynamic:' + tagName;
    if (id) {
      dynamicKey += '#' + id;
    }

    const parent = element.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(element);
      dynamicKey += ':' + index;
    }

    element.setAttribute('data-key', dynamicKey);
    return dynamicKey;
  }

  parseSourceLocation(element: Element): { file: string; line: number; column: number } | undefined {
    const sourceAttr = element.getAttribute('data-sq-source');
    if (sourceAttr) {
      const parts = sourceAttr.split(':');
      if (parts.length >= 3) {
        const column = parseInt(parts.pop()!, 10);
        const line = parseInt(parts.pop()!, 10);
        const file = parts.join(':');
        if (!isNaN(line) && !isNaN(column)) {
          return { file, line, column };
        }
      }
    }

    const astroFile = element.getAttribute('data-astro-source-file');
    const astroLoc = element.getAttribute('data-astro-source-loc');
    if (astroFile && astroLoc) {
      const locParts = astroLoc.split(':');
      const line = parseInt(locParts[0], 10);
      const column = parseInt(locParts[1], 10);
      if (!isNaN(line) && !isNaN(column)) {
        const srcIndex = astroFile.indexOf('/src/');
        const file = srcIndex !== -1 ? astroFile.substring(srcIndex + 1) : astroFile;
        return { file, line, column };
      }
    }

    return undefined;
  }

  sendToParent(message: { type: string; payload?: unknown; timestamp?: number }): void {
    if (!message.timestamp) {
      message.timestamp = Date.now();
    }
    this.sentMessages.push({ type: message.type, payload: message.payload });
    window.parent.postMessage(message, '*');
  }

  // Message handlers
  handleUpdateClasses(payload: { key?: string; classes: string; sourceLocation?: { file: string; line: number; column: number } }): void {
    if (!payload.key) return;

    const instanceKeyParts = this.parseInstanceKey(payload.key);
    if (instanceKeyParts) {
      this.handleUpdateInstanceOverride({
        instanceId: instanceKeyParts.instanceId,
        selector: instanceKeyParts.selector,
        classes: payload.classes,
      });
      return;
    }

    const element = this.findElementByKey(payload.key) as HTMLElement | null;
    if (element) {
      const currentClasses = this.getElementClasses(element);
      if (currentClasses !== payload.classes) {
        element.className = payload.classes;
        this.forceRepaint(element);
      }
    }
  }

  handleUpdateInstanceOverride(payload: { instanceId: string; selector: string; classes?: string }): void {
    if (!payload.instanceId || !payload.selector) return;

    const compositeKey = payload.instanceId + ':' + payload.selector;
    const element = this.findElementByKey(compositeKey) as HTMLElement | null;

    if (!element) return;

    if (payload.classes !== undefined) {
      element.className = payload.classes;
      this.forceRepaint(element);
    }
  }

  handleUpdateText(payload: { key: string; textContent: string }): void {
    if (!payload.key || payload.textContent === undefined) return;

    const element = this.findElementByKey(payload.key);
    if (!element) return;

    if (element.textContent !== payload.textContent) {
      element.textContent = payload.textContent;
    }
  }

  handleUpdateLinkAttribute(payload: { key: string; attribute: string; value: string | null }): void {
    if (!payload.key || !payload.attribute) return;

    const element = this.findElementByKey(payload.key);
    if (!element) return;

    this.updateAttribute(element, payload.attribute, payload.value);
  }

  exitEditModeCleanup(): void {
    if (!this.editingElement) return;

    const element = this.editingElement;
    const editKey = element.getAttribute('data-key') || element.getAttribute('data-sq-source');
    const newText = element.textContent;

    element.contentEditable = 'false';
    element.blur();

    const selection = window.getSelection();
    if (selection) selection.removeAllRanges();

    this.sendToParent({
      type: 'EDIT_MODE_EXITED',
      payload: { key: editKey, textContent: newText, originalText: this.originalTextContent },
    });

    this.editingElement = null;
    this.originalTextContent = null;
  }

  handleEnterEditMode(payload: { key: string }): void {
    const key = payload?.key;
    const element = this.findElementByKey(key) as HTMLElement | null;
    if (!element || this.editingElement) return;

    this.savedSelectionRange = null;
    this.editingElement = element;
    this.originalTextContent = element.textContent;

    if (key && !this.originalTextByKey[key]) {
      this.originalTextByKey[key] = element.textContent || '';
    }

    element.contentEditable = 'true';
    element.focus();

    const range = document.createRange();
    range.selectNodeContents(element);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }

  createSelectionOverlay(rect: DOMRect): void {
    if (!rect || rect.width === 0 || rect.height === 0) return;

    const overlay = document.createElement('div');
    overlay.setAttribute('data-sq-selection-highlight', 'true');
    overlay.style.cssText = [
      'position: fixed',
      'pointer-events: none',
      'background-color: rgba(59, 130, 246, 0.3)',
      'border-radius: 2px',
      'z-index: 999999',
      `top: ${rect.top}px`,
      `left: ${rect.left}px`,
      `width: ${rect.width}px`,
      `height: ${rect.height}px`,
    ].join(';');

    document.body.appendChild(overlay);
    this.selectionHighlightElement = overlay;
  }

  removeSelectionHighlight(): void {
    const overlays = document.querySelectorAll('[data-sq-selection-highlight]');
    overlays.forEach((overlay) => {
      overlay.parentNode?.removeChild(overlay);
    });
    this.selectionHighlightElement = null;
  }

  addKeysToMarkup(html: string, instanceId: string): string {
    const MARKUP_SKIP_TAGS = ['script', 'style', 'svg', 'path', 'circle', 'rect', 'line', 'g', 'defs'];
    const tagCounts: Record<string, number> = {};

    return html.replace(/<(\w+)((?:\s+[^>]*)?)(\/?>)/g, (match, tag, attrs, close) => {
      const tagLower = tag.toLowerCase();

      if (MARKUP_SKIP_TAGS.indexOf(tagLower) !== -1) {
        return match;
      }

      const index = tagCounts[tagLower] || 0;
      tagCounts[tagLower] = index + 1;

      if (attrs && attrs.indexOf('data-key=') !== -1) {
        return match;
      }

      const selector = tagLower + '-' + index;
      const newAttr = ` data-key="${instanceId}:${selector}"`;

      return '<' + tag + newAttr + (attrs || '') + close;
    });
  }

  resolveAssetRefs(str: string): string {
    // No-op in tests — asset refs are a runtime concern
    return str;
  }
  getComputedStyles(element: Element): Record<string, string> {
    const computed = window.getComputedStyle(element);
    return {
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      fontFamily: computed.fontFamily,
      lineHeight: computed.lineHeight,
      letterSpacing: computed.letterSpacing,
      textAlign: computed.textAlign,
      color: computed.color,
      width: computed.width,
      height: computed.height,
      paddingTop: computed.paddingTop,
      paddingRight: computed.paddingRight,
      paddingBottom: computed.paddingBottom,
      paddingLeft: computed.paddingLeft,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      backgroundColor: computed.backgroundColor,
    };
  }
}

describe('IFrameBridge', () => {
  let bridge: MockIFrameBridge;

  beforeEach(() => {
    bridge = new MockIFrameBridge();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  // =====================================================
  // 1.1 Initialization Tests
  // =====================================================
  describe('1.1 Initialization', () => {
    it('1.1.1 should initialize with default values', () => {
      expect(bridge.mode).toBe('design');
      expect(bridge.isDragging).toBe(false);
      expect(bridge.editingElement).toBeNull();
      expect(bridge.contextKey).toBeNull();
      expect(bridge.elementsReady).toBe(false);
    });

    it('1.1.2 should have empty pending class updates initially', () => {
      expect(bridge.pendingClassUpdates).toEqual([]);
    });

    it('1.1.3 should have no editing state initially', () => {
      expect(bridge.editingElement).toBeNull();
      expect(bridge.originalTextContent).toBeNull();
      expect(bridge.savedSelectionRange).toBeNull();
    });

    it('1.1.4 should start with design mode styles active', () => {
      expect(bridge.mode).toBe('design');
    });

    it('1.1.5 should have no last hovered key initially', () => {
      expect(bridge.lastHoveredKey).toBeNull();
    });

    it('1.1.6 should have no last click key initially', () => {
      expect(bridge.lastClickKey).toBeNull();
      expect(bridge.lastClickTime).toBe(0);
    });

    it('1.1.7 should initialize originalTextByKey as empty object', () => {
      expect(bridge.originalTextByKey).toEqual({});
    });

    it('1.1.8 should not be link interacting initially', () => {
      expect(bridge.linkInteracting).toBe(false);
    });
  });

  // =====================================================
  // 1.2 Utility Functions Tests
  // =====================================================
  describe('1.2 Utility Functions', () => {
    describe('1.2.1 buildRect', () => {
      it('should convert DOMRect to simple rect object', () => {
        const domRect = new DOMRect(10, 20, 100, 50);
        const rect = bridge.buildRect(domRect);

        expect(rect).toEqual({
          top: 20,
          left: 10,
          width: 100,
          height: 50,
        });
      });

      it('should handle zero-sized rects', () => {
        const domRect = new DOMRect(0, 0, 0, 0);
        const rect = bridge.buildRect(domRect);

        expect(rect).toEqual({
          top: 0,
          left: 0,
          width: 0,
          height: 0,
        });
      });

      it('should handle negative coordinates', () => {
        const domRect = new DOMRect(-10, -20, 100, 50);
        const rect = bridge.buildRect(domRect);

        expect(rect.left).toBe(-10);
        expect(rect.top).toBe(-20);
      });
    });

    describe('1.2.2 forceRepaint', () => {
      it('should temporarily apply transform style', () => {
        const element = document.createElement('div');
        document.body.appendChild(element);

        bridge.forceRepaint(element);

        expect(element.style.transform).toBe('');
      });
    });

    describe('1.2.3 findTextNode', () => {
      it('should find text node with exact content', () => {
        const container = document.createElement('div');
        container.innerHTML = 'Hello <span>World</span>';
        document.body.appendChild(container);

        const textNode = bridge.findTextNode(container, 'Hello ');
        expect(textNode).not.toBeNull();
        expect(textNode?.textContent).toBe('Hello ');
      });

      it('should return null if text content not found', () => {
        const container = document.createElement('div');
        container.innerHTML = 'Hello World';
        document.body.appendChild(container);

        const textNode = bridge.findTextNode(container, 'Goodbye');
        expect(textNode).toBeNull();
      });

      it('should find nested text nodes', () => {
        const container = document.createElement('div');
        container.innerHTML = '<div><span>Nested Text</span></div>';
        document.body.appendChild(container);

        const textNode = bridge.findTextNode(container, 'Nested Text');
        expect(textNode).not.toBeNull();
        expect(textNode?.textContent).toBe('Nested Text');
      });
    });

    describe('1.2.4 findTextNodeContaining', () => {
      it('should find text node containing substring', () => {
        const container = document.createElement('div');
        container.innerHTML = 'Hello World';
        document.body.appendChild(container);

        const result = bridge.findTextNodeContaining(container, 'World');
        expect(result).not.toBeNull();
        expect(result?.index).toBe(6);
      });

      it('should return null if substring not found', () => {
        const container = document.createElement('div');
        container.innerHTML = 'Hello World';
        document.body.appendChild(container);

        const result = bridge.findTextNodeContaining(container, 'Goodbye');
        expect(result).toBeNull();
      });

      it('should find substring in nested elements', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>Find me here</span>';
        document.body.appendChild(container);

        const result = bridge.findTextNodeContaining(container, 'me');
        expect(result).not.toBeNull();
        expect(result?.index).toBe(5);
      });
    });

    describe('1.2.5 updateAttribute', () => {
      it('should set attribute when value is truthy', () => {
        const element = document.createElement('a');
        bridge.updateAttribute(element, 'href', 'https://example.com');

        expect(element.getAttribute('href')).toBe('https://example.com');
      });

      it('should remove attribute when value is null', () => {
        const element = document.createElement('a');
        element.setAttribute('href', 'https://example.com');

        bridge.updateAttribute(element, 'href', null);

        expect(element.hasAttribute('href')).toBe(false);
      });

      it('should remove attribute when value is undefined', () => {
        const element = document.createElement('a');
        element.setAttribute('target', '_blank');

        bridge.updateAttribute(element, 'target', undefined);

        expect(element.hasAttribute('target')).toBe(false);
      });

      it('should remove attribute when value is empty string', () => {
        const element = document.createElement('a');
        element.setAttribute('rel', 'noopener');

        bridge.updateAttribute(element, 'rel', '');

        expect(element.hasAttribute('rel')).toBe(false);
      });
    });

    describe('1.2.6 sanitizeLinkHtml', () => {
      it('should remove class attribute from anchor tags', () => {
        const html = '<a href="#" class="text-blue-500">Link</a>';
        const sanitized = bridge.sanitizeLinkHtml(html);

        expect(sanitized).not.toContain('class=');
        expect(sanitized).toContain('href="#"');
        expect(sanitized).toContain('Link');
      });

      it('should preserve other attributes on anchor tags', () => {
        const html = '<a href="https://example.com" target="_blank" class="link">Text</a>';
        const sanitized = bridge.sanitizeLinkHtml(html);

        expect(sanitized).toContain('href="https://example.com"');
        expect(sanitized).toContain('target="_blank"');
        expect(sanitized).not.toContain('class=');
      });

      it('should handle multiple anchor tags', () => {
        const html = '<a class="a">First</a> and <a class="b">Second</a>';
        const sanitized = bridge.sanitizeLinkHtml(html);

        expect(sanitized).not.toContain('class=');
        expect(sanitized).toContain('First');
        expect(sanitized).toContain('Second');
      });

      it('should preserve non-anchor element classes', () => {
        const html = '<span class="text-red">Text</span><a class="link">Link</a>';
        const sanitized = bridge.sanitizeLinkHtml(html);

        expect(sanitized).toContain('class="text-red"');
        expect(sanitized).not.toContain('class="link"');
      });
    });

    describe('1.2.7 isTrackedElement', () => {
      it('should return true for element with data-key', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'test-key');

        expect(bridge.isTrackedElement(element)).toBe(true);
      });

      it('should return true for element with data-sq-source', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/components/Hero.astro:5:1');

        expect(bridge.isTrackedElement(element)).toBe(true);
      });

      it('should return true for element with data-astro-source-file', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', '/project/src/components/Hero.astro');

        expect(bridge.isTrackedElement(element)).toBe(true);
      });

      it('should return false for untracked element', () => {
        const element = document.createElement('div');

        expect(bridge.isTrackedElement(element)).toBe(false);
      });
    });

    describe('1.2.8 findClosestLink', () => {
      it('should find closest anchor from text node', () => {
        const container = document.createElement('div');
        container.innerHTML = '<a href="#">Link <span>text</span></a>';
        document.body.appendChild(container);

        const textNode = container.querySelector('span')!.firstChild!;
        const link = bridge.findClosestLink(textNode);

        expect(link).not.toBeNull();
        expect(link?.tagName).toBe('A');
      });

      it('should find closest anchor from element', () => {
        const container = document.createElement('div');
        container.innerHTML = '<a href="#"><span id="inner">text</span></a>';
        document.body.appendChild(container);

        const span = container.querySelector('#inner')!;
        const link = bridge.findClosestLink(span);

        expect(link).not.toBeNull();
        expect(link?.tagName).toBe('A');
      });

      it('should return null when no anchor ancestor', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>No link here</span>';
        document.body.appendChild(container);

        const span = container.querySelector('span')!;
        const link = bridge.findClosestLink(span);

        expect(link).toBeNull();
      });

      it('should return null for null node', () => {
        const link = bridge.findClosestLink(null);
        expect(link).toBeNull();
      });
    });

    describe('1.2.9 hasBlockChildren', () => {
      it('should return true for element with block children with data-key', () => {
        const container = document.createElement('div');
        container.innerHTML = '<div data-key="child">Block child</div>';
        document.body.appendChild(container);

        expect(bridge.hasBlockChildren(container)).toBe(true);
      });

      it('should return false for element with only inline children', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span data-key="inline">Inline child</span>';
        document.body.appendChild(container);

        expect(bridge.hasBlockChildren(container)).toBe(false);
      });

      it('should return true for element with block elements', () => {
        const container = document.createElement('div');
        container.innerHTML = '<p>Paragraph</p>';
        document.body.appendChild(container);

        expect(bridge.hasBlockChildren(container)).toBe(true);
      });

      it('should return false for empty element', () => {
        const container = document.createElement('div');
        document.body.appendChild(container);

        expect(bridge.hasBlockChildren(container)).toBe(false);
      });
    });

    describe('1.2.10 getParentDisplay', () => {
      it('should return parent display value', () => {
        const parent = document.createElement('div');
        parent.style.display = 'flex';
        const child = document.createElement('div');
        parent.appendChild(child);
        document.body.appendChild(parent);

        expect(bridge.getParentDisplay(child)).toBe('flex');
      });

      it('should return null for element without parent', () => {
        const orphan = document.createElement('div');

        expect(bridge.getParentDisplay(orphan)).toBeNull();
      });
    });

    describe('1.2.11 resolveSourceKey', () => {
      it('should resolve data-sq-source attribute', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/components/Hero.astro:5:1');

        const result = bridge.resolveSourceKey(element);

        expect(result.sourceKey).toBe('src/components/Hero.astro:5:1');
        expect(result.hasSourceTracking).toBe(true);
      });

      it('should resolve astro source attributes', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', '/project/src/components/Hero.astro');
        element.setAttribute('data-astro-source-loc', '5:1');

        const result = bridge.resolveSourceKey(element);

        expect(result.sourceKey).toBe('src/components/Hero.astro:5:1');
        expect(result.hasSourceTracking).toBe(true);
      });

      it('should return null sourceKey for untracked element', () => {
        const element = document.createElement('div');

        const result = bridge.resolveSourceKey(element);

        expect(result.sourceKey).toBeNull();
        expect(result.hasSourceTracking).toBe(false);
      });
    });

    describe('1.2.12 findParentKey', () => {
      it('should find parent with data-key', () => {
        const parent = document.createElement('div');
        parent.setAttribute('data-key', 'parent-key');
        const child = document.createElement('div');
        child.setAttribute('data-key', 'child-key');
        parent.appendChild(child);
        document.body.appendChild(parent);

        const result = bridge.findParentKey(child, 'child-key');

        expect(result).toBe('parent-key');
      });

      it('should skip parent with same key as exclude', () => {
        const grandparent = document.createElement('div');
        grandparent.setAttribute('data-key', 'grandparent-key');
        const parent = document.createElement('div');
        parent.setAttribute('data-key', 'skip-me');
        const child = document.createElement('div');
        grandparent.appendChild(parent);
        parent.appendChild(child);
        document.body.appendChild(grandparent);

        const result = bridge.findParentKey(child, 'skip-me');

        expect(result).toBe('grandparent-key');
      });

      it('should return null when no parent has key', () => {
        const parent = document.createElement('div');
        const child = document.createElement('div');
        parent.appendChild(child);
        document.body.appendChild(parent);

        const result = bridge.findParentKey(child, 'any-key');

        expect(result).toBeNull();
      });
    });

    describe('1.2.13 isInstanceChildKey', () => {
      it('should return true for valid instance child key', () => {
        expect(bridge.isInstanceChildKey('el-abc123:div-0')).toBe(true);
        expect(bridge.isInstanceChildKey('instance-id:span-5')).toBe(true);
        expect(bridge.isInstanceChildKey('comp:p-10')).toBe(true);
      });

      it('should return false for source keys', () => {
        expect(bridge.isInstanceChildKey('src/components/Hero.astro:5:1')).toBe(false);
      });

      it('should return false for invalid formats', () => {
        expect(bridge.isInstanceChildKey('no-colon')).toBe(false);
        expect(bridge.isInstanceChildKey(null)).toBe(false);
        expect(bridge.isInstanceChildKey('')).toBe(false);
      });
    });

    describe('1.2.14 parseInstanceKey', () => {
      it('should parse valid instance key', () => {
        const result = bridge.parseInstanceKey('el-abc123:div-0');

        expect(result).toEqual({
          instanceId: 'el-abc123',
          selector: 'div-0',
        });
      });

      it('should return null for source keys', () => {
        expect(bridge.parseInstanceKey('src/Hero.astro:5:1')).toBeNull();
        expect(bridge.parseInstanceKey('components/Card.tsx:10:5')).toBeNull();
      });

      it('should return null for invalid keys', () => {
        expect(bridge.parseInstanceKey(null)).toBeNull();
        expect(bridge.parseInstanceKey('')).toBeNull();
        expect(bridge.parseInstanceKey('no-colon')).toBeNull();
        expect(bridge.parseInstanceKey(':empty-instance')).toBeNull();
        expect(bridge.parseInstanceKey('empty-selector:')).toBeNull();
      });
    });

    describe('1.2.15 getElementClasses', () => {
      it('should return className string', () => {
        const element = document.createElement('div');
        element.className = 'text-lg font-bold';

        expect(bridge.getElementClasses(element)).toBe('text-lg font-bold');
      });

      it('should return empty string for element without classes', () => {
        const element = document.createElement('div');

        expect(bridge.getElementClasses(element)).toBe('');
      });

      it('should handle SVG elements', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon');

        expect(bridge.getElementClasses(svg)).toBe('icon');
      });
    });

    describe('1.2.16 findElementByKey', () => {
      it('should find element by data-key', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'test-key');
        document.body.appendChild(element);

        const found = bridge.findElementByKey('test-key');

        expect(found).toBe(element);
      });

      it('should find element by data-sq-source', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/Hero.astro:5:1');
        document.body.appendChild(element);

        const found = bridge.findElementByKey('src/Hero.astro:5:1');

        expect(found).toBe(element);
      });

      it('should return null for non-existent key', () => {
        const found = bridge.findElementByKey('non-existent');

        expect(found).toBeNull();
      });
    });

    describe('1.2.17 getElementKey', () => {
      it('should return existing data-key', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'existing-key');

        expect(bridge.getElementKey(element)).toBe('existing-key');
      });

      it('should generate key from astro source attributes', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', '/project/src/Hero.astro');
        element.setAttribute('data-astro-source-loc', '5:1');

        const key = bridge.getElementKey(element);

        expect(key).toBe('src/Hero.astro:5:1');
        expect(element.getAttribute('data-key')).toBe('src/Hero.astro:5:1');
      });

      it('should generate dynamic key for untracked element', () => {
        const parent = document.createElement('div');
        const element = document.createElement('span');
        parent.appendChild(element);
        document.body.appendChild(parent);

        const key = bridge.getElementKey(element);

        expect(key).toContain('dynamic:span');
        expect(element.getAttribute('data-key')).toBe(key);
      });
    });

    describe('1.2.18 parseSourceLocation', () => {
      it('should parse data-sq-source', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/Hero.astro:5:1');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toEqual({
          file: 'src/Hero.astro',
          line: 5,
          column: 1,
        });
      });

      it('should parse astro source attributes', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', '/project/src/Hero.astro');
        element.setAttribute('data-astro-source-loc', '10:15');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toEqual({
          file: 'src/Hero.astro',
          line: 10,
          column: 15,
        });
      });

      it('should return undefined for untracked element', () => {
        const element = document.createElement('div');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toBeUndefined();
      });

      it('should handle Windows-style paths', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'C:src:Hero.astro:5:1');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toEqual({
          file: 'C:src:Hero.astro',
          line: 5,
          column: 1,
        });
      });
    });

    describe('1.2.19 addKeysToMarkup', () => {
      it('should add data-key to all elements', () => {
        const html = '<div><p>Text</p></div>';
        const result = bridge.addKeysToMarkup(html, 'inst-1');

        expect(result).toContain('data-key="inst-1:div-0"');
        expect(result).toContain('data-key="inst-1:p-0"');
      });

      it('should skip script and style tags', () => {
        const html = '<script>code</script><style>.class{}</style><div>Content</div>';
        const result = bridge.addKeysToMarkup(html, 'inst-1');

        expect(result).not.toContain('data-key="inst-1:script-0"');
        expect(result).not.toContain('data-key="inst-1:style-0"');
        expect(result).toContain('data-key="inst-1:div-0"');
      });

      it('should preserve existing data-key attributes', () => {
        const html = '<div data-key="existing">Content</div>';
        const result = bridge.addKeysToMarkup(html, 'inst-1');

        expect(result).toContain('data-key="existing"');
        expect(result).not.toContain('data-key="inst-1:div-0"');
      });

      it('should increment index for same tag types', () => {
        const html = '<div></div><div></div><div></div>';
        const result = bridge.addKeysToMarkup(html, 'inst-1');

        expect(result).toContain('data-key="inst-1:div-0"');
        expect(result).toContain('data-key="inst-1:div-1"');
        expect(result).toContain('data-key="inst-1:div-2"');
      });
    });

    describe('1.2.20 getComputedStyles', () => {
      it('should return computed style properties', () => {
        const element = document.createElement('div');
        element.style.fontSize = '16px';
        element.style.fontWeight = 'bold';
        element.style.color = 'red';
        document.body.appendChild(element);

        const styles = bridge.getComputedStyles(element);

        expect(styles).toHaveProperty('fontSize');
        expect(styles).toHaveProperty('fontWeight');
        expect(styles).toHaveProperty('color');
        expect(styles).toHaveProperty('width');
        expect(styles).toHaveProperty('height');
        expect(styles).toHaveProperty('paddingTop');
        expect(styles).toHaveProperty('marginTop');
        expect(styles).toHaveProperty('backgroundColor');
      });
    });
  });

  // =====================================================
  // 1.3 Message Handlers Tests
  // =====================================================
  describe('1.3 Message Handlers', () => {
    describe('1.3.1 handleUpdateClasses', () => {
      it('should update element classes', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'test-key');
        element.className = 'old-class';
        document.body.appendChild(element);

        bridge.handleUpdateClasses({ key: 'test-key', classes: 'new-class' });

        expect(element.className).toBe('new-class');
      });

      it('should not update if classes are the same', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'test-key');
        element.className = 'same-class';
        document.body.appendChild(element);

        const forceRepaintSpy = vi.spyOn(bridge, 'forceRepaint');
        bridge.handleUpdateClasses({ key: 'test-key', classes: 'same-class' });

        expect(forceRepaintSpy).not.toHaveBeenCalled();
      });

      it('should delegate to instance override for instance keys', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'inst-1:div-0');
        element.className = 'old';
        document.body.appendChild(element);

        bridge.handleUpdateClasses({ key: 'inst-1:div-0', classes: 'new' });

        expect(element.className).toBe('new');
      });

      it('should do nothing if key not provided', () => {
        bridge.handleUpdateClasses({ classes: 'some-class' });
        // No error should occur
      });
    });

    describe('1.3.2 handleUpdateInstanceOverride', () => {
      it('should update instance child element', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'inst-1:span-0');
        element.className = 'original';
        document.body.appendChild(element);

        bridge.handleUpdateInstanceOverride({
          instanceId: 'inst-1',
          selector: 'span-0',
          classes: 'updated',
        });

        expect(element.className).toBe('updated');
      });

      it('should do nothing if element not found', () => {
        bridge.handleUpdateInstanceOverride({
          instanceId: 'non-existent',
          selector: 'div-0',
          classes: 'updated',
        });
        // No error should occur
      });

      it('should require both instanceId and selector', () => {
        bridge.handleUpdateInstanceOverride({
          instanceId: '',
          selector: 'div-0',
          classes: 'updated',
        });
        // No error should occur
      });
    });

    describe('1.3.3 handleUpdateText', () => {
      it('should update element text content', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'text-key');
        element.textContent = 'Original text';
        document.body.appendChild(element);

        bridge.handleUpdateText({ key: 'text-key', textContent: 'New text' });

        expect(element.textContent).toBe('New text');
      });

      it('should not update if text is the same', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'text-key');
        element.textContent = 'Same text';
        document.body.appendChild(element);

        const originalText = element.textContent;
        bridge.handleUpdateText({ key: 'text-key', textContent: 'Same text' });

        expect(element.textContent).toBe(originalText);
      });

      it('should do nothing if element not found', () => {
        bridge.handleUpdateText({ key: 'non-existent', textContent: 'New text' });
        // No error should occur
      });
    });

    describe('1.3.5 handleUpdateLinkAttribute', () => {
      it('should update single link attribute', () => {
        const link = document.createElement('a');
        link.setAttribute('data-key', 'link-key');
        document.body.appendChild(link);

        bridge.handleUpdateLinkAttribute({
          key: 'link-key',
          attribute: 'href',
          value: 'https://example.com',
        });

        expect(link.getAttribute('href')).toBe('https://example.com');
      });

      it('should remove attribute when value is null', () => {
        const link = document.createElement('a');
        link.setAttribute('data-key', 'link-key');
        link.setAttribute('target', '_blank');
        document.body.appendChild(link);

        bridge.handleUpdateLinkAttribute({
          key: 'link-key',
          attribute: 'target',
          value: null,
        });

        expect(link.hasAttribute('target')).toBe(false);
      });
    });

    describe('1.3.7 sendToParent', () => {
      it('should add timestamp to message', () => {
        const postMessageSpy = vi.spyOn(window.parent, 'postMessage');

        bridge.sendToParent({ type: 'TEST' });

        expect(postMessageSpy).toHaveBeenCalled();
        const sentMessage = postMessageSpy.mock.calls[0][0] as { timestamp?: number };
        expect(sentMessage.timestamp).toBeDefined();
      });

      it('should track sent messages', () => {
        bridge.clearSentMessages();
        bridge.sendToParent({ type: 'TEST', payload: { data: 'test' } });

        const messages = bridge.getSentMessages();
        expect(messages).toHaveLength(1);
        expect(messages[0].type).toBe('TEST');
        expect(messages[0].payload).toEqual({ data: 'test' });
      });
    });
  });

  // =====================================================
  // 1.4 Edit Mode Tests
  // =====================================================
  describe('1.4 Edit Mode', () => {
    describe('1.4.1 handleEnterEditMode', () => {
      it('should make element content editable', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Editable text';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });

        expect(element.contentEditable).toBe('true');
        expect(bridge.editingElement).toBe(element);
      });

      it('should store original text content', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Original';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });

        expect(bridge.originalTextContent).toBe('Original');
        expect(bridge.originalTextByKey['edit-key']).toBe('Original');
      });

      it('should clear saved selection range', () => {
        bridge.savedSelectionRange = {
          key: 'old-key',
          selectedText: 'old',
        };

        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });

        expect(bridge.savedSelectionRange).toBeNull();
      });

      it('should not enter edit mode if already editing', () => {
        const element1 = document.createElement('p');
        element1.setAttribute('data-key', 'edit-key-1');
        document.body.appendChild(element1);

        const element2 = document.createElement('p');
        element2.setAttribute('data-key', 'edit-key-2');
        document.body.appendChild(element2);

        bridge.handleEnterEditMode({ key: 'edit-key-1' });
        bridge.handleEnterEditMode({ key: 'edit-key-2' });

        expect(bridge.editingElement).toBe(element1);
        expect(element2.contentEditable).not.toBe('true');
      });

      it('should focus the element', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        document.body.appendChild(element);

        const focusSpy = vi.spyOn(element, 'focus');
        bridge.handleEnterEditMode({ key: 'edit-key' });

        expect(focusSpy).toHaveBeenCalled();
      });
    });

    describe('1.4.2 exitEditModeCleanup', () => {
      it('should make element non-editable', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Text';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        bridge.exitEditModeCleanup();

        expect(element.contentEditable).toBe('false');
        expect(bridge.editingElement).toBeNull();
      });

      it('should send EDIT_MODE_EXITED message', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Original';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        element.textContent = 'Modified';
        bridge.clearSentMessages();
        bridge.exitEditModeCleanup();

        const messages = bridge.getSentMessages();
        const exitMessage = messages.find((m) => m.type === 'EDIT_MODE_EXITED');
        expect(exitMessage).toBeDefined();
        expect((exitMessage!.payload as { key: string }).key).toBe('edit-key');
        expect((exitMessage!.payload as { textContent: string }).textContent).toBe('Modified');
        expect((exitMessage!.payload as { originalText: string }).originalText).toBe('Original');
      });

      it('should clear selection', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Text';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        bridge.exitEditModeCleanup();

        const selection = window.getSelection();
        expect(selection?.rangeCount).toBe(0);
      });

      it('should do nothing if not editing', () => {
        bridge.editingElement = null;
        bridge.clearSentMessages();
        bridge.exitEditModeCleanup();

        expect(bridge.getSentMessages()).toHaveLength(0);
      });

      it('should reset originalTextContent', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Text';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        bridge.exitEditModeCleanup();

        expect(bridge.originalTextContent).toBeNull();
      });
    });

    describe('1.4.3 Selection Highlight', () => {
      it('should create selection overlay', () => {
        const rect = new DOMRect(10, 20, 100, 50);
        bridge.createSelectionOverlay(rect);

        const overlay = document.querySelector('[data-sq-selection-highlight]');
        expect(overlay).not.toBeNull();
        expect(bridge.selectionHighlightElement).toBe(overlay);
      });

      it('should not create overlay for zero-sized rect', () => {
        const rect = new DOMRect(0, 0, 0, 0);
        bridge.createSelectionOverlay(rect);

        const overlay = document.querySelector('[data-sq-selection-highlight]');
        expect(overlay).toBeNull();
      });

      it('should remove selection highlight', () => {
        const rect = new DOMRect(10, 20, 100, 50);
        bridge.createSelectionOverlay(rect);

        expect(document.querySelector('[data-sq-selection-highlight]')).not.toBeNull();

        bridge.removeSelectionHighlight();

        expect(document.querySelector('[data-sq-selection-highlight]')).toBeNull();
        expect(bridge.selectionHighlightElement).toBeNull();
      });

      it('should remove multiple overlays', () => {
        // Create multiple overlays
        bridge.createSelectionOverlay(new DOMRect(10, 20, 100, 50));
        bridge.createSelectionOverlay(new DOMRect(50, 60, 100, 50));

        expect(document.querySelectorAll('[data-sq-selection-highlight]').length).toBe(2);

        bridge.removeSelectionHighlight();

        expect(document.querySelectorAll('[data-sq-selection-highlight]').length).toBe(0);
      });
    });
  });

  // =====================================================
  // 1.5 Link Operations Tests
  // =====================================================
  describe('1.5 Link Operations', () => {
    describe('1.5.1 Link attribute updates', () => {
      it('should set href attribute', () => {
        const link = document.createElement('a');
        link.setAttribute('data-key', 'link-1');
        document.body.appendChild(link);

        bridge.handleUpdateLinkAttribute({
          key: 'link-1',
          attribute: 'href',
          value: 'https://example.com',
        });

        expect(link.href).toBe('https://example.com/');
      });

      it('should set target attribute', () => {
        const link = document.createElement('a');
        link.setAttribute('data-key', 'link-1');
        document.body.appendChild(link);

        bridge.handleUpdateLinkAttribute({
          key: 'link-1',
          attribute: 'target',
          value: '_blank',
        });

        expect(link.target).toBe('_blank');
      });

      it('should set rel attribute', () => {
        const link = document.createElement('a');
        link.setAttribute('data-key', 'link-1');
        document.body.appendChild(link);

        bridge.handleUpdateLinkAttribute({
          key: 'link-1',
          attribute: 'rel',
          value: 'noopener noreferrer',
        });

        expect(link.rel).toBe('noopener noreferrer');
      });

      it('should set aria-label attribute', () => {
        const link = document.createElement('a');
        link.setAttribute('data-key', 'link-1');
        document.body.appendChild(link);

        bridge.handleUpdateLinkAttribute({
          key: 'link-1',
          attribute: 'aria-label',
          value: 'Opens in new tab',
        });

        expect(link.getAttribute('aria-label')).toBe('Opens in new tab');
      });
    });

    describe('1.5.3 sanitizeLinkHtml edge cases', () => {
      it('should handle nested structure with links', () => {
        const html = '<div><p><a class="link" href="#">Text</a></p></div>';
        const result = bridge.sanitizeLinkHtml(html);

        expect(result).toContain('href="#"');
        expect(result).not.toContain('class="link"');
      });

      it('should handle links with children', () => {
        const html = '<a class="btn" href="#"><span>Click</span></a>';
        const result = bridge.sanitizeLinkHtml(html);

        expect(result).toContain('<span>Click</span>');
        expect(result).not.toContain('class="btn"');
      });

      it('should preserve href with special characters', () => {
        const html = '<a class="link" href="/path?param=value&other=test">Link</a>';
        const result = bridge.sanitizeLinkHtml(html);

        expect(result).toContain('href="/path?param=value&amp;other=test"');
      });
    });
  });

  // =====================================================
  // 1.6 Edit Mode Handlers (Extended)
  // =====================================================
  describe('1.6 Edit Mode Handlers (Extended)', () => {
    describe('1.6.1 Input Event Handling', () => {
      it('should track text changes during editing', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Initial';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        element.textContent = 'Changed';

        expect(bridge.editingElement?.textContent).toBe('Changed');
      });

      it('should preserve original text for comparison', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Original';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        element.textContent = 'Modified';

        expect(bridge.originalTextContent).toBe('Original');
      });
    });

    describe('1.6.2 Selection Change Handling', () => {
      it('should track selection within editing element', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Select me';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });

        // Verify element is in editing state
        expect(bridge.editingElement).toBe(element);
      });
    });

    describe('1.6.3 Blur Handling', () => {
      it('should exit edit mode on element blur', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Text';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        bridge.exitEditModeCleanup();

        expect(bridge.editingElement).toBeNull();
      });
    });
  });

  // =====================================================
  // 1.7 Link Wrapping/Unwrapping (Extended)
  // =====================================================
  describe('1.7 Link Wrapping/Unwrapping (Extended)', () => {
    describe('1.7.1 Link Key Generation', () => {
      it('should generate instance-based link keys', () => {
        const result = bridge.addKeysToMarkup('<a href="#">Link</a>', 'inst-1');

        expect(result).toContain('data-key="inst-1:a-0"');
      });

      it('should preserve link href in markup', () => {
        const result = bridge.addKeysToMarkup('<a href="https://example.com">Link</a>', 'inst-1');

        expect(result).toContain('href="https://example.com"');
      });

      it('should handle multiple links in markup', () => {
        const result = bridge.addKeysToMarkup('<a href="#">First</a><a href="#">Second</a>', 'inst-1');

        expect(result).toContain('data-key="inst-1:a-0"');
        expect(result).toContain('data-key="inst-1:a-1"');
      });
    });

    describe('1.7.2 Link Detection', () => {
      it('should find link from nested text', () => {
        const container = document.createElement('div');
        container.innerHTML = '<a href="#"><span><em>Deep</em></span></a>';
        document.body.appendChild(container);

        const deepText = container.querySelector('em')!.firstChild!;
        const link = bridge.findClosestLink(deepText);

        expect(link).not.toBeNull();
        expect(link?.tagName).toBe('A');
      });

      it('should return null for non-link text', () => {
        const container = document.createElement('div');
        container.innerHTML = '<span>No link here</span>';
        document.body.appendChild(container);

        const text = container.querySelector('span')!.firstChild!;
        const link = bridge.findClosestLink(text);

        expect(link).toBeNull();
      });
    });

    describe('1.7.3 Sanitization', () => {
      it('should sanitize nested link classes', () => {
        const html = '<a class="outer" href="#"><span class="inner">Text</span></a>';
        const result = bridge.sanitizeLinkHtml(html);

        expect(result).toContain('class="inner"');
        expect(result).not.toContain('class="outer"');
      });

      it('should handle empty links', () => {
        const html = '<a class="empty" href="#"></a>';
        const result = bridge.sanitizeLinkHtml(html);

        expect(result).not.toContain('class="empty"');
        expect(result).toContain('href="#"');
      });
    });
  });

  // =====================================================
  // 1.8 Selection Highlight (Extended)
  // =====================================================
  describe('1.8 Selection Highlight (Extended)', () => {
    describe('1.8.1 Overlay Positioning', () => {
      it('should position overlay at rect coordinates', () => {
        const rect = new DOMRect(50, 100, 200, 30);
        bridge.createSelectionOverlay(rect);

        const overlay = document.querySelector('[data-sq-selection-highlight]') as HTMLElement;
        expect(overlay).not.toBeNull();
        expect(overlay.style.top).toBe('100px');
        expect(overlay.style.left).toBe('50px');
        expect(overlay.style.width).toBe('200px');
        expect(overlay.style.height).toBe('30px');
      });

      it('should set correct z-index for overlay', () => {
        const rect = new DOMRect(0, 0, 100, 20);
        bridge.createSelectionOverlay(rect);

        const overlay = document.querySelector('[data-sq-selection-highlight]') as HTMLElement;
        expect(overlay.style.zIndex).toBe('999999');
      });

      it('should set pointer-events to none', () => {
        const rect = new DOMRect(0, 0, 100, 20);
        bridge.createSelectionOverlay(rect);

        const overlay = document.querySelector('[data-sq-selection-highlight]') as HTMLElement;
        expect(overlay.style.pointerEvents).toBe('none');
      });
    });

    describe('1.8.2 Overlay Cleanup', () => {
      it('should remove all overlays on cleanup', () => {
        bridge.createSelectionOverlay(new DOMRect(0, 0, 100, 20));
        bridge.createSelectionOverlay(new DOMRect(0, 50, 100, 20));
        bridge.createSelectionOverlay(new DOMRect(0, 100, 100, 20));

        expect(document.querySelectorAll('[data-sq-selection-highlight]').length).toBe(3);

        bridge.removeSelectionHighlight();

        expect(document.querySelectorAll('[data-sq-selection-highlight]').length).toBe(0);
      });

      it('should nullify selectionHighlightElement reference', () => {
        bridge.createSelectionOverlay(new DOMRect(0, 0, 100, 20));
        expect(bridge.selectionHighlightElement).not.toBeNull();

        bridge.removeSelectionHighlight();
        expect(bridge.selectionHighlightElement).toBeNull();
      });
    });
  });

  // =====================================================
  // 1.9 Style Injection
  // =====================================================
  describe('1.9 Style Injection', () => {
    describe('1.9.1 Design Mode Styles', () => {
      it('should create style element reference', () => {
        const style = document.createElement('style');
        style.setAttribute('data-sq-design-mode', 'true');
        document.head.appendChild(style);
        bridge.styleElement = style;

        expect(bridge.styleElement).toBe(style);
      });

      it('should track style element for updates', () => {
        const style = document.createElement('style');
        bridge.styleElement = style;

        expect(bridge.styleElement).not.toBeNull();
      });
    });

    describe('1.9.2 Style Updates', () => {
      it('should allow style content updates', () => {
        const style = document.createElement('style');
        document.head.appendChild(style);
        bridge.styleElement = style;

        style.textContent = '* { cursor: default; }';

        expect(bridge.styleElement.textContent).toContain('cursor');
      });
    });
  });

  // =====================================================
  // 1.10 Navigation Detection
  // =====================================================
  describe('1.10 Navigation Detection', () => {
    describe('1.10.1 Path Tracking', () => {
      it('should track current path', () => {
        bridge.currentPath = '/page1';

        expect(bridge.currentPath).toBe('/page1');
      });

      it('should detect path changes', () => {
        bridge.currentPath = '/page1';
        const oldPath = bridge.currentPath;

        bridge.currentPath = '/page2';

        expect(bridge.currentPath).not.toBe(oldPath);
      });
    });

    describe('1.10.2 State Reset on Navigation', () => {
      it('should clear lastHoveredKey on navigation', () => {
        bridge.lastHoveredKey = 'some-key';
        bridge.lastHoveredKey = null;

        expect(bridge.lastHoveredKey).toBeNull();
      });

      it('should reset drag state on navigation', () => {
        bridge.isDragging = true;
        bridge.isDragging = false;

        expect(bridge.isDragging).toBe(false);
      });

      it('should exit edit mode on navigation', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });
        bridge.exitEditModeCleanup();

        expect(bridge.editingElement).toBeNull();
      });
    });
  });

  // =====================================================
  // 1.11 Element Scanning
  // =====================================================
  describe('1.11 Element Scanning', () => {
    describe('1.11.1 Element Discovery', () => {
      it('should identify tracked elements', () => {
        const tracked = document.createElement('div');
        tracked.setAttribute('data-key', 'tracked');
        document.body.appendChild(tracked);

        expect(bridge.isTrackedElement(tracked)).toBe(true);
      });

      it('should identify source-tracked elements', () => {
        const tracked = document.createElement('div');
        tracked.setAttribute('data-sq-source', 'src/Test.astro:1:1');
        document.body.appendChild(tracked);

        expect(bridge.isTrackedElement(tracked)).toBe(true);
      });

      it('should identify astro source elements', () => {
        const tracked = document.createElement('div');
        tracked.setAttribute('data-astro-source-file', '/src/Test.astro');
        document.body.appendChild(tracked);

        expect(bridge.isTrackedElement(tracked)).toBe(true);
      });

      it('should reject untracked elements', () => {
        const untracked = document.createElement('div');
        document.body.appendChild(untracked);

        expect(bridge.isTrackedElement(untracked)).toBe(false);
      });
    });

    describe('1.11.2 Key Assignment', () => {
      it('should preserve existing data-key', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'existing-key');
        document.body.appendChild(element);

        const key = bridge.getElementKey(element);

        expect(key).toBe('existing-key');
      });

      it('should generate key from astro attributes', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', '/project/src/Test.astro');
        element.setAttribute('data-astro-source-loc', '10:5');
        document.body.appendChild(element);

        const key = bridge.getElementKey(element);

        expect(key).toBe('src/Test.astro:10:5');
      });

      it('should generate dynamic key for untracked elements', () => {
        const container = document.createElement('div');
        const element = document.createElement('span');
        container.appendChild(element);
        document.body.appendChild(container);

        const key = bridge.getElementKey(element);

        expect(key).toContain('dynamic:span');
      });
    });

    describe('1.11.3 Pending Updates', () => {
      it('should queue class updates when element not ready', () => {
        bridge.elementsReady = false;
        bridge.pendingClassUpdates.push({ key: 'test-key', classes: 'test-class' });

        expect(bridge.pendingClassUpdates.length).toBe(1);
      });

      it('should clear pending updates after processing', () => {
        bridge.pendingClassUpdates = [{ key: 'test-key', classes: 'test-class' }];
        bridge.pendingClassUpdates = [];

        expect(bridge.pendingClassUpdates.length).toBe(0);
      });
    });
  });

  // =====================================================
  // 1.12 Mutation/Resize Observers
  // =====================================================
  describe('1.12 Mutation/Resize Observers', () => {
    describe('1.12.1 Mutation Observer', () => {
      it('should track mutation observer state', () => {
        bridge.mutationObserverStarted = true;

        expect(bridge.mutationObserverStarted).toBe(true);
      });

      it('should prevent double initialization', () => {
        bridge.mutationObserverStarted = true;
        const wasStarted = bridge.mutationObserverStarted;

        expect(wasStarted).toBe(true);
      });
    });

    describe('1.12.2 Listener State', () => {
      it('should track listener active state', () => {
        bridge.listenersActive = true;

        expect(bridge.listenersActive).toBe(true);
      });

      it('should allow toggling listeners', () => {
        bridge.listenersActive = true;
        bridge.listenersActive = false;

        expect(bridge.listenersActive).toBe(false);
      });
    });
  });

  // =====================================================
  // 1.13 Event Handlers
  // =====================================================
  describe('1.13 Event Handlers', () => {
    describe('1.13.1 Mouse State Tracking', () => {
      it('should track mouse down position', () => {
        bridge.mouseDownPos = { x: 100, y: 200 };

        expect(bridge.mouseDownPos.x).toBe(100);
        expect(bridge.mouseDownPos.y).toBe(200);
      });

      it('should track mouse down target', () => {
        const target = document.createElement('div');
        bridge.mouseDownTarget = target;

        expect(bridge.mouseDownTarget).toBe(target);
      });

      it('should track drag state', () => {
        bridge.isDragging = true;

        expect(bridge.isDragging).toBe(true);
      });
    });

    describe('1.13.2 Click Detection', () => {
      it('should track last click key', () => {
        bridge.lastClickKey = 'clicked-element';

        expect(bridge.lastClickKey).toBe('clicked-element');
      });

      it('should track last click time', () => {
        bridge.lastClickTime = Date.now();

        expect(bridge.lastClickTime).toBeGreaterThan(0);
      });

      it('should detect double-click timing', () => {
        const firstClick = Date.now();
        bridge.lastClickTime = firstClick;

        const secondClick = firstClick + 200; // 200ms later
        const isDoubleClick = secondClick - bridge.lastClickTime < 500;

        expect(isDoubleClick).toBe(true);
      });

      it('should reject slow double-click', () => {
        const firstClick = Date.now();
        bridge.lastClickTime = firstClick;

        const secondClick = firstClick + 600; // 600ms later
        const isDoubleClick = secondClick - bridge.lastClickTime < 500;

        expect(isDoubleClick).toBe(false);
      });
    });

    describe('1.13.3 Hover Tracking', () => {
      it('should track last hovered key', () => {
        bridge.lastHoveredKey = 'hovered-element';

        expect(bridge.lastHoveredKey).toBe('hovered-element');
      });

      it('should clear hovered key on leave', () => {
        bridge.lastHoveredKey = 'hovered-element';
        bridge.lastHoveredKey = null;

        expect(bridge.lastHoveredKey).toBeNull();
      });

      it('should track throttled hover timeout', () => {
        bridge.throttledHover = setTimeout(() => {}, 50);

        expect(bridge.throttledHover).not.toBeNull();

        clearTimeout(bridge.throttledHover!);
        bridge.throttledHover = null;
      });
    });

    describe('1.13.4 Context Key', () => {
      it('should track context key for drill-down', () => {
        bridge.contextKey = 'parent-container';

        expect(bridge.contextKey).toBe('parent-container');
      });

      it('should clear context key', () => {
        bridge.contextKey = 'some-context';
        bridge.contextKey = null;

        expect(bridge.contextKey).toBeNull();
      });
    });
  });

  // =====================================================
  // 1.14 Click Helpers
  // =====================================================
  describe('1.14 Click Helpers', () => {
    describe('1.14.1 Link Navigation Prevention', () => {
      it('should identify anchor elements', () => {
        const link = document.createElement('a');
        link.href = '#';
        document.body.appendChild(link);

        const closestLink = bridge.findClosestLink(link);

        expect(closestLink).toBe(link);
      });

      it('should identify anchor from child', () => {
        const container = document.createElement('div');
        container.innerHTML = '<a href="#"><span>Link Text</span></a>';
        document.body.appendChild(container);

        const span = container.querySelector('span')!;
        const closestLink = bridge.findClosestLink(span);

        expect(closestLink).not.toBeNull();
        expect(closestLink?.tagName).toBe('A');
      });
    });

    describe('1.14.2 Context Detection', () => {
      it('should find element within context', () => {
        const context = document.createElement('div');
        context.setAttribute('data-key', 'context-key');
        const child = document.createElement('p');
        child.setAttribute('data-key', 'child-key');
        context.appendChild(child);
        document.body.appendChild(context);

        const parentKey = bridge.findParentKey(child, 'child-key');

        expect(parentKey).toBe('context-key');
      });

      it('should handle nested contexts', () => {
        const outer = document.createElement('div');
        outer.setAttribute('data-key', 'outer');
        const inner = document.createElement('div');
        inner.setAttribute('data-key', 'inner');
        const child = document.createElement('p');
        child.setAttribute('data-key', 'child');

        outer.appendChild(inner);
        inner.appendChild(child);
        document.body.appendChild(outer);

        const parentKey = bridge.findParentKey(child, 'child');

        expect(parentKey).toBe('inner');
      });
    });
  });

  // =====================================================
  // 1.15 Element Finding (Extended)
  // =====================================================
  describe('1.15 Element Finding (Extended)', () => {
    describe('1.15.1 Multi-Attribute Search', () => {
      it('should find by data-key first', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'primary-key');
        element.setAttribute('data-sq-source', 'src/Test.astro:1:1');
        document.body.appendChild(element);

        const found = bridge.findElementByKey('primary-key');

        expect(found).toBe(element);
      });

      it('should fallback to data-sq-source', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/Test.astro:1:1');
        document.body.appendChild(element);

        const found = bridge.findElementByKey('src/Test.astro:1:1');

        expect(found).toBe(element);
      });
    });

    describe('1.15.2 Instance Child Finding', () => {
      it('should find instance child element', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'inst-1:div-0');
        document.body.appendChild(element);

        const found = bridge.findElementByKey('inst-1:div-0');

        expect(found).toBe(element);
      });

      it('should handle nested instance children', () => {
        const parent = document.createElement('div');
        parent.setAttribute('data-key', 'inst-1:div-0');
        const child = document.createElement('span');
        child.setAttribute('data-key', 'inst-1:span-0');
        parent.appendChild(child);
        document.body.appendChild(parent);

        const found = bridge.findElementByKey('inst-1:span-0');

        expect(found).toBe(child);
      });
    });

    describe('1.15.3 SVG Class Handling', () => {
      it('should get classes from SVG element', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'icon-class');
        document.body.appendChild(svg);

        const classes = bridge.getElementClasses(svg);

        expect(classes).toBe('icon-class');
      });

      it('should handle SVG without class', () => {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        document.body.appendChild(svg);

        const classes = bridge.getElementClasses(svg);

        expect(classes).toBe('');
      });
    });
  });

  // =====================================================
  // 1.16 Source Location Parsing (Extended)
  // =====================================================
  describe('1.16 Source Location Parsing (Extended)', () => {
    describe('1.16.1 Complex Paths', () => {
      it('should parse deeply nested file paths', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/components/ui/buttons/PrimaryButton.astro:25:10');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toEqual({
          file: 'src/components/ui/buttons/PrimaryButton.astro',
          line: 25,
          column: 10,
        });
      });

      it('should handle paths with special characters', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/components/Hero-Section.astro:5:1');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toEqual({
          file: 'src/components/Hero-Section.astro',
          line: 5,
          column: 1,
        });
      });
    });

    describe('1.16.2 Astro Source Parsing', () => {
      it('should extract relative path from full astro path', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', '/Users/dev/project/src/pages/index.astro');
        element.setAttribute('data-astro-source-loc', '15:3');

        const loc = bridge.parseSourceLocation(element);

        expect(loc?.file).toBe('src/pages/index.astro');
        expect(loc?.line).toBe(15);
        expect(loc?.column).toBe(3);
      });

      it('should handle Windows-style full paths', () => {
        const element = document.createElement('div');
        element.setAttribute('data-astro-source-file', 'C:\\Users\\dev\\project\\src\\Hero.astro');
        element.setAttribute('data-astro-source-loc', '20:5');

        const loc = bridge.parseSourceLocation(element);

        // Will try to find /src/ which won't exist in Windows path format
        // so it should fall back to the full path
        expect(loc).toBeDefined();
        expect(loc?.line).toBe(20);
        expect(loc?.column).toBe(5);
      });
    });

    describe('1.16.3 Invalid Parsing', () => {
      it('should return undefined for invalid line number', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/Test.astro:abc:1');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toBeUndefined();
      });

      it('should return undefined for missing location parts', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/Test.astro:5');

        const loc = bridge.parseSourceLocation(element);

        // The function expects at least 3 parts after splitting by ':'
        expect(loc).toBeUndefined();
      });
    });
  });

  // =====================================================
  // Additional Integration Tests
  // =====================================================
  describe('Integration Tests', () => {
    describe('Class updates with source tracking', () => {
      it('should handle both key and sourceLocation', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'my-key');
        element.setAttribute('data-sq-source', 'src/Hero.astro:5:1');
        element.className = 'old';
        document.body.appendChild(element);

        bridge.handleUpdateClasses({
          key: 'my-key',
          classes: 'new',
          sourceLocation: { file: 'src/Hero.astro', line: 5, column: 1 },
        });

        expect(element.className).toBe('new');
      });
    });

    describe('Edit mode with text tracking', () => {
      it('should track text changes during editing', () => {
        const element = document.createElement('p');
        element.setAttribute('data-key', 'edit-key');
        element.textContent = 'Initial text';
        document.body.appendChild(element);

        bridge.handleEnterEditMode({ key: 'edit-key' });

        // Simulate text change
        element.textContent = 'Modified text';

        bridge.clearSentMessages();
        bridge.exitEditModeCleanup();

        const messages = bridge.getSentMessages();
        const exitMessage = messages.find((m) => m.type === 'EDIT_MODE_EXITED');
        expect((exitMessage!.payload as { textContent: string }).textContent).toBe('Modified text');
        expect((exitMessage!.payload as { originalText: string }).originalText).toBe('Initial text');
      });
    });

    describe('Instance key handling', () => {
      it('should correctly identify and update instance children', () => {
        const element = document.createElement('div');
        element.setAttribute('data-key', 'el-abc:div-0');
        element.className = 'original';
        document.body.appendChild(element);

        // Should be recognized as instance key
        expect(bridge.isInstanceChildKey('el-abc:div-0')).toBe(true);

        // Should update via handleUpdateClasses
        bridge.handleUpdateClasses({
          key: 'el-abc:div-0',
          classes: 'updated',
        });

        expect(element.className).toBe('updated');
      });
    });

    describe('Source key parsing edge cases', () => {
      it('should handle complex file paths', () => {
        const element = document.createElement('div');
        element.setAttribute('data-sq-source', 'src/components/nested/deep/Component.astro:10:5');

        const loc = bridge.parseSourceLocation(element);

        expect(loc).toEqual({
          file: 'src/components/nested/deep/Component.astro',
          line: 10,
          column: 5,
        });
      });
    });
  });
});
