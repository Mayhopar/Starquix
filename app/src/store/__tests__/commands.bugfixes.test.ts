/**
 * Bug Fix Tests: commands.ts
 *
 * Tests for:
 * - Bug #22: ADD_THEME_INSTANCE missing rootElementIds null check
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';

// Mock window for event dispatch tests
const dispatchEventMock = vi.fn();
vi.stubGlobal('window', {
  dispatchEvent: dispatchEventMock,
  CustomEvent: class CustomEvent {
    type: string;
    detail: unknown;
    constructor(type: string, opts?: { detail?: unknown }) {
      this.type = type;
      this.detail = opts?.detail;
    }
  }
});

describe('Bug #22: ADD_THEME_INSTANCE missing rootElementIds null check', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should initialize rootElementIds when page has none and add element', () => {
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Create a page WITHOUT rootElementIds
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('name', 'Test Page');
    // Deliberately NOT setting rootElementIds
    pages.set('page-1', page);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_THEME_INSTANCE',
        element: {
          id: 'theme-instance-1',
          pageId: 'page-1',
          parentId: null, // Root element (no parent)
          index: 0,
          themeId: 'theme-1',
          componentPath: 'components/Button',
          staticMarkup: '<button class="btn">Click</button>',
          classes: emptyClassData()
        }
      });
    });

    // Element should still be created
    const element = elements.get('theme-instance-1') as Y.Map<unknown>;
    expect(element).toBeDefined();
    expect(element.get('instanceType')).toBe('theme');

    // rootElementIds should be initialized with the element
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds).toBeDefined();
    expect(rootIds.toArray()).toEqual(['theme-instance-1']);
  });

  it('should add root element to rootElementIds when it exists', () => {
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Create a proper page
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('name', 'Test Page');
    const rootIds = new Y.Array<string>();
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_THEME_INSTANCE',
        element: {
          id: 'theme-instance-1',
          pageId: 'page-1',
          parentId: null, // Root element
          index: 0,
          themeId: 'theme-1',
          componentPath: 'components/Button',
          staticMarkup: '<button class="btn">Click</button>',
          classes: emptyClassData()
        }
      });
    });

    expect(rootIds.toArray()).toContain('theme-instance-1');
  });

  it('should not add to rootElementIds for child elements (with parentId)', () => {
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Create a proper page
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('name', 'Test Page');
    const rootIds = new Y.Array<string>();
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_THEME_INSTANCE',
        element: {
          id: 'theme-child-1',
          pageId: 'page-1',
          parentId: 'parent-element', // Has parent, not a root element
          index: 0,
          themeId: 'theme-1',
          componentPath: 'components/Button',
          staticMarkup: '<button class="btn">Click</button>',
          classes: emptyClassData()
        }
      });
    });

    // Should NOT be added to rootElementIds
    expect(rootIds.toArray()).not.toContain('theme-child-1');

    // But should still be in elements
    const element = elements.get('theme-child-1') as Y.Map<unknown>;
    expect(element).toBeDefined();
  });

  it('should handle non-existent page gracefully', () => {
    expect(() => {
      doc.transact(() => {
        applyCommand(doc, {
          type: 'ADD_THEME_INSTANCE',
          element: {
            id: 'theme-instance-1',
            pageId: 'non-existent-page',
            parentId: null,
            index: 0,
            themeId: 'theme-1',
            componentPath: 'components/Button',
            staticMarkup: '<button class="btn">Click</button>',
            classes: emptyClassData()
          }
        });
      });
    }).not.toThrow();

    // Element should still be created
    const elements = doc.getMap('elements');
    const element = elements.get('theme-instance-1') as Y.Map<unknown>;
    expect(element).toBeDefined();
  });
});

describe('ADD_DRAWN_ELEMENT missing rootElementIds initialization', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should initialize rootElementIds when page has none and add drawn element', () => {
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Create a page WITHOUT rootElementIds
    const page = new Y.Map();
    page.set('id', 'page-1');
    page.set('name', 'Test Page');
    pages.set('page-1', page);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_DRAWN_ELEMENT',
        element: {
          key: 'drawn-1',
          pageId: 'page-1',
          parentKey: null,
          insertIndex: 0,
          tag: 'div',
          classes: 'w-32 h-32 bg-blue-500',
          rect: { x: 0, y: 0, width: 128, height: 128 }
        }
      });
    });

    // Element should be created
    const element = elements.get('drawn-1') as Y.Map<unknown>;
    expect(element).toBeDefined();
    expect(element.get('isDrawn')).toBe(true);

    // rootElementIds should be initialized with the drawn element
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds).toBeDefined();
    expect(rootIds.toArray()).toEqual(['drawn-1']);
  });

  it('should add drawn element to existing rootElementIds', () => {
    const pages = doc.getMap('pages');

    const page = new Y.Map();
    page.set('id', 'page-1');
    const rootIds = new Y.Array<string>();
    rootIds.push(['existing-1']);
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_DRAWN_ELEMENT',
        element: {
          key: 'drawn-1',
          pageId: 'page-1',
          parentKey: null,
          insertIndex: 0,
          tag: 'div',
          classes: 'w-32 h-32',
          rect: { x: 0, y: 0, width: 128, height: 128 }
        }
      });
    });

    expect(rootIds.toArray()).toContain('drawn-1');
    expect(rootIds.toArray()).toContain('existing-1');
  });

  it('should not add child drawn element to rootElementIds', () => {
    const pages = doc.getMap('pages');

    const page = new Y.Map();
    page.set('id', 'page-1');
    const rootIds = new Y.Array<string>();
    page.set('rootElementIds', rootIds);
    pages.set('page-1', page);

    doc.transact(() => {
      applyCommand(doc, {
        type: 'ADD_DRAWN_ELEMENT',
        element: {
          key: 'drawn-child-1',
          pageId: 'page-1',
          parentKey: 'parent-1',
          insertIndex: 0,
          tag: 'div',
          classes: 'w-16 h-16',
          rect: { x: 0, y: 0, width: 64, height: 64 }
        }
      });
    });

    expect(rootIds.toArray()).not.toContain('drawn-child-1');
  });
});
