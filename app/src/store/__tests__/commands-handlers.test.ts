/**
 * Command Handler Tests: MOVE_PAGE, UPDATE_PAGE_SEO, REMOVE_DRAWN_ELEMENT,
 * CLEAR_INSTANCE_CHILD_ORDERS, CLEAR_PAGE_DRAWN_ELEMENTS
 *
 * These handlers previously had zero test coverage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { emptyClassData } from '../types';

// Mock window for event dispatch (ADD_DRAWN_ELEMENT dispatches CustomEvent)
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
  },
});

/** Helper: create a page in the doc */
function addPage(
  doc: Y.Doc,
  id: string,
  name = 'Page'
): Y.Map<unknown> {
  const pages = doc.getMap('pages');
  const page = new Y.Map();
  page.set('id', id);
  page.set('name', name);
  const rootIds = new Y.Array<string>();
  page.set('rootElementIds', rootIds);
  pages.set(id, page);

  // Add to rootPages
  const rootPages = doc.getArray('rootPages');
  rootPages.push([id]);

  return page;
}

/** Helper: add a drawn element */
function addDrawnElement(
  doc: Y.Doc,
  key: string,
  pageId: string,
  parentKey: string | null = null,
  classes = 'w-32 h-32'
): void {
  applyCommand(doc, {
    type: 'ADD_DRAWN_ELEMENT',
    element: {
      key,
      pageId,
      parentKey,
      insertIndex: 0,
      tag: 'div',
      classes,
      textContent: '',
    },
  });
}

// ============================================================================
// MOVE_PAGE
// ============================================================================
describe('MOVE_PAGE', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should move a root page to be a child of another page', () => {
    addPage(doc, 'page-1', 'Parent');
    addPage(doc, 'page-2', 'Child');

    const rootPages = doc.getArray('rootPages');
    expect(rootPages.toArray()).toContain('page-2');

    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'page-2',
      newParentId: 'page-1',
      index: 0,
    });

    // page-2 should be removed from rootPages
    expect(rootPages.toArray()).not.toContain('page-2');

    // page-2 should be in page-1's children
    const pages = doc.getMap('pages');
    const parent = pages.get('page-1') as Y.Map<unknown>;
    const children = parent.get('children') as Y.Array<string>;
    expect(children.toArray()).toEqual(['page-2']);
  });

  it('should move a child page to root', () => {
    const parent = addPage(doc, 'page-1', 'Parent');
    addPage(doc, 'page-2', 'Child');

    // Manually nest page-2 under page-1
    const childArr = new Y.Array<string>();
    childArr.push(['page-2']);
    parent.set('children', childArr);
    // Remove from rootPages
    const rootPages = doc.getArray('rootPages');
    const idx = rootPages.toArray().indexOf('page-2');
    rootPages.delete(idx, 1);

    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'page-2',
      newParentId: null,
      index: 0,
    });

    // page-2 back in rootPages
    expect(rootPages.toArray()).toContain('page-2');
    // Removed from parent's children
    expect(childArr.toArray()).not.toContain('page-2');
  });

  it('should move page between parents', () => {
    const parent1 = addPage(doc, 'page-1', 'Parent 1');
    addPage(doc, 'page-2', 'Parent 2');
    addPage(doc, 'page-3', 'Movable');

    // Nest page-3 under page-1
    const children1 = new Y.Array<string>();
    children1.push(['page-3']);
    parent1.set('children', children1);
    const rootPages = doc.getArray('rootPages');
    const idx = rootPages.toArray().indexOf('page-3');
    rootPages.delete(idx, 1);

    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'page-3',
      newParentId: 'page-2',
      index: 0,
    });

    // Removed from page-1
    expect(children1.toArray()).not.toContain('page-3');
    // Added to page-2
    const pages = doc.getMap('pages');
    const p2 = pages.get('page-2') as Y.Map<unknown>;
    const children2 = p2.get('children') as Y.Array<string>;
    expect(children2.toArray()).toEqual(['page-3']);
  });

  it('should insert at specific index', () => {
    const parent = addPage(doc, 'page-1', 'Parent');
    addPage(doc, 'page-a', 'A');
    addPage(doc, 'page-b', 'B');
    addPage(doc, 'page-c', 'C');

    // Set up children [a, b] under parent
    const children = new Y.Array<string>();
    children.push(['page-a', 'page-b']);
    parent.set('children', children);
    const rootPages = doc.getArray('rootPages');
    const idxA = rootPages.toArray().indexOf('page-a');
    rootPages.delete(idxA, 1);
    const idxB = rootPages.toArray().indexOf('page-b');
    rootPages.delete(idxB, 1);

    // Move page-c to index 1 (between a and b)
    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'page-c',
      newParentId: 'page-1',
      index: 1,
    });

    expect(children.toArray()).toEqual(['page-a', 'page-c', 'page-b']);
  });

  it('should no-op for non-existent page', () => {
    addPage(doc, 'page-1');
    const rootPages = doc.getArray('rootPages');
    const before = rootPages.toArray();

    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'non-existent',
      newParentId: 'page-1',
      index: 0,
    });

    expect(rootPages.toArray()).toEqual(before);
  });

  it('should abort if new parent does not exist (prevents orphaning)', () => {
    addPage(doc, 'page-1');
    const rootPages = doc.getArray('rootPages');
    expect(rootPages.toArray()).toContain('page-1');

    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'page-1',
      newParentId: 'non-existent-parent',
      index: 0,
    });

    // page-1 should still be in rootPages — not orphaned
    expect(rootPages.toArray()).toContain('page-1');
  });

  it('should create children array on new parent if missing', () => {
    addPage(doc, 'page-1');
    addPage(doc, 'page-2');

    // page-1 has no children array
    const pages = doc.getMap('pages');
    const p1 = pages.get('page-1') as Y.Map<unknown>;
    expect(p1.get('children')).toBeUndefined();

    applyCommand(doc, {
      type: 'MOVE_PAGE',
      pageId: 'page-2',
      newParentId: 'page-1',
      index: 0,
    });

    const children = p1.get('children') as Y.Array<string>;
    expect(children).toBeDefined();
    expect(children.toArray()).toEqual(['page-2']);
  });
});

// ============================================================================
// UPDATE_PAGE_SEO
// ============================================================================
describe('UPDATE_PAGE_SEO', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should set a string SEO field', () => {
    addPage(doc, 'page-1');

    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'title',
      value: 'My Page Title',
    });

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const seo = page.get('seo') as Y.Map<unknown>;
    expect(seo.get('title')).toBe('My Page Title');
  });

  it('should create seo map if missing', () => {
    addPage(doc, 'page-1');

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    expect(page.get('seo')).toBeUndefined();

    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'description',
      value: 'A description',
    });

    const seo = page.get('seo') as Y.Map<unknown>;
    expect(seo).toBeDefined();
    expect(seo.get('description')).toBe('A description');
  });

  it('should set an array value (keywords)', () => {
    addPage(doc, 'page-1');

    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'keywords',
      value: ['react', 'astro', 'editor'],
    });

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const seo = page.get('seo') as Y.Map<unknown>;
    const keywords = seo.get('keywords') as Y.Array<string>;
    expect(keywords.toArray()).toEqual(['react', 'astro', 'editor']);
  });

  it('should set an object value (og image)', () => {
    addPage(doc, 'page-1');

    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'ogImage',
      value: { url: 'https://example.com/img.png', alt: 'OG Image' },
    });

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const seo = page.get('seo') as Y.Map<unknown>;
    const ogImage = seo.get('ogImage') as Y.Map<unknown>;
    expect(ogImage.get('url')).toBe('https://example.com/img.png');
    expect(ogImage.get('alt')).toBe('OG Image');
  });

  it('should delete field when value is null', () => {
    addPage(doc, 'page-1');

    // Set then delete
    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'title',
      value: 'Temp Title',
    });
    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'title',
      value: null,
    });

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const seo = page.get('seo') as Y.Map<unknown>;
    expect(seo.has('title')).toBe(false);
  });

  it('should delete field when value is undefined', () => {
    addPage(doc, 'page-1');

    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'description',
      value: 'A desc',
    });
    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'description',
      value: undefined,
    });

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const seo = page.get('seo') as Y.Map<unknown>;
    expect(seo.has('description')).toBe(false);
  });

  it('should overwrite existing SEO field', () => {
    addPage(doc, 'page-1');

    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'title',
      value: 'Old Title',
    });
    applyCommand(doc, {
      type: 'UPDATE_PAGE_SEO',
      pageId: 'page-1',
      field: 'title',
      value: 'New Title',
    });

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const seo = page.get('seo') as Y.Map<unknown>;
    expect(seo.get('title')).toBe('New Title');
  });

  it('should no-op for non-existent page', () => {
    expect(() => {
      applyCommand(doc, {
        type: 'UPDATE_PAGE_SEO',
        pageId: 'non-existent',
        field: 'title',
        value: 'Title',
      });
    }).not.toThrow();
  });
});

// ============================================================================
// REMOVE_DRAWN_ELEMENT
// ============================================================================
describe('REMOVE_DRAWN_ELEMENT', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should remove a root drawn element from elements and rootElementIds', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');

    const elements = doc.getMap('elements');
    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;

    expect(elements.has('drawn-1')).toBe(true);
    expect(rootIds.toArray()).toContain('drawn-1');

    applyCommand(doc, {
      type: 'REMOVE_DRAWN_ELEMENT',
      elementKey: 'drawn-1',
    });

    expect(elements.has('drawn-1')).toBe(false);
    expect(rootIds.toArray()).not.toContain('drawn-1');
  });

  it('should remove a child drawn element without touching rootElementIds', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-child', 'page-1', 'parent-1');

    const elements = doc.getMap('elements');
    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    const rootBefore = rootIds.toArray();

    applyCommand(doc, {
      type: 'REMOVE_DRAWN_ELEMENT',
      elementKey: 'drawn-child',
    });

    expect(elements.has('drawn-child')).toBe(false);
    // rootElementIds unchanged
    expect(rootIds.toArray()).toEqual(rootBefore);
  });

  it('should clean up sourceClasses entries', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');

    const sourceClasses = doc.getMap('sourceClasses');
    expect(sourceClasses.has('drawn-1')).toBe(true);

    applyCommand(doc, {
      type: 'REMOVE_DRAWN_ELEMENT',
      elementKey: 'drawn-1',
    });

    expect(sourceClasses.has('drawn-1')).toBe(false);
  });

  it('should clean up sourceText entries', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');

    // Manually add a sourceText entry
    const sourceText = doc.getMap('sourceText');
    sourceText.set('drawn-1', 'some text');

    applyCommand(doc, {
      type: 'REMOVE_DRAWN_ELEMENT',
      elementKey: 'drawn-1',
    });

    expect(sourceText.has('drawn-1')).toBe(false);
  });



  it('should no-op for non-existent element', () => {
    expect(() => {
      applyCommand(doc, {
        type: 'REMOVE_DRAWN_ELEMENT',
        elementKey: 'non-existent',
      });
    }).not.toThrow();
  });
});

// ============================================================================
// CLEAR_INSTANCE_CHILD_ORDERS
// ============================================================================
describe('CLEAR_INSTANCE_CHILD_ORDERS', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should clear childOrders for the instance and its children', () => {
    addPage(doc, 'page-1');

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;

    // Set up childOrders map with instance keys
    const childOrders = new Y.Map<Y.Array<string>>();
    childOrders.set('inst-1', Y.Array.from(['a', 'b']));
    childOrders.set('inst-1:section-0', Y.Array.from(['c', 'd']));
    childOrders.set('inst-1:h1-0', Y.Array.from(['e']));
    childOrders.set('inst-2', Y.Array.from(['f', 'g'])); // different instance
    page.set('childOrders', childOrders);

    applyCommand(doc, {
      type: 'CLEAR_INSTANCE_CHILD_ORDERS',
      pageId: 'page-1',
      instanceId: 'inst-1',
    });

    // inst-1 and its children should be removed
    expect(childOrders.has('inst-1')).toBe(false);
    expect(childOrders.has('inst-1:section-0')).toBe(false);
    expect(childOrders.has('inst-1:h1-0')).toBe(false);
    // inst-2 should remain
    expect(childOrders.has('inst-2')).toBe(true);
    expect((childOrders.get('inst-2') as Y.Array<string>).toArray()).toEqual([
      'f',
      'g',
    ]);
  });

  it('should no-op when childOrders map does not exist', () => {
    addPage(doc, 'page-1');

    expect(() => {
      applyCommand(doc, {
        type: 'CLEAR_INSTANCE_CHILD_ORDERS',
        pageId: 'page-1',
        instanceId: 'inst-1',
      });
    }).not.toThrow();
  });

  it('should no-op for non-existent page', () => {
    expect(() => {
      applyCommand(doc, {
        type: 'CLEAR_INSTANCE_CHILD_ORDERS',
        pageId: 'non-existent',
        instanceId: 'inst-1',
      });
    }).not.toThrow();
  });

  it('should not delete unrelated instance keys', () => {
    addPage(doc, 'page-1');

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;

    const childOrders = new Y.Map<Y.Array<string>>();
    childOrders.set('inst-1', Y.Array.from(['a']));
    childOrders.set('inst-10', Y.Array.from(['b'])); // starts with inst-1 but different instance
    childOrders.set('inst-1:child', Y.Array.from(['c']));
    page.set('childOrders', childOrders);

    applyCommand(doc, {
      type: 'CLEAR_INSTANCE_CHILD_ORDERS',
      pageId: 'page-1',
      instanceId: 'inst-1',
    });

    expect(childOrders.has('inst-1')).toBe(false);
    expect(childOrders.has('inst-1:child')).toBe(false);
    // inst-10 should NOT be deleted (different instance, just happens to start with "inst-1")
    expect(childOrders.has('inst-10')).toBe(true);
  });
});

// ============================================================================
// CLEAR_PAGE_DRAWN_ELEMENTS
// ============================================================================
describe('CLEAR_PAGE_DRAWN_ELEMENTS', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
  });

  it('should remove all drawn elements from the specified page', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');
    addDrawnElement(doc, 'drawn-2', 'page-1');

    const elements = doc.getMap('elements');
    expect(elements.has('drawn-1')).toBe(true);
    expect(elements.has('drawn-2')).toBe(true);

    applyCommand(doc, {
      type: 'CLEAR_PAGE_DRAWN_ELEMENTS',
      pageId: 'page-1',
    });

    expect(elements.has('drawn-1')).toBe(false);
    expect(elements.has('drawn-2')).toBe(false);
  });

  it('should not remove non-drawn elements', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');

    // Add a regular (non-drawn) element
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: emptyClassData(),
      },
    });

    const elements = doc.getMap('elements');
    expect(elements.has('drawn-1')).toBe(true);
    expect(elements.has('elem-1')).toBe(true);

    applyCommand(doc, {
      type: 'CLEAR_PAGE_DRAWN_ELEMENTS',
      pageId: 'page-1',
    });

    expect(elements.has('drawn-1')).toBe(false);
    expect(elements.has('elem-1')).toBe(true); // preserved
  });

  it('should not remove drawn elements from other pages', () => {
    addPage(doc, 'page-1');
    addPage(doc, 'page-2');
    addDrawnElement(doc, 'drawn-p1', 'page-1');
    addDrawnElement(doc, 'drawn-p2', 'page-2');

    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'CLEAR_PAGE_DRAWN_ELEMENTS',
      pageId: 'page-1',
    });

    expect(elements.has('drawn-p1')).toBe(false);
    expect(elements.has('drawn-p2')).toBe(true); // different page, preserved
  });

  it('should remove drawn elements from rootElementIds', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');
    addDrawnElement(doc, 'drawn-2', 'page-1');

    const pages = doc.getMap('pages');
    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toContain('drawn-1');
    expect(rootIds.toArray()).toContain('drawn-2');

    applyCommand(doc, {
      type: 'CLEAR_PAGE_DRAWN_ELEMENTS',
      pageId: 'page-1',
    });

    expect(rootIds.toArray()).not.toContain('drawn-1');
    expect(rootIds.toArray()).not.toContain('drawn-2');
  });

  it('should clean up sourceClasses entries for drawn elements', () => {
    addPage(doc, 'page-1');
    addDrawnElement(doc, 'drawn-1', 'page-1');
    addDrawnElement(doc, 'drawn-2', 'page-1');

    const sourceClasses = doc.getMap('sourceClasses');
    expect(sourceClasses.has('drawn-1')).toBe(true);
    expect(sourceClasses.has('drawn-2')).toBe(true);

    applyCommand(doc, {
      type: 'CLEAR_PAGE_DRAWN_ELEMENTS',
      pageId: 'page-1',
    });

    expect(sourceClasses.has('drawn-1')).toBe(false);
    expect(sourceClasses.has('drawn-2')).toBe(false);
  });



  it('should no-op when page has no drawn elements', () => {
    addPage(doc, 'page-1');

    // Add only a regular element
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: emptyClassData(),
      },
    });

    const elements = doc.getMap('elements');
    expect(elements.size).toBe(1);

    applyCommand(doc, {
      type: 'CLEAR_PAGE_DRAWN_ELEMENTS',
      pageId: 'page-1',
    });

    expect(elements.size).toBe(1); // regular element preserved
  });
});

// ============================================================================
// ADD_DRAWN_ELEMENT — staticMarkup for vector shapes (task-106)
// ============================================================================
describe('ADD_DRAWN_ELEMENT staticMarkup', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
    addPage(doc, 'page-1');
  });

  it('stores staticMarkup for plain (non-slot) drawn elements', () => {
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: 'drawn-svg-1',
        tag: 'div',
        classes: 'w-[100px] h-[50px] text-gray-900',
        textContent: '',
        parentKey: null,
        insertIndex: 0,
        pageId: 'page-1',
        staticMarkup: '<svg viewBox="0 0 100 100"><line x1="0" y1="0" x2="100" y2="100"/></svg>',
      },
    });
    const yEl = doc.getMap('elements').get('drawn-svg-1') as Y.Map<unknown>;
    expect(yEl.get('staticMarkup')).toContain('<svg');
  });

  it('does not store staticMarkup for non-blog slot elements', () => {
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: 'drawn-slot-1',
        tag: 'div',
        classes: 'w-full',
        textContent: '',
        parentKey: null,
        insertIndex: 0,
        pageId: 'page-1',
        slotType: 'component',
        staticMarkup: '<div>SHOULD NOT PERSIST</div>',
      },
    });
    const yEl = doc.getMap('elements').get('drawn-slot-1') as Y.Map<unknown>;
    expect(yEl.get('staticMarkup')).toBeUndefined();
  });
});

// ============================================================================
// Pen tool — penPath on drawn elements + UPDATE_PEN_PATH (task-107)
// ============================================================================
describe('pen tool commands', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = new Y.Doc();
    dispatchEventMock.mockClear();
    addPage(doc, 'page-1');
  });

  const addPen = () =>
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: 'drawn-pen-1',
        tag: 'div',
        classes: 'w-[100px] h-[50px] fill-none stroke-gray-900 stroke-2',
        textContent: '',
        parentKey: null,
        insertIndex: 0,
        pageId: 'page-1',
        staticMarkup: '<svg viewBox="0 0 100 50"><path d="M 0 0 L 100 50"/></svg>',
        penPath: '{"anchors":[{"x":0,"y":0,"corner":true},{"x":100,"y":50,"corner":true}],"closed":false}',
      },
    });

  it('ADD_DRAWN_ELEMENT stores penPath JSON for non-slot drawn elements', () => {
    addPen();
    const yEl = doc.getMap('elements').get('drawn-pen-1') as Y.Map<unknown>;
    expect(yEl.get('penPath')).toContain('"anchors"');
  });

  it('UPDATE_PEN_PATH sets penPath + staticMarkup + classes atomically', () => {
    addPen();
    applyCommand(doc, {
      type: 'UPDATE_PEN_PATH',
      elementId: 'drawn-pen-1',
      penPath: '{"anchors":[{"x":0,"y":0,"corner":true},{"x":80,"y":40,"corner":true}],"closed":false}',
      staticMarkup: '<svg viewBox="0 0 80 40"><path d="M 0 0 L 80 40"/></svg>',
      classes: 'w-[80px] h-[40px] fill-none stroke-gray-900 stroke-2',
    });
    const yEl = doc.getMap('elements').get('drawn-pen-1') as Y.Map<unknown>;
    expect(yEl.get('staticMarkup')).toContain('80 40');
    expect(yEl.get('penPath')).toContain('"x":80');
    const entry = doc.getMap('sourceClasses').get('drawn-pen-1') as Y.Map<unknown>;
    expect(entry.get('classes')).toContain('w-[80px]');
  });

  it('UPDATE_PEN_PATH on missing element returns false, mutates nothing', () => {
    expect(
      applyCommand(doc, {
        type: 'UPDATE_PEN_PATH',
        elementId: 'nope',
        penPath: '{}',
        staticMarkup: '',
        classes: '',
      }),
    ).toBe(false);
    expect(doc.getMap('sourceClasses').get('nope')).toBeUndefined();
  });
});
