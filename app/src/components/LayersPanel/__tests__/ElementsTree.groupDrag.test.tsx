/**
 * Group-drag payload (task-076 D5): when a multi-selection exists, MEMBER
 * rows carry `groupKeys` (primary + extras) in their sortable data so
 * Editor.handleDragEnd can move the whole block; non-member rows don't —
 * dragging them stays a single drag.
 *
 * Mirrors the ElementsTree.multiSelect.test.tsx harness (real
 * SelectionProvider, unrelated contexts mocked) and additionally records
 * every useSortable() call to inspect the drag data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import { SelectionProvider, useScannedElements } from '@/context/SelectionContext';
import type { ScannedElement } from '@/context/SelectionContext';
import { markFilesTruth, unmarkFilesTruth } from '@/utils/localMode';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  sortableCalls: [] as Array<{ id: string; data: { groupKeys?: string[] } }>,
}));

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return {
    ...actual,
    useSortable: (args: Parameters<typeof actual.useSortable>[0]) => {
      h.sortableCalls.push({
        id: String(args.id),
        data: (args.data ?? {}) as { groupKeys?: string[] },
      });
      return actual.useSortable(args);
    },
  };
});

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => vi.fn(),
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useScopedYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useCurrentPageId: () => (h.doc as Y.Doc).getMap("meta").get("currentPageId"),
  useProjectId: () => (h.doc as Y.Doc).getMap("meta").get("projectId") ?? null,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));

vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({ activeKeys: [], recentlyTouchedKeys: [] }),
}));

vi.mock('@/context', () => ({
  useTool: () => ({ activeTool: 'select' }),
}));

vi.mock('@/assets/icons', () => {
  const Stub = () => null;
  return {
    ComponentIcon: Stub,
    ContainerIcon: Stub,
    LayerTextIcon: Stub,
    LayerImageIcon: Stub,
    LayerLinkIcon: Stub,
    ChevronTreeIcon: Stub,
  };
});

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({
    layouts: [],
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

import { ElementsTree } from '../ElementsTree';

function scanned(key: string, parentKey: string | null): ScannedElement {
  return {
    key,
    tagName: 'section',
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
    parentKey,
    hasSourceTracking: true,
  };
}

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    doc.getMap('meta').set('projectId', 'browser_release');
    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', PAGE_ID);
    yPage.set('name', 'Home');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(PAGE_ID, yPage);
  }, 'sync');
  return doc;
}

function Seed({ elements }: { elements: ScannedElement[] }) {
  const { setScannedElements } = useScannedElements();
  useEffect(() => {
    setScannedElements(elements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderTree(elements: ScannedElement[]) {
  return render(
    <SelectionProvider>
      <Seed elements={elements} />
      <DndContext>
        <ElementsTree />
      </DndContext>
    </SelectionProvider>,
  );
}

function rowOf(container: HTMLElement, key: string): HTMLElement {
  const wrapper = container.querySelector(`[data-layer-key="${CSS.escape(key)}"]`);
  const row = wrapper?.querySelector('[data-testid="layer-item"]');
  if (!row) throw new Error(`row not found for ${key}`);
  return row as HTMLElement;
}

/** Sortable data of the LATEST render of the row with this key. */
function latestSortableData(key: string): { groupKeys?: string[] } {
  for (let i = h.sortableCalls.length - 1; i >= 0; i--) {
    if (h.sortableCalls[i].id === key) return h.sortableCalls[i].data;
  }
  throw new Error(`no useSortable call recorded for ${key}`);
}

const THREE_ROOTS = [scanned('el-a', null), scanned('el-b', null), scanned('el-c', null)];

describe('ElementsTree — group-drag sortable payload', () => {
  beforeEach(() => {
    unmarkFilesTruth('browser_release');
    h.doc = buildDoc();
    h.sortableCalls = [];
  });

  it('several source elements selected in files-truth: no hint text (owner 2026-11-17: unnecessary)', () => {
    markFilesTruth('browser_release');
    const sourceRoots = [
      scanned('src/pages/index.astro:5:1', null),
      scanned('src/pages/index.astro:9:1', null),
    ];
    const { container } = renderTree(sourceRoots);
    fireEvent.click(rowOf(container, sourceRoots[0].key));
    fireEvent.click(rowOf(container, sourceRoots[1].key), { metaKey: true });
    expect(screen.queryByText('Move one source element at a time')).not.toBeInTheDocument();
  });

  it('member rows carry groupKeys (primary first); non-members do not', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });

    expect(latestSortableData('el-a').groupKeys).toEqual(['el-a', 'el-b']);
    expect(latestSortableData('el-b').groupKeys).toEqual(['el-a', 'el-b']);
    expect(latestSortableData('el-c').groupKeys).toBeUndefined();
  });

  it('single selection (no extras) → no row carries groupKeys', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));

    expect(latestSortableData('el-a').groupKeys).toBeUndefined();
    expect(latestSortableData('el-b').groupKeys).toBeUndefined();
  });
});
