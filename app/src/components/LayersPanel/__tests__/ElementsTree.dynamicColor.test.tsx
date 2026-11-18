/**
 * Dynamic rows wear the yellow `text-dynamic` accent on icon AND label —
 * derived from the ONE predicate (isDynamicComponent) via the library index
 * passed as the `dynamicIndex` prop. Covers the WC join (Yjs componentType
 * name, instance-root-gated) and the local-mode join (component root FILE →
 * ScannedComponent.path). Instance internals and static components stay as
 * before (neutral label; purple icon for components).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { buildDynamicComponentIndex } from '@/store/folderManifest';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  scanned: [] as unknown[],
  expanded: new Set<string>(),
  selectedKey: null as string | null,
  localPath: null as string | null,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => vi.fn(),
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useScopedYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useCurrentPageId: () => (h.doc as Y.Doc).getMap("meta").get("currentPageId"),
  useProjectId: () => (h.doc as Y.Doc).getMap("meta").get("projectId") ?? null,
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => h.localPath,
}));

vi.mock('@/context/SelectionContext', async (orig) => {
  const actual = await orig<typeof import('@/context/SelectionContext')>();
  return {
    ...actual,
    useScannedElementsRef: () => ({ scannedByKeyRef: { current: new Map(h.scanned.map(e => [(e as ScannedElement).key, e])) } }),
    useScannedElements: () => ({
      scannedElements: h.scanned,
      scannedByKey: new Map(h.scanned.map((e) => [(e as ScannedElement).key, e])),
      expandedNodes: h.expanded,
      toggleExpand: vi.fn(),
    }),
    useSelectionContext: () => ({
      selectedKey: h.selectedKey,
      select: vi.fn(),
      enterContext: vi.fn(),
      reparentDragKey: null,
      setReparentDragKey: vi.fn(),
      additionalSelections: [],
      addAdditionalSelection: vi.fn(),
      removeAdditionalSelection: vi.fn(),
      clearAdditionalSelections: vi.fn(),
    }),
  };
});

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));

vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({ activeKeys: [], recentlyTouchedKeys: [] }),
}));

vi.mock('@/context', () => ({
  useTool: () => ({ activeTool: 'select' }),
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/assets/icons', () => {
  const Stub = ({ className }: { className?: string }) => <span className={className} />;
  return {
    ComponentIcon: Stub,
    ContainerIcon: Stub,
    LayerTextIcon: Stub,
    LayerImageIcon: Stub,
    LayerLinkIcon: Stub,
    ChevronTreeIcon: Stub,
    SparkleIcon: Stub,
  };
});

import { ElementsTree } from '../ElementsTree';

function comp(partial: Partial<ScannedComponent> & { name: string; path: string }): ScannedComponent {
  return {
    source: 'built-in',
    html: '',
    category: 'Uncategorized',
    props: [],
    slots: [],
    dependencies: [],
    ...partial,
  } as ScannedComponent;
}

const LIBRARY: ScannedComponent[] = [
  comp({ name: 'BlogCard', path: 'library/BlogCard.astro', category: 'Blog' }),
  comp({ name: 'Hero', path: 'library/Hero.astro', category: 'Hero' }),
  comp({ name: 'PostGrid', path: 'src/components/PostGrid.astro', category: 'Uncategorized', contentBound: true, source: 'user-project' }),
];
const INDEX = buildDynamicComponentIndex(LIBRARY);

function scanned(partial: Partial<ScannedElement> & { key: string; tagName: string }): ScannedElement {
  return {
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey: null,
    hasSourceTracking: true,
    ...partial,
  } as ScannedElement;
}

function buildDoc(componentTypes: Record<string, string>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
    const elements = doc.getMap('elements');
    for (const [id, type] of Object.entries(componentTypes)) {
      const yEl = new Y.Map();
      yEl.set('pageId', PAGE_ID);
      yEl.set('componentType', type);
      elements.set(id, yEl);
    }
  }, 'sync');
  return doc;
}

function renderTree() {
  return render(
    <DndContext>
      <ElementsTree dynamicIndex={INDEX} />
    </DndContext>,
  );
}

function iconAndLabelDynamic(container: HTMLElement, key: string): { icon: boolean; label: boolean } {
  const row = container.querySelector(`[data-layer-key="${CSS.escape(key)}"]`);
  expect(row, `row ${key} must render`).not.toBeNull();
  const dyn = row!.querySelectorAll('.text-dynamic');
  const label = row!.querySelector('span.text-xs');
  return { icon: dyn.length > 0, label: !!label?.className.includes('text-dynamic') };
}

describe('ElementsTree — dynamic yellow accent', () => {
  beforeEach(() => {
    h.expanded = new Set(['el-blog']);
    h.selectedKey = null;
    h.localPath = null;
  });

  it('WC: a dynamic component instance root gets yellow icon + label; internals stay plain', () => {
    h.doc = buildDoc({ 'el-blog': 'BlogCard' });
    h.scanned = [
      scanned({ key: 'el-blog', tagName: 'section', hasSourceTracking: false }),
      scanned({ key: 'el-blog:h2-0', tagName: 'h2', parentKey: 'el-blog', hasSourceTracking: false }),
    ];
    const { container } = renderTree();

    const root = iconAndLabelDynamic(container, 'el-blog');
    expect(root.icon, 'dynamic root icon is yellow').toBe(true);
    expect(root.label, 'dynamic root label is yellow').toBe(true);

    const child = iconAndLabelDynamic(container, 'el-blog:h2-0');
    expect(child.icon, 'instance internals keep no dynamic accent').toBe(false);
    expect(child.label, 'internal labels stay neutral').toBe(false);
  });

  it('WC: a static component instance root keeps the purple accent, no yellow', () => {
    h.doc = buildDoc({ 'el-hero': 'Hero' });
    h.scanned = [scanned({ key: 'el-hero', tagName: 'section', hasSourceTracking: false })];
    const { container } = renderTree();

    const row = container.querySelector('[data-layer-key="el-hero"]');
    expect(row!.querySelector('.text-stroke-component'), 'static component icon stays purple').not.toBeNull();
    expect(row!.querySelector('.text-dynamic'), 'static component gets no yellow').toBeNull();
    const label = row!.querySelector('span.text-xs');
    expect(label?.className, 'component label is purple too (identity = icon + label)').toContain('text-stroke-component');
  });

  it('local mode: a content-bound component ROOT row joins by file path and goes yellow', () => {
    h.localPath = '/Users/x/proj';
    h.doc = buildDoc({});
    h.scanned = [
      scanned({ key: 'src/pages/index.astro:3:1', tagName: 'main' }),
      scanned({ key: 'src/components/PostGrid.astro:5:1', tagName: 'section', parentKey: 'src/pages/index.astro:3:1' }),
      // Same-file internal — NOT a root, stays plain.
      scanned({ key: 'src/components/PostGrid.astro:9:3', tagName: 'h2', parentKey: 'src/components/PostGrid.astro:5:1' }),
    ];
    h.expanded = new Set(['src/pages/index.astro:3:1', 'src/components/PostGrid.astro:5:1']);
    const { container } = renderTree();

    const root = iconAndLabelDynamic(container, 'src/components/PostGrid.astro:5:1');
    expect(root.icon, 'local content-bound root icon is yellow').toBe(true);
    expect(root.label, 'local content-bound root label is yellow').toBe(true);

    const internal = iconAndLabelDynamic(container, 'src/components/PostGrid.astro:9:3');
    expect(internal.icon, 'same-file internals stay plain').toBe(false);
  });

  it('local mode: a COMPONENT sharing a layout\'s name stays purple (path beats name)', () => {
    // owner report 2026-08-24: components/Main.astro rendered yellow because a
    // layouts/Main.astro exists and the lowercased-name fallback matched it.
    const index = buildDynamicComponentIndex([
      ...LIBRARY,
      comp({ name: 'Main', path: 'src/layouts/Main.astro', category: 'Layouts', source: 'user-project' }),
    ]);
    h.localPath = '/Users/x/proj';
    h.doc = buildDoc({});
    h.scanned = [
      scanned({ key: 'src/pages/index.astro:3:1', tagName: 'div' }),
      scanned({ key: 'src/components/Main.astro:7:1', tagName: 'main', parentKey: 'src/pages/index.astro:3:1' }),
    ];
    h.expanded = new Set(['src/pages/index.astro:3:1']);
    const { container } = render(
      <DndContext>
        <ElementsTree dynamicIndex={index} />
      </DndContext>,
    );

    const row = iconAndLabelDynamic(container, 'src/components/Main.astro:7:1');
    expect(row.icon, 'component named like a layout must NOT go yellow').toBe(false);
    const rowEl = container.querySelector(`[data-layer-key="${CSS.escape('src/components/Main.astro:7:1')}"]`);
    expect(rowEl!.querySelectorAll('.text-stroke-component').length, 'stays purple').toBeGreaterThan(0);
  });
});

describe('ElementsTree — idle icon color (owner 2026-10-22: "icons … not selected is way too blank")', () => {
  beforeEach(() => { h.expanded = new Set(); h.selectedKey = null; h.localPath = null; });

  it('an unselected plain layer icon is Text/Secondary — lighter than its label, never the disabled gray (owner 2026-10-22)', () => {
    h.doc = buildDoc({});
    h.scanned = [scanned({ key: 'el-p', tagName: 'p' })];
    const { container } = renderTree();
    const row = container.querySelector('[data-layer-key="el-p"]');
    expect(row, 'row must render').not.toBeNull();
    expect(row!.querySelector('svg.text-text-secondary, span.text-text-secondary'), 'idle icon = Text/Secondary').not.toBeNull();
    expect(row!.querySelector('.text-text-disabled'), 'no disabled gray on an enabled row').toBeNull();
  });
});
