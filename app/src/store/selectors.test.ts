// selectors.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { selectAllPages, selectRootPageIds, selectPage, selectResolvedStaticMarkup, selectPageComponents, selectRenderState, selectLinkAttributes, selectImageAttributes, applyAllOverrides } from './selectors';
import { applyCommand } from './commands';
import { createEditorDoc } from './createEditorDoc';
import { emptyClassData } from './types';

describe('page selectors', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = createEditorDoc();
    // Add test pages
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: ['page-1a'] }
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1a', name: 'About', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-2', name: 'Contact', rootElementIds: [], children: [] }
    });
    // ADD_PAGE self-registers roots: page-1/page-2 land in rootPages,
    // page-1a is claimed as page-1's child so it stays out.
  });

  it('selectAllPages returns all pages', () => {
    const pages = selectAllPages(doc);
    expect(pages).toHaveLength(3);
    expect(pages.map(p => p.id).sort()).toEqual(['page-1', 'page-1a', 'page-2']);
  });

  it('selectRootPageIds returns root page IDs in order', () => {
    const rootIds = selectRootPageIds(doc);
    expect(rootIds).toEqual(['page-1', 'page-2']);
  });

  it('selectPage returns child page IDs that resolve via selectPage', () => {
    const page = selectPage(doc, 'page-1');
    expect(page).not.toBeNull();
    expect(page!.children).toEqual(['page-1a']);
    const child = selectPage(doc, page!.children[0]);
    expect(child).not.toBeNull();
    expect(child!.id).toBe('page-1a');
  });

  it('selectPage returns empty children for leaf page', () => {
    const page = selectPage(doc, 'page-2');
    expect(page).not.toBeNull();
    expect(page!.children).toHaveLength(0);
  });

  it('selectPage returns null for non-existent page', () => {
    const page = selectPage(doc, 'non-existent');
    expect(page).toBeNull();
  });
});

describe('deletion overrides in rendering', () => {
  it('selectResolvedStaticMarkup should strip deleted elements', () => {
    const doc = createEditorDoc();

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section><h1>Title</h1><p>Description</p></section>',
      }
    });

    // Delete h1-0
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-hero', selector: 'h1-0' });

    const result = selectResolvedStaticMarkup(doc, 'el-hero');
    expect(result).not.toContain('<h1');
    expect(result).toContain('<p');
    expect(result).toContain('Description');
  });

  it('selectPageComponents should strip deleted elements', () => {
    const doc = createEditorDoc();

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section><h1>Title</h1><img src="test.jpg" /><p>Text</p></section>',
      }
    });

    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-hero', selector: 'img-0' });

    const components = selectPageComponents(doc, 'page-1');
    expect(components).toHaveLength(1);
    expect(components[0].staticMarkup).not.toContain('<img');
    expect(components[0].staticMarkup).toContain('<h1');
  });

  it('should handle self-closing tags in deletion', () => {
    const doc = createEditorDoc();

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-card',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Card.astro',
        classes: emptyClassData(),
        staticMarkup: '<div><img src="photo.jpg" /><h2>Card</h2></div>',
      }
    });

    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-card', selector: 'img-0' });

    const result = selectResolvedStaticMarkup(doc, 'el-card');
    expect(result).not.toContain('<img');
    expect(result).toContain('<h2');
  });
});

describe('order overrides in rendering', () => {
  it('selectResolvedStaticMarkup should reorder elements', () => {
    const doc = createEditorDoc();

    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] }
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section data-key="el-hero:section-0"><h1 data-key="el-hero:h1-0">Title</h1><p data-key="el-hero:p-0">Text</p></section>',
      }
    });

    // Render-domain order lives in renderOrderOverrides: Y.Map<parentSelector, Y.Array<childSelector>>
    const instance = doc.getMap('elements').get('el-hero') as Y.Map<unknown>;
    const yRoo = new Y.Map<unknown>();
    instance.set('renderOrderOverrides', yRoo);
    const order = new Y.Array<string>();
    order.insert(0, ['p-0', 'h1-0']);
    yRoo.set('section-0', order);

    const result = selectResolvedStaticMarkup(doc, 'el-hero');
    // p should come before h1 now
    const pIndex = result!.indexOf('<p');
    const h1Index = result!.indexOf('<h1');
    expect(pIndex).toBeLessThan(h1Index);
  });
});

describe('applyRenderOrder (renderOrderOverrides)', () => {
  const NESTED_MARKUP =
    '<section data-key="i:section-0" class="grid">' +
      '<div data-key="i:div-0" class="content">' +
        '<div data-key="i:div-1" class="label"><span data-key="i:span-0">L</span></div>' +
        '<h2 data-key="i:h2-0">H</h2>' +
        '<p data-key="i:p-0">P</p>' +
        '<div data-key="i:div-2" class="buttons"><button data-key="i:button-0">A</button></div>' +
      '</div>' +
      '<div data-key="i:div-3" class="image"><img data-key="i:img-0" src="x"></div>' +
    '</section>';

  function makeEl(doc: Y.Doc, renderOrder: Record<string, string[]>) {
    const yEl = new Y.Map<unknown>();
    doc.getMap('elements').set('i', yEl);
    yEl.set('staticMarkup', NESTED_MARKUP);
    const yRoo = new Y.Map<unknown>();
    yEl.set('renderOrderOverrides', yRoo);
    for (const [parentSel, sels] of Object.entries(renderOrder)) {
      const arr = new Y.Array<string>();
      arr.insert(0, sels);
      yRoo.set(parentSel, arr);
    }
    return yEl;
  }

  function parentKeyOf(html: string, sel: string): string | null {
    const dom = new DOMParser().parseFromString(html, 'text/html');
    return dom.querySelector(`[data-key$=":${sel}"]`)?.parentElement?.getAttribute('data-key') ?? null;
  }

  it('keeps markup balanced and parentage intact with nested same-tag children (Feature2 corruption regression)', () => {
    const doc = new Y.Doc();
    makeEl(doc, { 'section-0': ['div-0', 'div-3'] });
    const result = selectResolvedStaticMarkup(doc, 'i')!;
    expect((result.match(/<div/g) || []).length).toBe((result.match(/<\/div>/g) || []).length);
    expect(parentKeyOf(result, 'div-3')).toBe('i:section-0'); // NOT nested into div-0
    expect(parentKeyOf(result, 'div-2')).toBe('i:div-0');     // buttons stay inside content
  });

  it('reorders direct children per the listed order', () => {
    const doc = new Y.Doc();
    makeEl(doc, { 'section-0': ['div-3', 'div-0'] });
    const result = selectResolvedStaticMarkup(doc, 'i')!;
    expect(result.indexOf('i:div-3')).toBeLessThan(result.indexOf('i:div-0'));
    expect(parentKeyOf(result, 'div-3')).toBe('i:section-0');
  });

  it('reorders inside a nested parent', () => {
    const doc = new Y.Doc();
    makeEl(doc, { 'div-0': ['p-0', 'h2-0'] });
    const result = selectResolvedStaticMarkup(doc, 'i')!;
    expect(result.indexOf('i:p-0')).toBeLessThan(result.indexOf('i:h2-0'));
    expect(parentKeyOf(result, 'p-0')).toBe('i:div-0');
  });

  it('legacy orderOverrides no longer mutate resolved markup', () => {
    const doc = new Y.Doc();
    const yEl = makeEl(doc, {});
    const legacy = new Y.Array<string>();
    legacy.insert(0, ['div-0', 'div-1']); // the source-domain selectors that caused the corruption
    yEl.set('orderOverrides', legacy);
    expect(selectResolvedStaticMarkup(doc, 'i')).toBe(NESTED_MARKUP);
  });

  it('falls back to raw markup when an override corrupts parentage', () => {
    const doc = new Y.Doc();
    const yEl = makeEl(doc, {});
    // markupOverrides replaces div-0's content with markup that swallows div-3 (simulated corruption)
    const mo = new Y.Map<string>();
    yEl.set('markupOverrides', mo);
    mo.set('div-0', '<div data-key="i:div-0"><div data-key="i:div-3">stolen</div></div>');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(selectResolvedStaticMarkup(doc, 'i')).toBe(NESTED_MARKUP);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('selectRenderState', () => {
  it('returns combined render state with components, childOrders, and drawnElements', () => {
    const doc = createEditorDoc();

    // Create a page
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Home', rootElementIds: [], children: [] },
    });

    // Add two instance elements with staticMarkup
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-hero',
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        classes: emptyClassData(),
        staticMarkup: '<section><h1>Hello</h1></section>',
      },
    });
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: {
        id: 'el-feature',
        pageId: 'page-1',
        parentId: null,
        index: 1,
        type: 'instance',
        classes: emptyClassData(),
        staticMarkup: '<div><p>Feature</p></div>',
      },
    });

    // Add a drawn element
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: {
        key: 'drawn-1',
        tag: 'div',
        classes: 'text-red-500',
        textContent: 'Drawn',
        parentKey: null,
        insertIndex: 0,
        pageId: 'page-1',
      },
    });

    // Set child order
    applyCommand(doc, {
      type: 'SET_CHILD_ORDER',
      pageId: 'page-1',
      parentKey: 'el-hero:section-0',
      childKeys: ['el-hero:h1-0'],
    });

    const result = selectRenderState(doc, 'page-1');

    // Components should be in rootElementIds order with overrides applied
    expect(result.components).toHaveLength(2);
    expect(result.components[0].id).toBe('el-hero');
    expect(result.components[1].id).toBe('el-feature');

    // Child orders should be included
    expect(result.childOrders).toEqual({
      'el-hero:section-0': ['el-hero:h1-0'],
    });

    // Drawn elements should be included
    expect(result.drawnElements).toHaveLength(1);
    expect(result.drawnElements[0].key).toBe('drawn-1');
    // Root-level drawn div is auto-converted to section
    expect(result.drawnElements[0].tag).toBe('section');
  });

  it('returns empty state for non-existent page', () => {
    const doc = createEditorDoc();
    const result = selectRenderState(doc, 'nonexistent');

    expect(result.components).toEqual([]);
    expect(result.childOrders).toEqual({});
    expect(result.drawnElements).toEqual([]);
  });
});

describe('selectLinkAttributes', () => {
  function createDocWithInstance(instanceId = 'el-hero'): Y.Doc {
    const doc = createEditorDoc();
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Test', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: instanceId,
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup: '<section><h1>Title</h1><a href="https://example.com">Link</a><p>Text</p></section>',
      },
    });
    return doc;
  }

  it('returns null for invalid key', () => {
    const doc = createEditorDoc();
    expect(selectLinkAttributes(doc, '')).toBeNull();
    expect(selectLinkAttributes(doc, 'not-a-valid-key')).toBeNull();
  });

  it('returns null for non-existent element', () => {
    const doc = createEditorDoc();
    expect(selectLinkAttributes(doc, 'el-nonexistent')).toBeNull();
    expect(selectLinkAttributes(doc, 'el-nonexistent:a-0')).toBeNull();
  });

  // --- Instance root ---

  it('instance-root: returns null when no linkAttributes', () => {
    const doc = createDocWithInstance();
    expect(selectLinkAttributes(doc, 'el-hero')).toBeNull();
  });

  it('instance-root: returns linkAttributes from element', () => {
    const doc = createDocWithInstance();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero',
      attribute: 'href',
      value: 'https://root-link.com',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero',
      attribute: 'target',
      value: '_blank',
    });

    const result = selectLinkAttributes(doc, 'el-hero');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://root-link.com');
    expect(result!.target).toBe('_blank');
  });

  // --- Instance child: unifiedOverrides only ---

  it('instance-child: returns href from unifiedOverrides when no linkOverrides', () => {
    const doc = createDocWithInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    // Set up unifiedOverrides with href entry (mimics Override API setHref)
    const unifiedOverrides = new Y.Map<Y.Map<unknown>>();
    const selectorEntry = new Y.Map<unknown>();
    const hrefMap = new Y.Map<unknown>();
    hrefMap.set('href', 'https://unified.com');
    hrefMap.set('target', '_blank');
    selectorEntry.set('href', hrefMap);
    unifiedOverrides.set('a-0', selectorEntry);
    yElement.set('unifiedOverrides', unifiedOverrides);

    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://unified.com');
    expect(result!.target).toBe('_blank');
    expect(result!.ariaLabel).toBeUndefined();
  });

  // --- Instance child: linkOverrides only ---

  it('instance-child: returns href/target/ariaLabel from linkOverrides when no unifiedOverrides', () => {
    const doc = createDocWithInstance();

    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'href',
      value: 'https://link-override.com',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'target',
      value: '_self',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'ariaLabel',
      value: 'Click here',
    });

    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://link-override.com');
    expect(result!.target).toBe('_self');
    expect(result!.ariaLabel).toBe('Click here');
  });

  // --- Instance child: both sources, linkOverrides wins ---

  it('instance-child: linkOverrides href takes precedence over unifiedOverrides href', () => {
    const doc = createDocWithInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    // Set up unifiedOverrides with original href
    const unifiedOverrides = new Y.Map<Y.Map<unknown>>();
    const selectorEntry = new Y.Map<unknown>();
    const hrefMap = new Y.Map<unknown>();
    hrefMap.set('href', 'https://original.com');
    hrefMap.set('target', '_blank');
    selectorEntry.set('href', hrefMap);
    unifiedOverrides.set('a-0', selectorEntry);
    yElement.set('unifiedOverrides', unifiedOverrides);

    // Set linkOverrides with edited href (via UPDATE_LINK_ATTRIBUTE command)
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'href',
      value: 'https://edited.com',
    });

    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://edited.com');
    // target from unifiedOverrides still applies (linkOverrides doesn't override it)
    expect(result!.target).toBe('_blank');
  });

  it('instance-child: linkOverrides target takes precedence over unifiedOverrides target', () => {
    const doc = createDocWithInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    // Set up unifiedOverrides with target _blank
    const unifiedOverrides = new Y.Map<Y.Map<unknown>>();
    const selectorEntry = new Y.Map<unknown>();
    const hrefMap = new Y.Map<unknown>();
    hrefMap.set('href', 'https://example.com');
    hrefMap.set('target', '_blank');
    selectorEntry.set('href', hrefMap);
    unifiedOverrides.set('a-0', selectorEntry);
    yElement.set('unifiedOverrides', unifiedOverrides);

    // Override target via linkOverrides
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'target',
      value: '_self',
    });

    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://example.com');
    expect(result!.target).toBe('_self');
  });

  it('instance-child: returns null when no link data exists', () => {
    const doc = createDocWithInstance();
    // a-0 selector exists in markup but no overrides set
    expect(selectLinkAttributes(doc, 'el-hero:a-0')).toBeNull();
  });

  // --- Instance child: rel/title are NOT read back (pinned — LI-6, task-049) ---
  // applyLinkOverrides DOES apply rel/title to staticMarkup, but the
  // selector deliberately returns them as undefined for instance-children.
  it('instance-child: rel/title set in linkOverrides come back undefined (accepted asymmetry)', () => {
    const doc = createDocWithInstance();

    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'href',
      value: 'https://example.com',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'rel',
      value: 'nofollow noopener',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'title',
      value: 'A title',
    });

    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://example.com');
    expect(result!.rel).toBeUndefined();
    expect(result!.title).toBeUndefined();
  });

  it('instance-child: returns ariaLabel even when href comes from unifiedOverrides', () => {
    const doc = createDocWithInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    // unifiedOverrides has href
    const unifiedOverrides = new Y.Map<Y.Map<unknown>>();
    const selectorEntry = new Y.Map<unknown>();
    const hrefMap = new Y.Map<unknown>();
    hrefMap.set('href', 'https://example.com');
    selectorEntry.set('href', hrefMap);
    unifiedOverrides.set('a-0', selectorEntry);
    yElement.set('unifiedOverrides', unifiedOverrides);

    // linkOverrides only has ariaLabel
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'ariaLabel',
      value: 'Accessible label',
    });

    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://example.com');
    expect(result!.ariaLabel).toBe('Accessible label');
  });

  // --- Source type ---

  it('source: returns null when no sourceLinkAttributes', () => {
    const doc = createEditorDoc();
    expect(selectLinkAttributes(doc, 'src/Hero.astro:5:1')).toBeNull();
  });

  it('source: returns attributes from sourceLinkAttributes map', () => {
    const doc = createEditorDoc();
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'src/Hero.astro:5:1',
      attribute: 'href',
      value: 'https://source-link.com',
    });
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'src/Hero.astro:5:1',
      attribute: 'target',
      value: '_blank',
    });

    const result = selectLinkAttributes(doc, 'src/Hero.astro:5:1');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://source-link.com');
    expect(result!.target).toBe('_blank');
  });

  // --- Cross-selector isolation ---

  it('instance-child: different selectors are isolated', () => {
    const doc = createDocWithInstance();

    // Set link attributes on a-0
    applyCommand(doc, {
      type: 'UPDATE_LINK_ATTRIBUTE',
      elementId: 'el-hero:a-0',
      attribute: 'href',
      value: 'https://first-link.com',
    });

    // a-1 should not see a-0's attributes
    expect(selectLinkAttributes(doc, 'el-hero:a-1')).toBeNull();

    // a-0 should have its attributes
    const result = selectLinkAttributes(doc, 'el-hero:a-0');
    expect(result).not.toBeNull();
    expect(result!.href).toBe('https://first-link.com');
  });
});

describe('applyAllOverrides - image overrides', () => {
  it('should apply imageAttributes to root <img> element', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    yEl.set('staticMarkup', '<img src="old.jpg" alt="old" />');
    const imageAttrs = new Y.Map();
    imageAttrs.set('src', 'new.jpg');
    imageAttrs.set('alt', 'new alt text');
    yEl.set('imageAttributes', imageAttrs);
    elements.set('el-img', yEl);

    const result = applyAllOverrides('<img src="old.jpg" alt="old" />', yEl);
    expect(result).toContain('src="new.jpg"');
    expect(result).toContain('alt="new alt text"');
    expect(result).not.toContain('old.jpg');
  });

  it('should apply imageOverrides to child <img> elements', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    const markup = '<div><img src="first.jpg" alt="first" /><img src="second.jpg" alt="second" /></div>';
    yEl.set('staticMarkup', markup);
    const imgOverrides = new Y.Map();
    const img1Attrs = new Y.Map();
    img1Attrs.set('src', 'replaced-second.jpg');
    img1Attrs.set('alt', 'replaced alt');
    imgOverrides.set('img-1', img1Attrs);
    yEl.set('imageOverrides', imgOverrides);
    elements.set('el-card', yEl);

    const result = applyAllOverrides(markup, yEl);
    expect(result).toContain('src="first.jpg"');
    expect(result).toContain('src="replaced-second.jpg"');
    expect(result).toContain('alt="replaced alt"');
    expect(result).not.toContain('alt="second"');
  });

  it('should add loading attribute when not present in original', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    const markup = '<img src="photo.jpg" />';
    yEl.set('staticMarkup', markup);
    const imageAttrs = new Y.Map();
    imageAttrs.set('loading', 'lazy');
    yEl.set('imageAttributes', imageAttrs);
    elements.set('el-img', yEl);

    const result = applyAllOverrides(markup, yEl);
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('src="photo.jpg"');
  });

  it('should not apply imageAttributes when root is not <img>', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    const markup = '<div><img src="child.jpg" /></div>';
    yEl.set('staticMarkup', markup);
    const imageAttrs = new Y.Map();
    imageAttrs.set('src', 'should-not-apply.jpg');
    yEl.set('imageAttributes', imageAttrs);
    elements.set('el-div', yEl);

    const result = applyAllOverrides(markup, yEl);
    expect(result).toContain('src="child.jpg"');
    expect(result).not.toContain('should-not-apply.jpg');
  });

  it('should return markup unchanged when no image overrides exist', () => {
    const doc = createEditorDoc();
    const yEl = new Y.Map();
    const markup = '<div><img src="photo.jpg" alt="test" /></div>';

    const result = applyAllOverrides(markup, yEl);
    expect(result).toBe(markup);
  });

  it('should apply image overrides correctly after deletion removes earlier img', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    // Markup has two imgs: img-0 (inside p-0) and img-1
    const markup = '<div><p><img src="first.jpg" alt="first" /></p><img src="second.jpg" alt="second" /></div>';
    yEl.set('staticMarkup', markup);

    // Override img-1 (originally the second img)
    const imgOverrides = new Y.Map();
    const img1Attrs = new Y.Map();
    img1Attrs.set('src', 'uploaded.jpg');
    img1Attrs.set('alt', 'uploaded');
    imgOverrides.set('img-1', img1Attrs);
    yEl.set('imageOverrides', imgOverrides);

    // Attach to doc so Y.Array operations work
    elements.set('el-test', yEl);

    // Delete p-0 (which contains img-0) — must happen after doc integration
    doc.transact(() => {
      const deleted = yEl.get('deletedSelectors') as Y.Array<string> | undefined
        ?? new Y.Array<string>();
      if (!yEl.has('deletedSelectors')) yEl.set('deletedSelectors', deleted);
      deleted.push(['p-0']);
    });

    const result = applyAllOverrides(markup, yEl);
    // After deletion of p-0, only img-1 remains (now at position 0 in DOM).
    // Image override for img-1 should still apply to it via original index tracking.
    expect(result).toContain('src="uploaded.jpg"');
    expect(result).toContain('alt="uploaded"');
    expect(result).not.toContain('first.jpg');
  });

  it('should apply image overrides correctly after reorder moves img positions', () => {
    const doc = createEditorDoc();
    const elements = doc.getMap('elements');
    const yEl = new Y.Map();
    // Two direct children, each with an img
    const markup = '<div><p><img src="first.jpg" /></p><span><img src="second.jpg" /></span></div>';
    yEl.set('staticMarkup', markup);

    // Override img-1 (originally the second img, inside span)
    const imgOverrides = new Y.Map();
    const img1Attrs = new Y.Map();
    img1Attrs.set('src', 'replaced.jpg');
    imgOverrides.set('img-1', img1Attrs);
    yEl.set('imageOverrides', imgOverrides);

    // Attach to doc so Y.Array operations work
    elements.set('el-test', yEl);

    // Reorder: swap span-0 before p-0 — must happen after doc integration
    doc.transact(() => {
      const order = yEl.get('orderOverrides') as Y.Array<string> | undefined
        ?? new Y.Array<string>();
      if (!yEl.has('orderOverrides')) yEl.set('orderOverrides', order);
      order.push(['span-0', 'p-0']);
    });

    const result = applyAllOverrides(markup, yEl);
    // After reorder, span (with img-1) is now first in DOM.
    // Image override for img-1 should apply to the correct img regardless of new position.
    expect(result).toContain('src="replaced.jpg"');
    expect(result).toContain('src="first.jpg"');
  });
});

// ============================================================================
// selectImageAttributes
// ============================================================================

describe('selectImageAttributes', () => {
  function createDocWithImgInstance(instanceId = 'el-hero', staticMarkup = '<img src="hero.jpg" alt="Hero image" loading="lazy" />'): Y.Doc {
    const doc = createEditorDoc();
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Test', rootElementIds: [], children: [] },
    });
    applyCommand(doc, {
      type: 'ADD_THEME_INSTANCE',
      element: {
        id: instanceId,
        pageId: 'page-1',
        parentId: null,
        index: 0,
        type: 'instance',
        instanceType: 'theme',
        themeId: 'theme-1',
        componentPath: 'src/Hero.astro',
        classes: emptyClassData(),
        staticMarkup,
      },
    });
    return doc;
  }

  // --- Invalid / missing keys ---

  it('returns null for empty key', () => {
    const doc = createEditorDoc();
    expect(selectImageAttributes(doc, '')).toBeNull();
  });

  it('returns null for invalid key format', () => {
    const doc = createEditorDoc();
    expect(selectImageAttributes(doc, 'not-a-valid-key')).toBeNull();
  });

  it('returns null for non-existent instance-root element', () => {
    const doc = createEditorDoc();
    expect(selectImageAttributes(doc, 'el-nonexistent')).toBeNull();
  });

  it('returns null for non-existent instance-child element', () => {
    const doc = createEditorDoc();
    expect(selectImageAttributes(doc, 'el-nonexistent:img-0')).toBeNull();
  });

  // --- Instance root: imageAttributes from Yjs ---

  it('instance-root: returns imageAttributes from element when set', () => {
    const doc = createDocWithImgInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    const imageAttrs = new Y.Map();
    imageAttrs.set('src', 'uploaded.webp');
    imageAttrs.set('alt', 'Uploaded image');
    imageAttrs.set('loading', 'eager');
    yElement.set('imageAttributes', imageAttrs);

    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('uploaded.webp');
    expect(result!.alt).toBe('Uploaded image');
    expect(result!.loading).toBe('eager');
  });

  it('instance-root: imageAttributes takes priority over staticMarkup', () => {
    const doc = createDocWithImgInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    // staticMarkup has hero.jpg, but imageAttributes overrides to uploaded.webp
    const imageAttrs = new Y.Map();
    imageAttrs.set('src', 'uploaded.webp');
    yElement.set('imageAttributes', imageAttrs);

    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('uploaded.webp');
  });

  it('instance-root: empty imageAttributes map falls through to staticMarkup', () => {
    const doc = createDocWithImgInstance();
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    // Set empty imageAttributes — size === 0
    const imageAttrs = new Y.Map();
    yElement.set('imageAttributes', imageAttrs);

    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('hero.jpg');
    expect(result!.alt).toBe('Hero image');
    expect(result!.loading).toBe('lazy');
  });

  // --- Instance root: fallback to staticMarkup ---

  it('instance-root: falls back to staticMarkup when no imageAttributes', () => {
    const doc = createDocWithImgInstance();

    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('hero.jpg');
    expect(result!.alt).toBe('Hero image');
    expect(result!.loading).toBe('lazy');
  });

  it('instance-root: returns null when staticMarkup root is not <img>', () => {
    const doc = createDocWithImgInstance('el-hero', '<div><img src="nested.jpg" /></div>');

    // Root is <div>, not <img> — should return null for instance-root
    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).toBeNull();
  });

  it('instance-root: returns null when no staticMarkup and no imageAttributes', () => {
    const doc = createDocWithImgInstance('el-hero', '');

    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).toBeNull();
  });

  it('instance-root: handles img with only src attribute', () => {
    const doc = createDocWithImgInstance('el-hero', '<img src="minimal.jpg" />');

    const result = selectImageAttributes(doc, 'el-hero');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('minimal.jpg');
    expect(result!.alt).toBeUndefined();
    expect(result!.loading).toBeUndefined();
  });

  // --- Instance child: imageOverrides from Yjs ---

  it('instance-child: returns imageOverrides for selector', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><img src="child.jpg" alt="Child" /><img src="second.jpg" /></section>');
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    const imageOverrides = new Y.Map();
    const selectorAttrs = new Y.Map();
    selectorAttrs.set('src', 'overridden.png');
    selectorAttrs.set('alt', 'Overridden');
    imageOverrides.set('img-0', selectorAttrs);
    yElement.set('imageOverrides', imageOverrides);

    const result = selectImageAttributes(doc, 'el-hero:img-0');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('overridden.png');
    expect(result!.alt).toBe('Overridden');
  });

  it('instance-child: empty imageOverrides entry falls through to staticMarkup', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><img src="child.jpg" alt="Child" /></section>');
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    const imageOverrides = new Y.Map();
    const emptyAttrs = new Y.Map();
    imageOverrides.set('img-0', emptyAttrs);
    yElement.set('imageOverrides', imageOverrides);

    const result = selectImageAttributes(doc, 'el-hero:img-0');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('child.jpg');
    expect(result!.alt).toBe('Child');
  });

  it('instance-child: returns null for non-img selector', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><h1>Title</h1><img src="child.jpg" /></section>');

    // h1-0 is not an img selector — extractImageAttrsFromMarkup should return null
    const result = selectImageAttributes(doc, 'el-hero:h1-0');
    expect(result).toBeNull();
  });

  it('instance-child: returns null for out-of-range img index', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><img src="only.jpg" /></section>');

    // img-1 doesn't exist (only img-0)
    const result = selectImageAttributes(doc, 'el-hero:img-1');
    expect(result).toBeNull();
  });

  it('instance-child: selects correct img by index', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><img src="first.jpg" alt="First" /><img src="second.jpg" alt="Second" /></section>');

    const result0 = selectImageAttributes(doc, 'el-hero:img-0');
    expect(result0).not.toBeNull();
    expect(result0!.src).toBe('first.jpg');
    expect(result0!.alt).toBe('First');

    const result1 = selectImageAttributes(doc, 'el-hero:img-1');
    expect(result1).not.toBeNull();
    expect(result1!.src).toBe('second.jpg');
    expect(result1!.alt).toBe('Second');
  });

  it('instance-child: one selector override does not leak to another', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><img src="first.jpg" /><img src="second.jpg" /></section>');
    const elements = doc.getMap('elements');
    const yElement = elements.get('el-hero') as Y.Map<unknown>;

    const imageOverrides = new Y.Map();
    const selectorAttrs = new Y.Map();
    selectorAttrs.set('src', 'overridden-first.png');
    imageOverrides.set('img-0', selectorAttrs);
    yElement.set('imageOverrides', imageOverrides);

    // img-0 gets override
    const result0 = selectImageAttributes(doc, 'el-hero:img-0');
    expect(result0!.src).toBe('overridden-first.png');

    // img-1 falls through to staticMarkup
    const result1 = selectImageAttributes(doc, 'el-hero:img-1');
    expect(result1!.src).toBe('second.jpg');
  });

  // --- Instance child: fallback to staticMarkup ---

  it('instance-child: falls back to staticMarkup when no imageOverrides', () => {
    const doc = createDocWithImgInstance('el-hero', '<section><img src="child.jpg" alt="Child" loading="eager" /></section>');

    const result = selectImageAttributes(doc, 'el-hero:img-0');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('child.jpg');
    expect(result!.alt).toBe('Child');
    expect(result!.loading).toBe('eager');
  });

  // --- Source elements ---

  it('source: returns null when no sourceImageAttributes', () => {
    const doc = createEditorDoc();
    expect(selectImageAttributes(doc, 'src/Hero.astro:5:1')).toBeNull();
  });

  it('source: returns attributes from sourceImageAttributes map', () => {
    const doc = createEditorDoc();
    const sourceImageAttributes = doc.getMap('sourceImageAttributes');

    const attrs = new Y.Map();
    attrs.set('src', '/images/hero.webp');
    attrs.set('alt', 'Source hero');
    attrs.set('loading', 'lazy');
    sourceImageAttributes.set('src/Hero.astro:5:1', attrs);

    const result = selectImageAttributes(doc, 'src/Hero.astro:5:1');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('/images/hero.webp');
    expect(result!.alt).toBe('Source hero');
    expect(result!.loading).toBe('lazy');
  });

  it('source: returns src even when alt and loading are not set', () => {
    const doc = createEditorDoc();
    const sourceImageAttributes = doc.getMap('sourceImageAttributes');

    const attrs = new Y.Map();
    attrs.set('src', '/images/logo.svg');
    sourceImageAttributes.set('src/Header.astro:3:1', attrs);

    const result = selectImageAttributes(doc, 'src/Header.astro:3:1');
    expect(result).not.toBeNull();
    expect(result!.src).toBe('/images/logo.svg');
    expect(result!.alt).toBeUndefined();
    expect(result!.loading).toBeUndefined();
  });
});
