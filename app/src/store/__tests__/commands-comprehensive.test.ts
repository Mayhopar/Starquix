/**
 * Comprehensive Commands and Undo/Redo Tests
 *
 * Phase 6 tests covering:
 * - All command types
 * - isTokenForSlot slot categorization
 * - Grid conflict resolution
 * - Instance override commands
 * - Link commands
 * - Page management commands
 * - Element management commands
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand, cleanOrphanedLinkOverrides, OVERRIDE_FIELDS } from '../commands';
import type { Breakpoint, ClassData, ElementType } from '../types';

/** Create ClassData with defaults for all breakpoints */
function makeClasses(overrides: Partial<ClassData>): ClassData {
  return {
    base: [],
    sm: [],
    md: [],
    lg: [],
    xl: [],
    '2xl': [],
    ...overrides,
  };
}

/** Create a basic doc setup with a page */
function setupDoc(): Y.Doc {
  const doc = createEditorDoc();

  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { id: 'page-1', name: 'Test Page', rootElementIds: [], children: [] },
  });

  return doc;
}

/** Create a doc with a page and element */
function setupDocWithElement(
  classes: ClassData = makeClasses({}),
  options?: { staticMarkup?: string; type?: ElementType }
): {
  doc: Y.Doc;
  getClasses: (breakpoint: Breakpoint) => string[];
  getElement: () => Y.Map<unknown>;
} {
  const doc = createEditorDoc();

  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { id: 'page-1', name: 'Test', rootElementIds: [], children: [] },
  });

  applyCommand(doc, {
    type: 'ADD_ELEMENT',
    element: {
      id: 'elem-1',
      pageId: 'page-1',
      parentId: null,
      index: 0,
      type: options?.type ?? 'frame',
      classes,
      staticMarkup: options?.staticMarkup,
    },
  });

  const elements = doc.getMap('elements');

  function getClasses(breakpoint: Breakpoint): string[] {
    const element = elements.get('elem-1') as Y.Map<unknown>;
    const classMap = element.get('classes') as Y.Map<Y.Array<string>>;
    return (classMap.get(breakpoint) as Y.Array<string>).toArray();
  }

  function getElement(): Y.Map<unknown> {
    return elements.get('elem-1') as Y.Map<unknown>;
  }

  return { doc, getClasses, getElement };
}

// =====================================================
// SET_CURRENT_PAGE Command
// =====================================================
describe('SET_CURRENT_PAGE', () => {
  it('should set current page id', () => {
    const doc = setupDoc();
    const meta = doc.getMap('meta');

    applyCommand(doc, {
      type: 'SET_CURRENT_PAGE',
      pageId: 'page-1',
    });

    expect(meta.get('currentPageId')).toBe('page-1');
  });
});

// =====================================================
// SET_BREAKPOINT Command
// =====================================================
describe('SET_BREAKPOINT', () => {
  it('should set current breakpoint', () => {
    const doc = createEditorDoc();
    const meta = doc.getMap('meta');

    applyCommand(doc, {
      type: 'SET_BREAKPOINT',
      breakpoint: 'md',
    });

    expect(meta.get('currentBreakpoint')).toBe('md');
  });

  it('should change breakpoint', () => {
    const doc = createEditorDoc();
    const meta = doc.getMap('meta');

    applyCommand(doc, { type: 'SET_BREAKPOINT', breakpoint: 'sm' });
    applyCommand(doc, { type: 'SET_BREAKPOINT', breakpoint: 'lg' });

    expect(meta.get('currentBreakpoint')).toBe('lg');
  });
});

// =====================================================
// SET_THEME_MODE Command
// =====================================================
describe('SET_THEME_MODE', () => {
  it('should set and clear the canvas theme mode', () => {
    const doc = createEditorDoc();
    const meta = doc.getMap('meta');

    applyCommand(doc, { type: 'SET_THEME_MODE', mode: 'dark' });
    expect(meta.get('currentThemeMode')).toBe('dark');

    applyCommand(doc, { type: 'SET_THEME_MODE', mode: null });
    expect(meta.get('currentThemeMode')).toBe(null);
  });
});

// =====================================================
// ADD_PAGE / DELETE_PAGE Commands
// =====================================================
describe('ADD_PAGE', () => {
  it('should add a page', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: {
        id: 'page-1',
        name: 'Home',
        rootElementIds: ['elem-1'],
        children: ['page-2'],
      },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    expect(page.get('id')).toBe('page-1');
    expect(page.get('name')).toBe('Home');
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['elem-1']);
    expect((page.get('children') as Y.Array<string>).toArray()).toEqual(['page-2']);
  });

  it('should add page with empty arrays', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: {
        id: 'page-1',
        name: 'Empty Page',
        rootElementIds: [],
        children: [],
      },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    expect((page.get('rootElementIds') as Y.Array<string>).toArray()).toEqual([]);
    expect((page.get('children') as Y.Array<string>).toArray()).toEqual([]);
  });
});

describe('DELETE_PAGE', () => {
  it('should not delete the last page', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Only Page', rootElementIds: [], children: [] },
    });

    applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'page-1',
    });

    expect(pages.size).toBe(1);
  });

  it('should delete page and its elements', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Add two pages
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Page 1', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Page 2', rootElementIds: [], children: [] },
    });

    // Add element to page-2
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-1',
        pageId: 'page-2',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Delete page-2
    applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'page-2',
    });

    expect(pages.has('page-2')).toBe(false);
    expect(elements.has('elem-1')).toBe(false);
  });

  it('should clean up sourceClasses and sourceText for deleted page elements', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');
    const sourceClasses = doc.getMap('sourceClasses');
    const sourceText = doc.getMap('sourceText');

    // Add two pages
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Page 1', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Page 2', rootElementIds: [], children: [] },
    });

    // Add element to page-2
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-del',
        pageId: 'page-2',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Add element to page-1 (should survive)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-keep',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Register sourceClasses for deleted element (root + child keys)
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-del',
      classes: 'flex',
    });
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-del:h1-0',
      classes: 'text-xl',
    });
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-del:p-0',
      classes: 'text-base',
    });

    // Register sourceText for deleted element child
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-del:h1-0',
      textContent: 'Hello',
    });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-del:p-0',
      textContent: 'World',
    });

    // Register sourceClasses/sourceText for surviving element
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-keep',
      classes: 'grid',
    });
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-keep:span-0',
      classes: 'text-sm',
    });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-keep:span-0',
      textContent: 'Preserved',
    });

    // Verify all entries exist before deletion
    expect(sourceClasses.has('elem-del')).toBe(true);
    expect(sourceClasses.has('elem-del:h1-0')).toBe(true);
    expect(sourceClasses.has('elem-del:p-0')).toBe(true);
    expect(sourceText.has('elem-del:h1-0')).toBe(true);
    expect(sourceText.has('elem-del:p-0')).toBe(true);
    expect(sourceClasses.has('elem-keep')).toBe(true);
    expect(sourceClasses.has('elem-keep:span-0')).toBe(true);
    expect(sourceText.has('elem-keep:span-0')).toBe(true);

    // Delete page-2
    applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'page-2',
    });

    // Deleted element's sourceClasses and sourceText should be cleaned
    expect(sourceClasses.has('elem-del')).toBe(false);
    expect(sourceClasses.has('elem-del:h1-0')).toBe(false);
    expect(sourceClasses.has('elem-del:p-0')).toBe(false);
    expect(sourceText.has('elem-del:h1-0')).toBe(false);
    expect(sourceText.has('elem-del:p-0')).toBe(false);

    // Surviving element's sourceClasses and sourceText should be preserved
    expect(sourceClasses.has('elem-keep')).toBe(true);
    expect(sourceClasses.has('elem-keep:span-0')).toBe(true);
    expect(sourceText.has('elem-keep:span-0')).toBe(true);
  });

  it('should clean up sourceText entries that exist without corresponding sourceClasses entries', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');
    const sourceText = doc.getMap('sourceText');
    const sourceClasses = doc.getMap('sourceClasses');

    // Add two pages (DELETE_PAGE requires pages.size > 1)
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Page 1', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Page 2', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-drawn',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<div><h1>Title</h1></div>',
      },
    });

    // Create sourceText entries WITHOUT corresponding sourceClasses entries
    // (simulates drawn elements or instance children with text edits but no REGISTER_SOURCE_ELEMENT)
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-drawn:h1-0',
      textContent: 'Edited Title',
    });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-drawn:p-0',
      textContent: 'Edited Body',
    });

    // Also create a sourceText entry for a different element
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'other-elem:h1-0',
      textContent: 'Other text',
    });

    // Verify: sourceText entries exist, no sourceClasses entries
    expect(sourceText.has('elem-drawn:h1-0')).toBe(true);
    expect(sourceText.has('elem-drawn:p-0')).toBe(true);
    expect(sourceClasses.has('elem-drawn:h1-0')).toBe(false);
    expect(sourceClasses.has('elem-drawn:p-0')).toBe(false);

    // Delete the page (triggers REMOVE_ELEMENT → deleteSourceEntries)
    applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'page-1',
    });

    // sourceText entries for deleted element should be cleaned even without sourceClasses
    expect(sourceText.has('elem-drawn:h1-0')).toBe(false);
    expect(sourceText.has('elem-drawn:p-0')).toBe(false);

    // Other element's sourceText should be preserved
    expect(sourceText.has('other-elem:h1-0')).toBe(true);
  });

  it('should clean up sourceImageAttributes and sourceLinkAttributes for deleted page elements', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');
    const sourceImageAttributes = doc.getMap('sourceImageAttributes');
    const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');

    // Add two pages
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Page 1', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Page 2', rootElementIds: [], children: [] },
    });

    // Add source element to page-2 (source elements have keys like src/Hero.astro:5:1)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'src/Component.astro:3:1',
        pageId: 'page-2',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Add source element to page-1 (should survive)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'src/Hero.astro:5:1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Set sourceImageAttributes for both elements
    applyCommand(doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE',
      elementId: 'src/Component.astro:3:1',
      attribute: 'src',
      value: '/deleted-img.png',
    });
    applyCommand(doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE',
      elementId: 'src/Hero.astro:5:1',
      attribute: 'src',
      value: '/kept-img.png',
    });

    // Set sourceLinkAttributes for both elements
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'src/Component.astro:3:1',
      attribute: 'href',
      value: '/deleted-link',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'src/Hero.astro:5:1',
      attribute: 'href',
      value: '/kept-link',
    });

    // Verify all entries exist before deletion
    expect(sourceImageAttributes.has('src/Component.astro:3:1')).toBe(true);
    expect(sourceImageAttributes.has('src/Hero.astro:5:1')).toBe(true);
    expect(sourceLinkAttributes.has('src/Component.astro:3:1')).toBe(true);
    expect(sourceLinkAttributes.has('src/Hero.astro:5:1')).toBe(true);

    // Delete page-2
    applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'page-2',
    });

    // Deleted element's sourceImageAttributes and sourceLinkAttributes should be cleaned
    expect(sourceImageAttributes.has('src/Component.astro:3:1')).toBe(false);
    expect(sourceLinkAttributes.has('src/Component.astro:3:1')).toBe(false);

    // Surviving element's entries should be preserved
    expect(sourceImageAttributes.has('src/Hero.astro:5:1')).toBe(true);
    expect(sourceLinkAttributes.has('src/Hero.astro:5:1')).toBe(true);
  });

  // Regression: task-020 — guard against deleting a root page that has children,
  // which would otherwise cascade-delete the entire subtree silently.
  it('should refuse to delete a root page that has child pages', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Sibling root page so the last-page guard isn't what's stopping us
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'sibling-root', name: 'Sibling', rootElementIds: [], children: [] },
    });
    // Root page that owns a child
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'root-with-children', name: 'Root', rootElementIds: [], children: ['child-1'] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'child-1', name: 'Child', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-on-child',
        pageId: 'child-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    const sizeBefore = pages.size;
    const result = applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'root-with-children',
    });

    expect(result).toBe(false);
    expect(pages.size).toBe(sizeBefore);
    expect(pages.has('root-with-children')).toBe(true);
    expect(pages.has('child-1')).toBe(true);
    expect(elements.has('elem-on-child')).toBe(true);
  });

  it('should still delete a root page that has no children', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Page 1', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Page 2', rootElementIds: [], children: [] },
    });

    const result = applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'page-2',
    });

    expect(result).not.toBe(false);
    expect(pages.has('page-2')).toBe(false);
    expect(pages.has('page-1')).toBe(true);
  });

  it('should still delete a leaf (non-root) child page', () => {
    const doc = createEditorDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'sibling-root', name: 'Sibling', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'parent', name: 'Parent', rootElementIds: [], children: ['leaf'] },
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'leaf', name: 'Leaf', rootElementIds: [], children: [] },
    });

    const result = applyCommand(doc, {
      type: 'DELETE_PAGE',
      pageId: 'leaf',
    });

    expect(result).not.toBe(false);
    expect(pages.has('leaf')).toBe(false);
    expect(pages.has('parent')).toBe(true);
  });
});

describe('RENAME_PAGE', () => {
  it('should rename a page', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'RENAME_PAGE',
      pageId: 'page-1',
      name: 'New Name',
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    expect(page.get('name')).toBe('New Name');
  });

  it('should do nothing for non-existent page', () => {
    const doc = setupDoc();

    // Should not throw
    applyCommand(doc, {
      type: 'RENAME_PAGE',
      pageId: 'non-existent',
      name: 'New Name',
    });
  });
});

// =====================================================
// ADD_ELEMENT / REMOVE_ELEMENT Commands
// =====================================================
describe('ADD_ELEMENT', () => {
  it('should add an element with classes', () => {
    const { doc, getClasses, getElement } = setupDocWithElement(
      makeClasses({ base: ['flex', 'gap-4'], md: ['flex-row'] })
    );

    expect(getElement().get('id')).toBe('elem-1');
    expect(getElement().get('type')).toBe('frame');
    expect(getClasses('base')).toEqual(['flex', 'gap-4']);
    expect(getClasses('md')).toEqual(['flex-row']);
  });

  it('should add element with static markup', () => {
    const { getElement } = setupDocWithElement(makeClasses({}), {
      staticMarkup: '<div><p>Hello</p></div>',
    });

    const markup = getElement().get('staticMarkup') as string;
    expect(markup).toContain('data-key="elem-1:div-0"');
    expect(markup).toContain('data-key="elem-1:p-0"');
  });

  it('should add element to page rootElementIds', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toContain('elem-1');
  });

  it('should not add to rootElementIds if parentId is set', () => {
    const { doc } = setupDocWithElement();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-2',
        pageId: 'page-1',
        parentId: 'elem-1',
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).not.toContain('elem-2');
  });
});

describe('REMOVE_ELEMENT', () => {
  it('should remove an element', () => {
    const { doc, getElement } = setupDocWithElement();
    const elements = doc.getMap('elements');

    expect(elements.has('elem-1')).toBe(true);

    applyCommand(doc, {
      type: 'REMOVE_ELEMENT',
      elementId: 'elem-1',
    });

    expect(elements.has('elem-1')).toBe(false);
  });

  it('should remove from page rootElementIds', () => {
    const { doc } = setupDocWithElement();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'REMOVE_ELEMENT',
      elementId: 'elem-1',
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).not.toContain('elem-1');
  });

  it('should clean up sourceImageAttributes and sourceLinkAttributes for source elements', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');
    const sourceImageAttributes = doc.getMap('sourceImageAttributes');
    const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');

    // Add a source-type element (key is a source location)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'src/Hero.astro:5:1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Set sourceImageAttributes and sourceLinkAttributes
    applyCommand(doc, {
      type: 'UPDATE_IMAGE_ATTRIBUTE',
      elementId: 'src/Hero.astro:5:1',
      attribute: 'src',
      value: '/hero.png',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'src/Hero.astro:5:1',
      attribute: 'href',
      value: '/about',
    });

    expect(sourceImageAttributes.has('src/Hero.astro:5:1')).toBe(true);
    expect(sourceLinkAttributes.has('src/Hero.astro:5:1')).toBe(true);

    // Remove the element
    applyCommand(doc, {
      type: 'REMOVE_ELEMENT',
      elementId: 'src/Hero.astro:5:1',
    });

    expect(elements.has('src/Hero.astro:5:1')).toBe(false);
    expect(sourceImageAttributes.has('src/Hero.astro:5:1')).toBe(false);
    expect(sourceLinkAttributes.has('src/Hero.astro:5:1')).toBe(false);
  });

  it('should clean childOrders entries when element is removed as parent', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Add an element
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'inst-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<section><h1>Title</h1><p>Body</p></section>',
      },
    });

    // Set childOrders with inst-1 as parent key
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'inst-1:section-0',
      childKeys: ['inst-1:h1-0', 'inst-1:p-0'],
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    expect(childOrders.has('inst-1:section-0')).toBe(true);

    // Remove the element
    applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: 'inst-1' });

    expect(elements.has('inst-1')).toBe(false);
    // childOrders entry for inst-1:section-0 should be cleaned
    expect(childOrders.has('inst-1:section-0')).toBe(false);
  });

  it('rejects SET_CHILD_ORDER when parentKey parses as a source location', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const bogusParent = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
    const ok = applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: bogusParent,
      childKeys: ['inst-1:section-0', 'inst-2:section-0'],
    });

    expect(ok).toBe(false);

    const page = pages.get('page-1') as Y.Map<unknown>;
    const childOrders = page.get('childOrders') as
      | Y.Map<Y.Array<string>>
      | undefined;
    expect(childOrders?.has(bogusParent) ?? false).toBe(false);

    expect(errSpy).toHaveBeenCalled();
    const firstCall = errSpy.mock.calls[0].join(' ');
    expect(firstCall).toContain('SET_CHILD_ORDER');
    expect(firstCall).toContain(bogusParent);

    errSpy.mockRestore();
  });

  it('should clean childOrders entries when element is removed as child', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');
    const elements = doc.getMap('elements');

    // Add parent and child elements
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'parent-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<div></div>',
      },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'child-1',
        pageId: 'page-1',
        parentId: null,
        index: 1,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<p>Text</p>',
      },
    });

    // Set childOrders with child-1 as a child in parent-1's ordering
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'parent-1:div-0',
      childKeys: ['child-1:p-0', 'other:span-0'],
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    expect(childOrders.get('parent-1:div-0')!.toArray()).toEqual(['child-1:p-0', 'other:span-0']);

    // Remove child-1
    applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: 'child-1' });

    // child-1:p-0 should be removed from the array, other:span-0 should remain
    expect(childOrders.get('parent-1:div-0')!.toArray()).toEqual(['other:span-0']);
  });

  it('should preserve non-matching childOrders entries on element removal', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-a',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<div></div>',
      },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'elem-b',
        pageId: 'page-1',
        parentId: null,
        index: 1,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<section></section>',
      },
    });

    // Set childOrders for both elements
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'elem-a:div-0',
      childKeys: ['elem-a:span-0'],
    });
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'elem-b:section-0',
      childKeys: ['elem-b:h1-0'],
    });

    // Remove elem-a — only its childOrders should be cleaned
    applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: 'elem-a' });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    expect(childOrders.has('elem-a:div-0')).toBe(false);
    expect(childOrders.has('elem-b:section-0')).toBe(true);
    expect(childOrders.get('elem-b:section-0')!.toArray()).toEqual(['elem-b:h1-0']);
  });

  it('writes orderOverrides on the instance when reorder targets the instance root', () => {
    // Regression: reordering top-level children of a component-editor element
    // only updated `page.childOrders`, which pushOverridesToSource never
    // reads. The new order was lost on the next rebuild, so reorders inside
    // the BlogPost editor never reached BlogPost.astro.
    const doc = setupDoc();
    const elements = doc.getMap('elements');
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'editor-el',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        astroSource: 'library/BlogPost.astro',
        classes: makeClasses({}),
        staticMarkup: '<div><header>H</header><footer>F</footer></div>',
      },
    });

    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'editor-el',
      childKeys: ['editor-el:footer-0', 'editor-el:header-0'],
    });

    const editorEl = elements.get('editor-el') as Y.Map<unknown>;
    const yOrder = editorEl.get('orderOverrides') as Y.Array<string>;
    expect(yOrder).toBeDefined();
    expect(yOrder.toArray()).toEqual(['footer-0', 'header-0']);
  });

  it('writes orderOverrides when reorder happens inside a deeper sub-element of the instance', () => {
    // Regression: in BlogPost editor, Header/Footer are children of the
    // resolved staticMarkup's outer `<Layout>` — their parentKey from the
    // scanner is `editorId:layout-0`, NOT the instance root. The original
    // fix only triggered when parentKey === instance id, so this real-world
    // case was silently dropping reorders. Now we walk from the child keys
    // up to the instance and write there.
    const doc = setupDoc();
    const elements = doc.getMap('elements');
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'editor-el',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        astroSource: 'library/BlogPost.astro',
        classes: makeClasses({}),
        staticMarkup: '<div data-key="editor-el:div-0"><div data-key="editor-el:layout-0"><header data-key="editor-el:header-0"></header><footer data-key="editor-el:footer-0"></footer></div></div>',
      },
    });

    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'editor-el:layout-0',
      childKeys: ['editor-el:footer-0', 'editor-el:header-0'],
    });

    const editorEl = elements.get('editor-el') as Y.Map<unknown>;
    const yOrder = editorEl.get('orderOverrides') as Y.Array<string>;
    expect(yOrder).toBeDefined();
    expect(yOrder.toArray()).toEqual(['footer-0', 'header-0']);
  });

  it('does NOT write orderOverrides when reorder targets a non-instance parent', () => {
    // Sanity: `page.childOrders` is still the right home for per-parent
    // sibling ordering at the page level. Only instance-root reorders pump
    // through to orderOverrides for source write-back.
    const doc = setupDoc();
    const elements = doc.getMap('elements');
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'no-source',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
        staticMarkup: '<div></div>',
      },
    });

    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'no-source',
      childKeys: ['no-source:a-0', 'no-source:b-0'],
    });

    const el = elements.get('no-source') as Y.Map<unknown>;
    expect(el.get('orderOverrides')).toBeUndefined();
  });
});

// =====================================================
// REORDER Commands
// =====================================================
describe('REORDER_PAGE_ELEMENTS', () => {
  it('should reorder page root elements', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    // Add multiple elements
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-2', pageId: 'page-1', parentId: null, index: 1, type: 'frame', classes: makeClasses({}) },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-3', pageId: 'page-1', parentId: null, index: 2, type: 'frame', classes: makeClasses({}) },
    });

    // Reorder
    applyCommand(doc, {
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'page-1',
      elementIds: ['elem-3', 'elem-1', 'elem-2'],
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toEqual(['elem-3', 'elem-1', 'elem-2']);
  });
});

// =====================================================
// SOURCE Commands
// =====================================================
describe('REGISTER_SOURCE_ELEMENT', () => {
  it('should register source element', () => {
    const doc = createEditorDoc();
    const sourceClasses = doc.getMap('sourceClasses');

    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'src/Hero.astro:5:1',
      classes: 'flex gap-4',
      sourceLocation: { file: 'src/Hero.astro', line: 5, column: 1 },
    });

    const entry = sourceClasses.get('src/Hero.astro:5:1') as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('flex gap-4');

    const loc = entry.get('sourceLocation') as Y.Map<unknown>;
    expect(loc.get('file')).toBe('src/Hero.astro');
    expect(loc.get('line')).toBe(5);
    expect(loc.get('column')).toBe(1);
  });

  it('should not overwrite existing registration', () => {
    const doc = createEditorDoc();
    const sourceClasses = doc.getMap('sourceClasses');

    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'src/Hero.astro:5:1',
      classes: 'first',
    });

    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'src/Hero.astro:5:1',
      classes: 'second',
    });

    const entry = sourceClasses.get('src/Hero.astro:5:1') as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('first');
  });
});

describe('UPDATE_SOURCE_CLASSES', () => {
  it('should update existing source classes', () => {
    const doc = createEditorDoc();
    const sourceClasses = doc.getMap('sourceClasses');

    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'src/Hero.astro:5:1',
      classes: 'original',
    });

    applyCommand(doc, {
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: 'src/Hero.astro:5:1',
      classes: 'updated',
    });

    const entry = sourceClasses.get('src/Hero.astro:5:1') as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('updated');
  });

  it('should create entry if not exists', () => {
    const doc = createEditorDoc();
    const sourceClasses = doc.getMap('sourceClasses');

    applyCommand(doc, {
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: 'src/Hero.astro:5:1',
      classes: 'new-classes',
    });

    const entry = sourceClasses.get('src/Hero.astro:5:1') as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('new-classes');
  });
});

describe('UPDATE_SOURCE_TEXT', () => {
  it('should update source text', () => {
    const doc = createEditorDoc();
    const sourceText = doc.getMap('sourceText');

    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'src/Hero.astro:5:1',
      textContent: 'Hello World',
    });

    const entry = sourceText.get('src/Hero.astro:5:1') as Y.Map<unknown>;
    expect(entry.get('textContent')).toBe('Hello World');
  });
});

// =====================================================
// Theme Instance Commands
// =====================================================
describe('ADD_THEME_INSTANCE', () => {
  it('should add theme instance with processed markup', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'inst-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        themeId: 'theme-hero',
        componentPath: 'components/Hero',
        staticMarkup: '<div><h1>Title</h1></div>',
        classes: makeClasses({ base: ['flex'] }),
      },
    });

    const instance = elements.get('inst-1') as Y.Map<unknown>;
    expect(instance.get('type')).toBe('instance');
    expect(instance.get('instanceType')).toBe('theme');
    expect(instance.get('themeId')).toBe('theme-hero');

    const markup = instance.get('staticMarkup') as string;
    expect(markup).toContain('data-key="inst-1:div-0"');
    expect(markup).toContain('data-key="inst-1:h1-0"');
  });
});

describe('UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', () => {
  it('should update class override for selector', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'inst-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        themeId: 'theme-hero',
        componentPath: 'components/Hero',
        classes: makeClasses({}),
      },
    });

    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'inst-1',
      selector: 'h1-0',
      breakpoint: 'base',
      classes: ['text-4xl', 'font-bold'],
    });

    const instance = elements.get('inst-1') as Y.Map<unknown>;
    const classOverrides = instance.get('classOverrides') as Y.Map<Y.Map<Y.Array<string>>>;
    const selectorOverride = classOverrides.get('h1-0') as Y.Map<Y.Array<string>>;
    const baseClasses = selectorOverride.get('base') as Y.Array<string>;

    expect(baseClasses.toArray()).toEqual(['text-4xl', 'font-bold']);
  });
});

describe('RESET_THEME_INSTANCE_OVERRIDE', () => {
  it('should remove override for selector', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'inst-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        themeId: 'theme-hero',
        componentPath: 'components/Hero',
        classes: makeClasses({}),
      },
    });

    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'inst-1',
      selector: 'h1-0',
      breakpoint: 'base',
      classes: ['text-4xl'],
    });

    applyCommand(doc, {
      type: 'RESET_THEME_INSTANCE_OVERRIDE',
      instanceId: 'inst-1',
      selector: 'h1-0',
    });

    const instance = elements.get('inst-1') as Y.Map<unknown>;
    const classOverrides = instance.get('classOverrides') as Y.Map<unknown>;
    expect(classOverrides.has('h1-0')).toBe(false);
  });

  it('should clean all 8 override types for the selector', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'inst-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        themeId: 'theme-hero',
        componentPath: 'components/Hero',
        classes: makeClasses({}),
      },
    });

    const instance = elements.get('inst-1') as Y.Map<unknown>;

    // Set up classOverrides via command
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'inst-1',
      selector: 'h1-0',
      breakpoint: 'base',
      classes: ['text-4xl'],
    });

    // Set up markupOverrides via command
    applyCommand(doc, {
      type: 'UPDATE_MARKUP_OVERRIDE',
      instanceId: 'inst-1',
      selector: 'h1-0',
      markup: '<h1><a href="#">Link</a></h1>',
    });

    // Manually set overrides, textOverrides, imageOverrides, linkOverrides, hrefOverrides, unifiedOverrides
    // These don't have dedicated setup commands, so we set them directly on the Y.Map
    const selectorKey = 'h1-0';
    const otherSelectorKey = 'p-0';

    // overrides (legacy instance overrides)
    let overridesMap = instance.get('overrides') as Y.Map<Y.Map<unknown>> | undefined;
    if (!overridesMap) {
      overridesMap = new Y.Map<Y.Map<unknown>>();
      instance.set('overrides', overridesMap);
    }
    const overrideEntry = new Y.Map<unknown>();
    overrideEntry.set('text', 'Override text');
    overridesMap.set(selectorKey, overrideEntry);

    // textOverrides
    let textOverrides = new Y.Map<string>();
    textOverrides.set(selectorKey, 'Edited text');
    textOverrides.set(otherSelectorKey, 'Other text');
    instance.set('textOverrides', textOverrides);

    // imageOverrides
    let imageOverrides = new Y.Map<Y.Map<string>>();
    const imgEntry = new Y.Map<string>();
    imgEntry.set('src', 'new-img.png');
    imageOverrides.set(selectorKey, imgEntry);
    instance.set('imageOverrides', imageOverrides);

    // linkOverrides
    let linkOverrides = new Y.Map<Y.Map<string>>();
    const linkEntry = new Y.Map<string>();
    linkEntry.set('href', 'https://example.com');
    linkEntry.set('target', '_blank');
    linkOverrides.set(selectorKey, linkEntry);
    linkOverrides.set(otherSelectorKey, new Y.Map<string>());
    instance.set('linkOverrides', linkOverrides);

    // hrefOverrides
    let hrefOverrides = new Y.Map<string>();
    hrefOverrides.set(selectorKey, 'https://old.com');
    instance.set('hrefOverrides', hrefOverrides);

    // unifiedOverrides
    let unifiedOverrides = new Y.Map<Y.Map<unknown>>();
    const unifiedEntry = new Y.Map<unknown>();
    unifiedEntry.set('href', 'https://unified.com');
    unifiedOverrides.set(selectorKey, unifiedEntry);
    unifiedOverrides.set(otherSelectorKey, new Y.Map<unknown>());
    instance.set('unifiedOverrides', unifiedOverrides);

    // Verify all entries exist before reset
    expect((instance.get('classOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('overrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('textOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('markupOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('imageOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('linkOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('hrefOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);
    expect((instance.get('unifiedOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(true);

    // Reset the selector
    applyCommand(doc, {
      type: 'RESET_THEME_INSTANCE_OVERRIDE',
      instanceId: 'inst-1',
      selector: selectorKey,
    });

    // All 8 override types should be cleared for the reset selector
    expect((instance.get('classOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('overrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('textOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('markupOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('imageOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('linkOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('hrefOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);
    expect((instance.get('unifiedOverrides') as Y.Map<unknown>).has(selectorKey)).toBe(false);

    // Other selector entries should be preserved
    expect((instance.get('textOverrides') as Y.Map<unknown>).has(otherSelectorKey)).toBe(true);
    expect((instance.get('linkOverrides') as Y.Map<unknown>).has(otherSelectorKey)).toBe(true);
    expect((instance.get('unifiedOverrides') as Y.Map<unknown>).has(otherSelectorKey)).toBe(true);
  });
});

// =====================================================
// Markup Override Commands
// =====================================================
describe('UPDATE_MARKUP_OVERRIDE', () => {
  it('should store markup override', () => {
    const { doc, getElement } = setupDocWithElement();

    applyCommand(doc, {
      type: 'UPDATE_MARKUP_OVERRIDE',
      instanceId: 'elem-1',
      selector: 'p-0',
      markup: '<p>New content</p>',
    });

    const markupOverrides = getElement().get('markupOverrides') as Y.Map<string>;
    expect(markupOverrides.get('p-0')).toBe('<p>New content</p>');
  });
});

// =====================================================
// Link Commands
// =====================================================
describe('UPDATE_LINK_ATTRIBUTE', () => {
  it('should update link attribute for instance root', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    // Create a simple element (will act as instance root)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'link-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'link',
        classes: makeClasses({}),
      },
    });

    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'link-1',
      attribute: 'href',
      value: 'https://example.com',
    });

    const element = elements.get('link-1') as Y.Map<unknown>;
    const linkAttrs = element.get('linkAttributes') as Y.Map<unknown>;
    expect(linkAttrs.get('href')).toBe('https://example.com');
  });

  it('should remove attribute when value is null', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'link-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'link',
        classes: makeClasses({}),
      },
    });

    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'link-1',
      attribute: 'href',
      value: 'https://example.com',
    });

    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'link-1',
      attribute: 'href',
      value: null,
    });

    const element = elements.get('link-1') as Y.Map<unknown>;
    const linkAttrs = element.get('linkAttributes') as Y.Map<unknown>;
    expect(linkAttrs.has('href')).toBe(false);
  });
});

describe('UNWRAP_LINK', () => {
  it('should restore original type', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    // Set up element already in "converted to link" state
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'comp-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        classes: makeClasses({}),
      },
    });

    // Manually set link state (CONVERT_TO_LINK was removed as dead code)
    const element = elements.get('comp-1') as Y.Map<unknown>;
    element.set('type', 'link');
    element.set('originalType', 'component');
    element.set('isWrapperLink', true);
    const linkAttrs = new Y.Map();
    linkAttrs.set('href', 'https://example.com');
    element.set('linkAttributes', linkAttrs);

    applyCommand(doc, {
      type: 'UNWRAP_LINK',
      elementId: 'comp-1',
    });

    expect(element.get('type')).toBe('component');
    expect(element.has('originalType')).toBe(false);
    expect(element.has('isWrapperLink')).toBe(false);
    expect(element.has('linkAttributes')).toBe(false);
  });

  it('should clean up link-related overrides for instance-child selector', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'comp-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        classes: makeClasses({}),
      },
    });

    const element = elements.get('comp-1') as Y.Map<unknown>;

    // Simulate overrides left by wrap-link flow for link selector a-0
    const markupOverrides = new Y.Map<string>();
    markupOverrides.set('a-0', '<a href="#">link</a>');
    markupOverrides.set('p-0', '<p>keep this</p>');
    element.set('markupOverrides', markupOverrides);

    const linkOverrides = new Y.Map<unknown>();
    const linkSelectorAttrs = new Y.Map<unknown>();
    linkSelectorAttrs.set('href', 'https://example.com');
    linkOverrides.set('a-0', linkSelectorAttrs);
    element.set('linkOverrides', linkOverrides);

    const hrefOverrides = new Y.Map<unknown>();
    const hrefSelectorAttrs = new Y.Map<unknown>();
    hrefSelectorAttrs.set('href', 'https://example.com');
    hrefOverrides.set('a-0', hrefSelectorAttrs);
    element.set('hrefOverrides', hrefOverrides);

    const classOverrides = new Y.Map<unknown>();
    const classSelectorAttrs = new Y.Map<unknown>();
    classSelectorAttrs.set('text-blue-500', true);
    classOverrides.set('a-0', classSelectorAttrs);
    classOverrides.set('div-0', new Y.Map<unknown>());
    element.set('classOverrides', classOverrides);

    const unifiedOverrides = new Y.Map<unknown>();
    const unifiedSelectorAttrs = new Y.Map<unknown>();
    unifiedSelectorAttrs.set('href', 'https://example.com');
    unifiedOverrides.set('a-0', unifiedSelectorAttrs);
    element.set('unifiedOverrides', unifiedOverrides);

    // Unwrap with instance-child key (comp-1:a-0)
    applyCommand(doc, {
      type: 'UNWRAP_LINK',
      elementId: 'comp-1:a-0',
    });

    // Link selector a-0 should be cleaned from all override maps
    expect(markupOverrides.has('a-0')).toBe(false);
    expect(linkOverrides.has('a-0')).toBe(false);
    expect(hrefOverrides.has('a-0')).toBe(false);
    expect(classOverrides.has('a-0')).toBe(false);
    expect(unifiedOverrides.has('a-0')).toBe(false);

    // Non-link overrides should be preserved
    expect(markupOverrides.has('p-0')).toBe(true);
    expect(classOverrides.has('div-0')).toBe(true);
  });
});

// =====================================================
// cleanOrphanedLinkOverrides
// =====================================================
describe('cleanOrphanedLinkOverrides', () => {
  it('should clean orphaned link selectors from all 5 override maps', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'comp-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        classes: makeClasses({}),
      },
    });

    const element = elements.get('comp-1') as Y.Map<unknown>;

    // Set up overrides for two link selectors: a-0 (will be removed) and a-1 (will remain)
    const classOverrides = new Y.Map<unknown>();
    classOverrides.set('a-0', new Y.Map<unknown>());
    classOverrides.set('a-1', new Y.Map<unknown>());
    classOverrides.set('div-0', new Y.Map<unknown>());
    element.set('classOverrides', classOverrides);

    const markupOverrides = new Y.Map<string>();
    markupOverrides.set('a-0', '<a>removed link</a>');
    markupOverrides.set('p-0', '<p>keep</p>');
    element.set('markupOverrides', markupOverrides);

    const linkOverrides = new Y.Map<unknown>();
    linkOverrides.set('a-0', new Y.Map<unknown>());
    linkOverrides.set('a-1', new Y.Map<unknown>());
    element.set('linkOverrides', linkOverrides);

    const hrefOverrides = new Y.Map<unknown>();
    hrefOverrides.set('a-0', new Y.Map<unknown>());
    element.set('hrefOverrides', hrefOverrides);

    const unifiedOverrides = new Y.Map<unknown>();
    unifiedOverrides.set('a-0', new Y.Map<unknown>());
    unifiedOverrides.set('a-1', new Y.Map<unknown>());
    element.set('unifiedOverrides', unifiedOverrides);

    // Only a-1 remains in the markup
    const validSelectors = new Set(['a-1']);
    cleanOrphanedLinkOverrides(element, validSelectors);

    // a-0 should be cleaned from all maps
    expect(classOverrides.has('a-0')).toBe(false);
    expect(markupOverrides.has('a-0')).toBe(false);
    expect(linkOverrides.has('a-0')).toBe(false);
    expect(hrefOverrides.has('a-0')).toBe(false);
    expect(unifiedOverrides.has('a-0')).toBe(false);

    // a-1 should be preserved (still in markup)
    expect(classOverrides.has('a-1')).toBe(true);
    expect(linkOverrides.has('a-1')).toBe(true);
    expect(unifiedOverrides.has('a-1')).toBe(true);

    // Non-link selectors should be preserved
    expect(classOverrides.has('div-0')).toBe(true);
    expect(markupOverrides.has('p-0')).toBe(true);
  });

  it('should handle missing override maps gracefully', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'comp-2',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'component',
        classes: makeClasses({}),
      },
    });

    const element = elements.get('comp-2') as Y.Map<unknown>;

    // Element has no override maps at all — should not throw
    expect(() => cleanOrphanedLinkOverrides(element, new Set())).not.toThrow();
  });
});

// =====================================================
// UPDATE_STATIC_MARKUP Command
// =====================================================
describe('UPDATE_STATIC_MARKUP', () => {
  it('should update static markup and clear overrides', () => {
    const { doc, getElement } = setupDocWithElement(makeClasses({}), {
      staticMarkup: '<div>Original</div>',
    });

    // Add some overrides
    applyCommand(doc, {
      type: 'UPDATE_MARKUP_OVERRIDE',
      instanceId: 'elem-1',
      selector: 'p-0',
      markup: '<p>Override</p>',
    });

    // Update static markup
    applyCommand(doc, {
      type: 'UPDATE_STATIC_MARKUP',
      elementId: 'elem-1',
      staticMarkup: '<div>Updated</div>',
    });

    expect(getElement().get('staticMarkup')).toBe('<div data-key="elem-1:div-0">Updated</div>');
    expect(getElement().has('markupOverrides')).toBe(false);
  });

  it('should clean up sourceText entries matching the element id', () => {
    const { doc } = setupDocWithElement(makeClasses({}), {
      staticMarkup: '<div><h1>Title</h1><p>Body</p></div>',
    });
    const sourceText = doc.getMap('sourceText');

    // Create sourceText entries for elem-1 children
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-1:h1-0',
      textContent: 'Edited Title',
    });
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-1:p-0',
      textContent: 'Edited Body',
    });

    // Create sourceText entry for a different element (should survive)
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_TEXT',
      sourceKey: 'elem-2:h1-0',
      textContent: 'Other element text',
    });

    // Verify entries exist
    expect(sourceText.has('elem-1:h1-0')).toBe(true);
    expect(sourceText.has('elem-1:p-0')).toBe(true);
    expect(sourceText.has('elem-2:h1-0')).toBe(true);

    // Reset via UPDATE_STATIC_MARKUP
    applyCommand(doc, {
      type: 'UPDATE_STATIC_MARKUP',
      elementId: 'elem-1',
      staticMarkup: '<div><h1>Fresh</h1><p>Fresh</p></div>',
    });

    // elem-1 sourceText entries should be deleted
    expect(sourceText.has('elem-1:h1-0')).toBe(false);
    expect(sourceText.has('elem-1:p-0')).toBe(false);

    // Other element's sourceText should be preserved
    expect(sourceText.has('elem-2:h1-0')).toBe(true);
  });

  it('should clean up sourceClasses entries matching the element id', () => {
    const { doc } = setupDocWithElement(makeClasses({}), {
      staticMarkup: '<div><h1>Title</h1><p>Body</p></div>',
    });
    const sourceClasses = doc.getMap('sourceClasses');

    // Register sourceClasses entries for elem-1 children
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-1:h1-0',
      classes: 'text-2xl font-bold',
    });
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-1:p-0',
      classes: 'text-base',
    });

    // Register sourceClasses entry for a different element (should survive)
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: 'elem-2:h1-0',
      classes: 'text-lg',
    });

    // Verify entries exist
    expect(sourceClasses.has('elem-1:h1-0')).toBe(true);
    expect(sourceClasses.has('elem-1:p-0')).toBe(true);
    expect(sourceClasses.has('elem-2:h1-0')).toBe(true);

    // Reset via UPDATE_STATIC_MARKUP
    applyCommand(doc, {
      type: 'UPDATE_STATIC_MARKUP',
      elementId: 'elem-1',
      staticMarkup: '<div><h1>Fresh</h1><p>Fresh</p></div>',
    });

    // elem-1 sourceClasses entries should be deleted
    expect(sourceClasses.has('elem-1:h1-0')).toBe(false);
    expect(sourceClasses.has('elem-1:p-0')).toBe(false);

    // Other element's sourceClasses should be preserved
    expect(sourceClasses.has('elem-2:h1-0')).toBe(true);
  });
});

// =====================================================
// UPDATE_INSTANCE_OVERRIDE Command
// =====================================================
describe('UPDATE_INSTANCE_OVERRIDE', () => {
  it('should store text override', () => {
    const { doc, getElement } = setupDocWithElement();

    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'elem-1',
      childId: 'p-0',
      updates: { text: 'New text content' },
    });

    const overrides = getElement().get('overrides') as Y.Map<Y.Map<unknown>>;
    const childOverride = overrides?.get('p-0') as Y.Map<unknown>;
    expect(childOverride?.get('text')).toBe('New text content');
  });

  it('should store classes override', () => {
    const { doc, getElement } = setupDocWithElement();

    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'elem-1',
      childId: 'div-0',
      updates: { classes: 'text-lg font-bold' },
    });

    const overrides = getElement().get('overrides') as Y.Map<Y.Map<unknown>>;
    const childOverride = overrides?.get('div-0') as Y.Map<unknown>;
    expect(childOverride?.get('classes')).toBe('text-lg font-bold');
  });

  it('should store markup override', () => {
    const { doc, getElement } = setupDocWithElement();

    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'elem-1',
      childId: 'span-0',
      updates: { markup: '<em>Emphasized</em>' },
    });

    const overrides = getElement().get('overrides') as Y.Map<Y.Map<unknown>>;
    const childOverride = overrides?.get('span-0') as Y.Map<unknown>;
    expect(childOverride?.get('markup')).toBe('<em>Emphasized</em>');
  });

  it('should store multiple overrides at once', () => {
    const { doc, getElement } = setupDocWithElement();

    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'elem-1',
      childId: 'a-0',
      updates: {
        text: 'Link text',
        classes: 'text-blue-500',
      },
    });

    const overrides = getElement().get('overrides') as Y.Map<Y.Map<unknown>>;
    const childOverride = overrides?.get('a-0') as Y.Map<unknown>;
    expect(childOverride?.get('text')).toBe('Link text');
    expect(childOverride?.get('classes')).toBe('text-blue-500');
  });

  it('should update existing override', () => {
    const { doc, getElement } = setupDocWithElement();

    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'elem-1',
      childId: 'p-0',
      updates: { text: 'First' },
    });

    applyCommand(doc, {
      type: 'UPDATE_INSTANCE_OVERRIDE',
      instanceId: 'elem-1',
      childId: 'p-0',
      updates: { text: 'Second' },
    });

    const overrides = getElement().get('overrides') as Y.Map<Y.Map<unknown>>;
    const childOverride = overrides?.get('p-0') as Y.Map<unknown>;
    expect(childOverride?.get('text')).toBe('Second');
  });
});

// =====================================================
// Page Component Commands
// =====================================================
describe('Page Component Management', () => {
  it('should add root element to page', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'root-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toContain('root-1');
  });

  it('should add nested element without adding to rootElementIds', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    // Add parent first
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'parent-1',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    // Add child
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'child-1',
        pageId: 'page-1',
        parentId: 'parent-1',
        index: 0,
        type: 'frame',
        classes: makeClasses({}),
      },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toContain('parent-1');
    expect(rootIds.toArray()).not.toContain('child-1');
  });
});

// =====================================================
// Empty/Invalid Input Handling
// =====================================================
describe('Empty and Invalid Input Handling', () => {
  it('should do nothing for non-existent page', () => {
    const doc = setupDoc();

    // Should not throw
    applyCommand(doc, {
      type: 'RENAME_PAGE',
      pageId: 'non-existent',
      name: 'Test',
    });
  });
});

describe('REPARENT_ELEMENT', () => {
  it('should move root element to become child of another element', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    // Add two root elements
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-2', pageId: 'page-1', parentId: null, index: 1, type: 'frame', classes: makeClasses({}) },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toEqual(['elem-1', 'elem-2']);

    // Reparent elem-1 to become child of elem-2's container
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'elem-1',
      newParentKey: 'elem-2',
      insertIndex: 0,
    });

    // elem-1 removed from root
    expect(rootIds.toArray()).toEqual(['elem-2']);
    // elem-1 added to childOrders under elem-2
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    expect(childOrders.get('elem-2')?.toArray()).toEqual(['elem-1']);
  });

  it('should move child element to become root', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    // Add root element
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });

    // Add elem-2 as child of elem-1 via SET_CHILD_ORDER
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'elem-1',
      childKeys: ['elem-2-key'],
    });

    // Reparent child to root
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'elem-2-key',
      newParentKey: null,
      insertIndex: 0,
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    // elem-2-key becomes root at index 0 (before elem-1)
    expect(rootIds.toArray()).toEqual(['elem-2-key', 'elem-1']);
    // childOrders for elem-1 should be cleaned up (was the only child)
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    expect(childOrders.get('elem-1')).toBeUndefined();
  });

  it('should move child from one parent to another parent', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    // Setup: two root elements, each with children
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'parent-a', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'parent-b', pageId: 'page-1', parentId: null, index: 1, type: 'frame', classes: makeClasses({}) },
    });
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'parent-a',
      childKeys: ['child-1', 'child-2'],
    });

    // Move child-1 from parent-a to parent-b at index 0
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'child-1',
      newParentKey: 'parent-b',
      insertIndex: 0,
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    // child-1 removed from parent-a
    expect(childOrders.get('parent-a')?.toArray()).toEqual(['child-2']);
    // child-1 added to parent-b
    expect(childOrders.get('parent-b')?.toArray()).toEqual(['child-1']);
  });

  it('should allow instance-child reparenting', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    const beforeCount = rootIds.length;

    // Instance-child keys are allowed to reparent
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'el-abc123:h1-0',
      newParentKey: null,
      insertIndex: 0,
    });

    // Should insert into rootElementIds
    expect(rootIds.length).toBe(beforeCount + 1);
    expect(rootIds.get(0)).toBe('el-abc123:h1-0');
  });

  it('should clamp insertIndex to array bounds', () => {
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'elem-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });

    // Reparent with insertIndex far beyond bounds
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'elem-1',
      newParentKey: 'some-parent',
      insertIndex: 999,
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    expect(rootIds.toArray()).toEqual([]); // removed from root
    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    expect(childOrders.get('some-parent')?.toArray()).toEqual(['elem-1']); // clamped to 0
  });

  it('should handle non-existent page gracefully', () => {
    const doc = setupDoc();
    // Should not throw
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'nonexistent',
      elementKey: 'elem-1',
      newParentKey: null,
      insertIndex: 0,
    });
  });

  it('should properly remove child when child order is persisted before reparent', () => {
    // This tests the pattern used by the UI: persist current child order via SET_CHILD_ORDER
    // before calling REPARENT_ELEMENT, so the handler can find and remove the element.
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    // Setup: section as root with instance-child keys (as DOM children)
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'section-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });

    // Simulate UI persisting child order (what the fix does before takeSnapshot)
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'section-1',
      childKeys: ['section-1:h1-0', 'section-1:p-0', 'section-1:img-0'],
    });

    // Now reparent the h1 to become root
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'section-1:h1-0',
      newParentKey: null,
      insertIndex: 0,
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const rootIds = page.get('rootElementIds') as Y.Array<string>;
    // h1 added to root, section still there
    expect(rootIds.toArray()).toEqual(['section-1:h1-0', 'section-1']);

    const childOrders = page.get('childOrders') as Y.Map<Y.Array<string>>;
    // h1 removed from section's child order
    expect(childOrders.get('section-1')?.toArray()).toEqual(['section-1:p-0', 'section-1:img-0']);
  });

  it('should change childOrders so renderState key differs after reparent (enabling undo)', () => {
    // Verifies that after SET_CHILD_ORDER + REPARENT_ELEMENT, the childOrders map changes.
    // This is critical for undo: the renderState key must differ so RENDER fires on undo.
    const doc = setupDoc();
    const pages = doc.getMap('pages');

    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'parent-1', pageId: 'page-1', parentId: null, index: 0, type: 'frame', classes: makeClasses({}) },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'parent-2', pageId: 'page-1', parentId: null, index: 1, type: 'frame', classes: makeClasses({}) },
    });

    // Persist child order
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'parent-1',
      childKeys: ['child-a', 'child-b'],
    });

    const page = pages.get('page-1') as Y.Map<unknown>;
    const childOrdersBefore = (page.get('childOrders') as Y.Map<Y.Array<string>>);
    const parent1Before = childOrdersBefore.get('parent-1')?.toArray();
    expect(parent1Before).toEqual(['child-a', 'child-b']);

    // Reparent child-a to parent-2
    applyCommand(doc, {
      type: 'REPARENT_ELEMENT',
      pageId: 'page-1',
      elementKey: 'child-a',
      newParentKey: 'parent-2',
      insertIndex: 0,
    });

    const childOrdersAfter = (page.get('childOrders') as Y.Map<Y.Array<string>>);
    // parent-1 lost child-a
    expect(childOrdersAfter.get('parent-1')?.toArray()).toEqual(['child-b']);
    // parent-2 gained child-a
    expect(childOrdersAfter.get('parent-2')?.toArray()).toEqual(['child-a']);
  });
});

// =====================================================
// CLEAR_DRAWN_SLOT_FILL Command
// =====================================================

/** Add a filled drawn slot directly to the elements map (the keyboard
 *  flow that produces this state — drawing a slot then picking a
 *  component — runs through code outside applyCommand). */
function addFilledDrawnSlot(doc: Y.Doc, key: string, componentName = 'CTA'): Y.Map<unknown> {
  const elements = doc.getMap('elements');
  const slot = new Y.Map<unknown>();
  slot.set('id', key);
  slot.set('pageId', 'page-1');
  slot.set('parentId', null);
  slot.set('index', 0);
  slot.set('type', 'frame');
  slot.set('isDrawn', true);
  slot.set('slotType', 'slot');
  slot.set('slotComponentMarkup', '<section><h1>Hi</h1></section>');
  slot.set('slotComponentName', componentName);
  slot.set('slotComponentPath', `src/components/${componentName}.astro`);
  slot.set('classes', new Y.Map());
  elements.set(key, slot);
  return slot;
}

describe('CLEAR_DRAWN_SLOT_FILL', () => {
  it('clears all slot fill fields', () => {
    const doc = setupDoc();
    const slot = addFilledDrawnSlot(doc, 'drawn-1');

    applyCommand(doc, { type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: 'drawn-1' });

    expect(slot.get('slotComponentMarkup')).toBeUndefined();
    expect(slot.get('slotComponentId')).toBeUndefined();
    expect(slot.get('slotComponentName')).toBeUndefined();
    expect(slot.get('slotComponentPath')).toBeUndefined();
    // Slot itself stays — only the fill is cleared.
    expect(doc.getMap('elements').has('drawn-1')).toBe(true);
    expect(slot.get('isDrawn')).toBe(true);
    expect(slot.get('slotType')).toBe('slot');
  });

  it('clears overrides accumulated against the now-removed inner markup', () => {
    const doc = setupDoc();
    const slot = addFilledDrawnSlot(doc, 'drawn-1');
    for (const f of OVERRIDE_FIELDS) {
      slot.set(f, f === 'deletedSelectors' || f === 'orderOverrides' ? new Y.Array() : new Y.Map());
    }

    applyCommand(doc, { type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: 'drawn-1' });

    for (const f of OVERRIDE_FIELDS) {
      expect(slot.get(f)).toBeUndefined();
    }
  });



  it('returns false on unknown slot key', () => {
    const doc = setupDoc();
    const result = applyCommand(doc, { type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: 'drawn-missing' });
    expect(result).toBe(false);
  });

  it('returns false on a non-drawn element', () => {
    const { doc } = setupDocWithElement();
    const result = applyCommand(doc, { type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: 'elem-1' });
    expect(result).toBe(false);
  });

  it('returns false on a drawn element that is not a slot', () => {
    const doc = setupDoc();
    const elements = doc.getMap('elements');
    const drawn = new Y.Map<unknown>();
    drawn.set('id', 'drawn-1');
    drawn.set('pageId', 'page-1');
    drawn.set('isDrawn', true);
    // No slotType set
    elements.set('drawn-1', drawn);

    const result = applyCommand(doc, { type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: 'drawn-1' });
    expect(result).toBe(false);
  });
});
