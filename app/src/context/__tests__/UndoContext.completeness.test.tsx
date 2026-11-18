import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
/**
 * Snapshot completeness guard (design: docs/archive/plans/2026-06-10-undo-scoping-design.md §3.2)
 *
 * takeSnapshot() -> mutate everything -> undo() must round-trip EVERY
 * snapshot-relevant field of PageData and ElementData. The fixtures are
 * Required<Omit<..., EXEMPT>> so adding a field to the type without deciding
 * its snapshot fate is a COMPILE error, not a silent undo bug.
 */
import { describe, it, expect, vi } from 'vitest';
import { act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { UndoProvider, useUndoContext, type SourceClassEntry } from '../UndoContext';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { applyCommand } from '@/store/commands';
import type { PageData, ElementData } from '@/store/types';

// Mock localStorage (createEditorDoc reads the saved breakpoint)
const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockLocalStorage[key] ?? null,
  setItem: (key: string, value: string) => { mockLocalStorage[key] = value; },
  removeItem: (key: string) => { delete mockLocalStorage[key]; },
  clear: () => { Object.keys(mockLocalStorage).forEach(key => delete mockLocalStorage[key]); },
});

/** Fields deliberately NOT round-tripped by undo. Each needs a reason. */
type PageExempt = never; // ALL PageData fields must round-trip.

const PAGE_FIXTURE: Required<Omit<PageData, PageExempt>> = {
  id: 'page-1',
  name: 'Home',
  rootElementIds: ['el-1'],
  children: [],
  seo: { title: 'SEO Title', ogImage: { src: '/og.png', alt: 'og' }, keywords: ['a', 'b'] },
  childOrders: { 'el-1': ['el-1:h1-0', 'el-1:p-0'] },
  pageType: 'post',
  collectionId: 'col-1',
  routePrefix: '/blog',
  layoutName: 'MainLayout',
  layoutProps: { title: 'Hello' },
};

/** Hook harness: doc must come from useEditorDoc() (see undo knownIssues). */
function useHarness() {
  const doc = useEditorDoc();
  const undo = useUndoContext();
  return { doc, undo };
}
/** Undo is a durable acceptance (7932857b): the doc needs a project id. */
function ProjectSeed({ children }: { children: React.ReactNode }) {
  const doc = useEditorDoc();
  React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', crypto.randomUUID()); }, [doc]);
  return <>{children}</>;
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <EditorProvider>
    <ProjectSeed><UndoProvider>{children}</UndoProvider></ProjectSeed>
  </EditorProvider>
);

/** Seed a page carrying every PAGE_FIXTURE field, via real commands where they exist. */
function seedPage(doc: Y.Doc) {
  doc.transact(() => {
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: {
        id: PAGE_FIXTURE.id,
        name: PAGE_FIXTURE.name,
        rootElementIds: PAGE_FIXTURE.rootElementIds,
        children: [],
      },
    });
    for (const [field, value] of Object.entries(PAGE_FIXTURE.seo)) {
      applyCommand(doc, { type: 'UPDATE_PAGE_SEO', pageId: PAGE_FIXTURE.id, field, value });
    }
    // Fields without a seeding command in this test's scope: set directly
    // (test-only; mirrors what SET_PAGE_LAYOUT / post-page setup write).
    const yPage = doc.getMap('pages').get(PAGE_FIXTURE.id) as Y.Map<unknown>;
    yPage.set('pageType', PAGE_FIXTURE.pageType);
    yPage.set('collectionId', PAGE_FIXTURE.collectionId);
    yPage.set('routePrefix', PAGE_FIXTURE.routePrefix);
    yPage.set('layoutName', PAGE_FIXTURE.layoutName);
    yPage.set('layoutProps', PAGE_FIXTURE.layoutProps);
    const co = new Y.Map<Y.Array<string>>();
    for (const [k, v] of Object.entries(PAGE_FIXTURE.childOrders)) co.set(k, Y.Array.from(v));
    yPage.set('childOrders', co);
  }, 'user');
}

function readPage(doc: Y.Doc, pageId = PAGE_FIXTURE.id): Record<string, unknown> {
  const yPage = doc.getMap('pages').get(pageId) as Y.Map<unknown>;
  return yPage.toJSON();
}

describe('UndoContext snapshot completeness — PageData', () => {
  it('round-trips every PageData field through takeSnapshot/undo', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    act(() => seedPage(doc));
    const before = readPage(doc);
    // Sanity: the fixture actually landed (otherwise the round-trip proves nothing).
    expect(before.seo).toBeDefined();
    expect(before.layoutName).toBe('MainLayout');

    act(() => result.current.undo.takeSnapshot());

    // Wreck every field.
    act(() => {
      doc.transact(() => {
        const yPage = doc.getMap('pages').get(PAGE_FIXTURE.id) as Y.Map<unknown>;
        yPage.set('name', 'WRECKED');
        yPage.delete('seo');
        yPage.delete('pageType');
        yPage.delete('collectionId');
        yPage.delete('routePrefix');
        yPage.delete('layoutName');
        yPage.delete('layoutProps');
        yPage.delete('childOrders');
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    expect(readPage(doc)).toEqual(before);
  });

  it('delete-when-absent: undoing the FIRST seo/layout edit removes the fields', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    // Page with NO seo/layout.
    act(() => {
      doc.transact(() => {
        applyCommand(doc, {
          type: 'ADD_PAGE',
          page: { id: 'page-2', name: 'Bare', rootElementIds: [], children: [] },
        });
      }, 'user');
    });

    act(() => result.current.undo.takeSnapshot()); // pre-edit checkpoint

    act(() => {
      doc.transact(() => {
        applyCommand(doc, { type: 'UPDATE_PAGE_SEO', pageId: 'page-2', field: 'title', value: 'X' });
        (doc.getMap('pages').get('page-2') as Y.Map<unknown>).set('layoutName', 'MainLayout');
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    const yPage = doc.getMap('pages').get('page-2') as Y.Map<unknown>;
    expect(yPage.get('seo')).toBeUndefined();
    expect(yPage.get('layoutName')).toBeUndefined();
  });
});

/** Fields deliberately NOT round-tripped by undo. Each needs a reason. */
type ElementExempt =
  | 'defaultChildren'   // registry-only, stripped at write time (types.ts)
  | 'hrefOverrides';    // legacy map, no write path since session 12; migrated to unifiedOverrides

const ELEMENT_FIXTURE: Required<Omit<ElementData, ElementExempt>> = {
  id: 'el-1',
  pageId: 'page-1',
  parentId: null,
  index: 0,
  type: 'link',
  componentType: 'Hero',
  slotName: 'main',
  classes: { base: ['p-4'], sm: [], md: ['flex'], lg: [], xl: [], '2xl': [] },
  textContent: 'hello',
  text: 'hello-text',
  tag: 'p',
  attributes: { 'data-x': '1' },
  staticMarkup: '<section>hi</section>',
  instanceType: 'theme',
  templateId: 'tpl-9',
  overrides: { 'child-1': { textContent: 'over' } },
  isTemplateChild: true,
  themeId: 'theme-9',
  componentPath: 'src/components/Card.astro',
  classOverrides: { 'h1-0': { base: ['text-xl'], sm: [], md: [], lg: [], xl: [], '2xl': [] } },
  textOverrides: { 'h1-0': 'T' },
  markupOverrides: { 'p-0': '<p>x</p>' },
  linkCounters: { 'p-0': 3 },
  linkAttributes: { href: '/x', target: '_blank' },
  isWrapperLink: true,
  originalType: 'text',
  linkOverrides: { 'a-0': { href: '/y' } },
  imageAttributes: { src: '/img.png', alt: 'i' },
  imageOverrides: { 'img-0': { src: '/a.png' } },
  deletedSelectors: ['p-1'],
  orderOverrides: ['h1-0', 'p-0'],
  reparentOverrides: ['p-0>section-0'],
  astroSource: 'library/Hero.astro',
  isDrawn: true,
  slotType: 'blog',
  slotComponentId: 'comp-1',
  slotComponentName: 'Card',
  slotComponentMarkup: '<div></div>',
  slotComponentPath: 'library/Card.astro',
  bindingType: 'layout-chrome',
};

/** The optional fields whose capture/restore this guard pins. */
const OPTIONAL_FIELDS = [
  'isWrapperLink',
  'originalType',
  'bindingType',
] as const;

/** Seed an element carrying every ELEMENT_FIXTURE field, mirroring the Y
 *  structures createSnapshot reads (test seeding writes Y directly, like the
 *  existing UndoContext tests). */
function seedElement(doc: Y.Doc) {
  doc.transact(() => {
    const yEl = new Y.Map<unknown>();
    const F = ELEMENT_FIXTURE;

    // Scalars (plain values, exactly how commands.ts stores them).
    const scalars: Partial<Record<keyof ElementData, unknown>> = {
      id: F.id, pageId: F.pageId, parentId: F.parentId, index: F.index, type: F.type,
      componentType: F.componentType, slotName: F.slotName, textContent: F.textContent,
      text: F.text, tag: F.tag, attributes: F.attributes, staticMarkup: F.staticMarkup,
      instanceType: F.instanceType, templateId: F.templateId, isTemplateChild: F.isTemplateChild,
      themeId: F.themeId, componentPath: F.componentPath,
      isWrapperLink: F.isWrapperLink, originalType: F.originalType, bindingType: F.bindingType,
      astroSource: F.astroSource, isDrawn: F.isDrawn,
      slotType: F.slotType, slotComponentId: F.slotComponentId,
      slotComponentName: F.slotComponentName, slotComponentMarkup: F.slotComponentMarkup,
      slotComponentPath: F.slotComponentPath,
    };
    for (const [k, v] of Object.entries(scalars)) yEl.set(k, v);

    // classes: Y.Map<bp, Y.Array<string>>
    const yClasses = new Y.Map<Y.Array<string>>();
    for (const [bp, tokens] of Object.entries(F.classes)) yClasses.set(bp, Y.Array.from(tokens));
    yEl.set('classes', yClasses);

    // overrides: Y.Map<childId, Y.Map>
    const yOverrides = new Y.Map<Y.Map<unknown>>();
    for (const [childId, ov] of Object.entries(F.overrides)) {
      const inner = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(ov)) inner.set(k, v);
      yOverrides.set(childId, inner);
    }
    yEl.set('overrides', yOverrides);

    // classOverrides: Y.Map<selector, Y.Map<bp, Y.Array>>
    const yClassOverrides = new Y.Map<Y.Map<Y.Array<string>>>();
    for (const [sel, cd] of Object.entries(F.classOverrides)) {
      const inner = new Y.Map<Y.Array<string>>();
      for (const [bp, tokens] of Object.entries(cd)) inner.set(bp, Y.Array.from(tokens as string[]));
      yClassOverrides.set(sel, inner);
    }
    yEl.set('classOverrides', yClassOverrides);

    // Flat string/number maps.
    const setFlat = (name: string, data: Record<string, unknown>) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(data)) m.set(k, v);
      yEl.set(name, m);
    };
    setFlat('textOverrides', F.textOverrides);
    setFlat('markupOverrides', F.markupOverrides);
    setFlat('linkCounters', F.linkCounters);
    setFlat('linkAttributes', F.linkAttributes as Record<string, unknown>);
    setFlat('imageAttributes', F.imageAttributes as unknown as Record<string, unknown>);

    // Nested string maps.
    const setNested = (name: string, data: Record<string, Record<string, unknown>>) => {
      const outer = new Y.Map<Y.Map<unknown>>();
      for (const [sel, attrs] of Object.entries(data)) {
        const inner = new Y.Map<unknown>();
        for (const [k, v] of Object.entries(attrs)) inner.set(k, v);
        outer.set(sel, inner);
      }
      yEl.set(name, outer);
    };
    setNested('linkOverrides', F.linkOverrides as unknown as Record<string, Record<string, unknown>>);
    setNested('imageOverrides', F.imageOverrides as unknown as Record<string, Record<string, unknown>>);

    yEl.set('deletedSelectors', Y.Array.from(F.deletedSelectors));
    yEl.set('orderOverrides', Y.Array.from(F.orderOverrides));
    yEl.set('reparentOverrides', Y.Array.from(F.reparentOverrides));

    doc.getMap('elements').set(F.id, yEl);
  }, 'user');
}

function readElement(doc: Y.Doc, id = ELEMENT_FIXTURE.id): Record<string, unknown> {
  const yEl = doc.getMap('elements').get(id) as Y.Map<unknown>;
  return yEl.toJSON();
}

describe('UndoContext snapshot completeness — ElementData', () => {
  it('round-trips every ElementData field through takeSnapshot/undo', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    act(() => seedElement(doc));
    const before = readElement(doc);
    // Sanity: the pinned optional fields actually landed.
    for (const f of OPTIONAL_FIELDS) expect(before[f]).toBeDefined();

    act(() => result.current.undo.takeSnapshot());

    // Wreck: delete the optional fields, mutate a covered one.
    act(() => {
      doc.transact(() => {
        const yEl = doc.getMap('elements').get(ELEMENT_FIXTURE.id) as Y.Map<unknown>;
        for (const f of OPTIONAL_FIELDS) yEl.delete(f);
        yEl.set('textContent', 'WRECKED');
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    expect(readElement(doc)).toEqual(before);
  });

  it('delete-when-absent: undoing the action that SET the optional fields removes them', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    // Element WITHOUT the optional fields.
    act(() => {
      doc.transact(() => {
        const yEl = new Y.Map<unknown>();
        yEl.set('id', 'el-2');
        yEl.set('pageId', 'page-1');
        yEl.set('parentId', null);
        yEl.set('index', 0);
        yEl.set('type', 'text');
        doc.getMap('elements').set('el-2', yEl);
      }, 'user');
    });

    act(() => result.current.undo.takeSnapshot()); // pre-conversion checkpoint

    act(() => {
      doc.transact(() => {
        const yEl = doc.getMap('elements').get('el-2') as Y.Map<unknown>;
        yEl.set('isWrapperLink', true);
        yEl.set('originalType', 'text');
        yEl.set('bindingType', 'layout-chrome');
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    const yEl = doc.getMap('elements').get('el-2') as Y.Map<unknown>;
    for (const f of OPTIONAL_FIELDS) {
      expect(yEl.get(f), `${f} should be removed by undo`).toBeUndefined();
    }
  });
});

/**
 * SourceClassEntry completeness guard: capture/restore in UndoContext copy
 * entry fields BY HAND — adding a field to SourceClassEntry without deciding
 * its snapshot fate must be a COMPILE error here, not a silent undo bug
 * (the PageData/ElementData fixtures above give the same guarantee).
 */
const SOURCE_CLASS_FIXTURE: Required<SourceClassEntry> = {
  classes: 'p-4 text-lg',
  sourceLocation: { file: 'src/A.astro', line: 1, column: 1 },
  edited: true,
};

describe('UndoContext sourceClasses edited flag round-trip', () => {
  const KEY = 'src/A.astro:1:1';

  function seedSourceClass(doc: Y.Doc, classes: string, edited: boolean) {
    doc.transact(() => {
      const yCls = new Y.Map<unknown>();
      yCls.set('classes', classes);
      if (edited) yCls.set('edited', true);
      doc.getMap('sourceClasses').set(KEY, yCls);
    }, 'user');
  }

  it('restores edited:true after the entry is mutated', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    seedSourceClass(doc, 'p-4', true);
    act(() => result.current.undo.takeSnapshot());

    // Mutate: change classes AND drop the flag (simulates a rebuild without it).
    act(() => {
      doc.transact(() => {
        const yCls = new Y.Map<unknown>();
        yCls.set('classes', 'p-8');
        doc.getMap('sourceClasses').set(KEY, yCls);
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    const yCls = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(yCls.get('classes')).toBe('p-4');
    expect(yCls.get('edited')).toBe(true);
  });

  it('does not stamp edited on an entry that never had it', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    seedSourceClass(doc, 'p-4', false);
    act(() => result.current.undo.takeSnapshot());

    act(() => {
      doc.transact(() => {
        const yCls = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
        yCls.set('classes', 'p-8');
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    const yCls = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(yCls.get('classes')).toBe('p-4');
    expect(yCls.get('edited')).toBeUndefined();
  });

  it('rewrites the entry when ONLY the edited flag differs (classes identical)', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    seedSourceClass(doc, 'p-4', true);
    act(() => result.current.undo.takeSnapshot());

    // Remove only the flag; classes stay identical.
    act(() => {
      doc.transact(() => {
        const yCls = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
        yCls.delete('edited');
      }, 'user');
    });

    await act(async () => { await result.current.undo.undo(); });

    const yCls = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(yCls.get('classes')).toBe('p-4');
    expect(yCls.get('edited')).toBe(true);
  });

  it('round-trips every SourceClassEntry field through takeSnapshot/undo', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    act(() => {
      doc.transact(() => {
        const yCls = new Y.Map<unknown>();
        yCls.set('classes', SOURCE_CLASS_FIXTURE.classes);
        const yLoc = new Y.Map<unknown>();
        yLoc.set('file', SOURCE_CLASS_FIXTURE.sourceLocation.file);
        yLoc.set('line', SOURCE_CLASS_FIXTURE.sourceLocation.line);
        yLoc.set('column', SOURCE_CLASS_FIXTURE.sourceLocation.column);
        yCls.set('sourceLocation', yLoc);
        yCls.set('edited', SOURCE_CLASS_FIXTURE.edited);
        doc.getMap('sourceClasses').set(KEY, yCls);
      }, 'user');
    });
    const before = (doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>).toJSON();

    act(() => result.current.undo.takeSnapshot());
    act(() => {
      doc.transact(() => doc.getMap('sourceClasses').delete(KEY), 'user');
    });
    await act(async () => { await result.current.undo.undo(); });

    const restored = doc.getMap('sourceClasses').get(KEY) as Y.Map<unknown>;
    expect(restored?.toJSON()).toEqual(before);
  });
});

describe('UndoContext diff-on-apply (no observer churn)', () => {
  it('does not touch unchanged top-level maps during undo', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });
    const doc = result.current.doc;

    // Seed sourceText + sourceClasses + one element with a textOverrides entry.
    act(() => {
      doc.transact(() => {
        const yText = new Y.Map<unknown>();
        yText.set('textContent', 'hello');
        doc.getMap('sourceText').set('src/A.astro:1:1', yText);

        const yCls = new Y.Map<unknown>();
        yCls.set('classes', 'p-4');
        doc.getMap('sourceClasses').set('src/A.astro:1:1', yCls);

        const yEl = new Y.Map<unknown>();
        yEl.set('id', 'el-obs');
        yEl.set('pageId', 'page-1');
        yEl.set('parentId', null);
        yEl.set('index', 0);
        yEl.set('type', 'component');
        const tov = new Y.Map<unknown>();
        tov.set('h1-0', 'original');
        yEl.set('textOverrides', tov);
        doc.getMap('elements').set('el-obs', yEl);
      }, 'user');
    });

    act(() => result.current.undo.takeSnapshot());

    // Mutate ONLY the element's textOverrides.
    act(() => {
      doc.transact(() => {
        const yEl = doc.getMap('elements').get('el-obs') as Y.Map<unknown>;
        (yEl.get('textOverrides') as Y.Map<unknown>).set('h1-0', 'changed');
      }, 'user');
    });

    // Attach observers AFTER the mutation, right before undo.
    const textSpy = vi.fn();
    const classesSpy = vi.fn();
    doc.getMap('sourceText').observeDeep(textSpy);
    doc.getMap('sourceClasses').observeDeep(classesSpy);

    await act(async () => { await result.current.undo.undo(); });

    // The real change was restored…
    const yEl = doc.getMap('elements').get('el-obs') as Y.Map<unknown>;
    expect((yEl.get('textOverrides') as Y.Map<unknown>).get('h1-0')).toBe('original');
    // …but untouched top-level maps saw zero events.
    expect(textSpy).not.toHaveBeenCalled();
    expect(classesSpy).not.toHaveBeenCalled();
  });
});

describe('UndoContext dev-only mutation-without-snapshot detector (design §3.5)', () => {
  it('warns when a user-origin mutation commits without takeSnapshot', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = await renderReadyEditorHook(useHarness, { wrapper });
      const doc = result.current.doc;

      act(() => {
        doc.transact(() => {
          doc.getMap('meta').set('detectorProbe', 1);
        }, 'user');
      });

      const undoWarns = warnSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('[undo] user mutation without takeSnapshot'),
      );
      expect(undoWarns).toHaveLength(1);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn when takeSnapshot precedes the mutation', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { result } = await renderReadyEditorHook(useHarness, { wrapper });
      const doc = result.current.doc;

      act(() => result.current.undo.takeSnapshot());
      act(() => {
        doc.transact(() => {
          doc.getMap('meta').set('detectorProbe', 2);
        }, 'user');
      });

      const undoWarns = warnSpy.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('[undo] user mutation without takeSnapshot'),
      );
      expect(undoWarns).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
