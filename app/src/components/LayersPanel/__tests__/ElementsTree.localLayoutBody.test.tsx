/**
 * Layout-element paradigm: when the scan contains a layout-owned <body> row,
 * it IS the Layout node — labeled with the layout name, children nested,
 * no synthetic layoutchrome-<pageId> row minted.
 * (Mock block + helpers copied from ElementsTree.dynamicColor.test.tsx;
 *  the h.localPath mock arms local mode.)
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
      expandNodes: vi.fn(),
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

const INDEX = buildDynamicComponentIndex([
  comp({ name: 'BlogCard', path: 'library/BlogCard.astro', category: 'Blog' }),
]);

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

describe('ElementsTree — layout-owned <body> row is the Layout node', () => {
  beforeEach(() => {
    h.expanded = new Set<string>();
    h.selectedKey = null;
    h.localPath = null;
  });

  it('local: body row from src/layouts/ renders as the Layout root, no synthetic node', () => {
    h.localPath = '/Users/x/proj';
    h.doc = buildDoc({});
    h.scanned = [
      scanned({ key: 'src/layouts/Main.astro:37:2', tagName: 'body',
        sourceLocation: { file: 'src/layouts/Main.astro', line: 37, column: 2 } }),
      scanned({ key: 'src/components/Header.astro:6:1', tagName: 'header',
        parentKey: 'src/layouts/Main.astro:37:2',
        sourceLocation: { file: 'src/components/Header.astro', line: 6, column: 1 } }),
    ];
    h.expanded = new Set(['src/layouts/Main.astro:37:2']);
    const { container } = renderTree();

    expect(container.querySelector(`[data-layer-key="layoutchrome-${PAGE_ID}"]`),
      'no synthetic node when the body row exists').toBeNull();
    const bodyRow = container.querySelector(
      `[data-layer-key="${CSS.escape('src/layouts/Main.astro:37:2')}"]`);
    expect(bodyRow, 'body row renders').not.toBeNull();
    expect(bodyRow!.textContent).toContain('Main'); // layout name, not "body"
    const headerRow = container.querySelector(
      `[data-layer-key="${CSS.escape('src/components/Header.astro:6:1')}"]`);
    expect(headerRow, 'child renders nested').not.toBeNull();
  });

  it('local: no body row → synthetic fallback node still minted (fragment layouts)', () => {
    h.localPath = '/Users/x/proj';
    h.doc = buildDoc({});
    h.scanned = [
      scanned({ key: 'src/layouts/Post.astro:5:1', tagName: 'main',
        sourceLocation: { file: 'src/layouts/Post.astro', line: 5, column: 1 } }),
    ];
    const { container } = renderTree();

    const synthetic = container.querySelector(`[data-layer-key="layoutchrome-${PAGE_ID}"]`);
    expect(synthetic, 'fragment layout keeps the synthetic Layout node').not.toBeNull();
  });
});
