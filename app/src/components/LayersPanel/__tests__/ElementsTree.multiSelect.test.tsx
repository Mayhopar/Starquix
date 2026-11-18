/**
 * Multi-select gestures in the Layers panel: Cmd/Ctrl+click toggles any
 * layer into the extension set (task-076), Shift+click selects the visible
 * range, any plain click collapses to single-select. Membership is
 * policy-gated (store/multiSelect.ts — any layer; chrome/wrapper excluded).
 *
 * Uses the REAL SelectionProvider (state assertions via a probe) and mocks
 * only the unrelated contexts, mirroring ElementsTree.layoutNode.test.tsx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useEffect } from 'react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import {
  SelectionProvider,
  useScannedElements,
  useRectHover,
  useSelectionContext,
} from '@/context/SelectionContext';
import type { ScannedElement } from '@/context/SelectionContext';

const PAGE_ID = 'page-1';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  activeTool: 'select' as string,
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(),
  useEditorDoc: () => h.doc,
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
  useTool: () => ({ activeTool: h.activeTool }),
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

let scanApi: ReturnType<typeof useScannedElements>;
/** Pushes the scan into the REAL provider once on mount. */
function Seed({ elements }: { elements: ScannedElement[] }) {
  scanApi = useScannedElements();
  const { setScannedElements } = scanApi;
  useEffect(() => {
    setScannedElements(elements);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/** Exposes selection state for assertions: "<primary>|<extraKey,extraKey>" */
function Probe() {
  const { selectedRect } = useRectHover();
  const { selectedKey, additionalSelections, selectedPostLinkPaths } = useSelectionContext();
  return (
    <div data-testid="probe" data-rect={JSON.stringify(selectedRect)} data-post-links={JSON.stringify(selectedPostLinkPaths)}>
      {selectedKey ?? ''}|{additionalSelections.map((e) => e.key).join(',')}
    </div>
  );
}

function renderTree(elements: ScannedElement[]) {
  return render(
    <SelectionProvider>
      <Seed elements={elements} />
      <DndContext>
        <ElementsTree />
      </DndContext>
      <Probe />
    </SelectionProvider>,
  );
}

function rowOf(container: HTMLElement, key: string): HTMLElement {
  const wrapper = container.querySelector(`[data-layer-key="${CSS.escape(key)}"]`);
  const row = wrapper?.querySelector('[data-testid="layer-item"]');
  if (!row) throw new Error(`row not found for ${key}`);
  return row as HTMLElement;
}

const probeText = (container: HTMLElement) =>
  (container.querySelector('[data-testid="probe"]') as HTMLElement).textContent;

const THREE_ROOTS = [scanned('el-a', null), scanned('el-b', null), scanned('el-c', null)];

describe('ElementsTree — multi-select gestures', () => {
  beforeEach(() => {
    h.doc = buildDoc();
    h.activeTool = 'select';
  });

  it('click and drill-down selection use fresh geometry after rect-only patches', () => {
    const { container } = renderTree([scanned('el-a', null), scanned('el-child', 'el-a')]);
    act(() => scanApi.updateScannedElementRects([
      { key: 'el-a', rect: { top: 30, left: 10, width: 140, height: 120 } },
      { key: 'el-child', rect: { top: 40, left: 20, width: 80, height: 60 } },
    ]));
    fireEvent.click(rowOf(container, 'el-a'));
    expect(JSON.parse(container.querySelector('[data-testid="probe"]')!.getAttribute('data-rect')!)).toEqual({ top: 30, left: 10, width: 140, height: 120 });
    fireEvent.doubleClick(rowOf(container, 'el-a'));
    expect(JSON.parse(container.querySelector('[data-testid="probe"]')!.getAttribute('data-rect')!)).toEqual({ top: 40, left: 20, width: 80, height: 60 });
  });

  it('cmd-click adds a sibling to the extension set', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });
    expect(probeText(container)).toBe('el-a|el-b');
    // Both rows carry the member highlight marker.
    expect(container.querySelector('[data-layer-key="el-b"] [data-multi-selected]')).not.toBeNull();
  });

  it('cmd-click on a member removes it', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });
    expect(probeText(container)).toBe('el-a|');
  });

  it('cmd-click on a cross-parent row joins (any-layer, task-076)', () => {
    const { container } = renderTree([...THREE_ROOTS, scanned('el-c:div-0', 'el-c')]);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-c:div-0'), { metaKey: true });
    expect(probeText(container)).toBe('el-a|el-c:div-0');
  });

  it('shift-click selects the sibling range', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-c'), { shiftKey: true });
    expect(probeText(container)).toBe('el-a|el-b,el-c');
  });

  it('shift-click across depths selects visible rows, not collapsed grandchildren', () => {
    // Roots auto-expand on initial scan; el-a:div-1 stays collapsed, so its
    // child el-a:span-2 is not a visible row and must NOT join the range.
    const { container } = renderTree([
      scanned('el-a', null),
      scanned('el-a:div-0', 'el-a'),
      scanned('el-a:div-1', 'el-a'),
      scanned('el-a:span-2', 'el-a:div-1'),
      scanned('el-b', null),
    ]);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { shiftKey: true });
    expect(probeText(container)).toBe('el-a|el-a:div-0,el-a:div-1,el-b');
  });

  it('plain click collapses to single-select', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });
    fireEvent.click(rowOf(container, 'el-a'));
    expect(probeText(container)).toBe('el-a|');
  });

  it('cmd-click on the primary hands the primary to the next member (ledger A12)', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });
    fireEvent.click(rowOf(container, 'el-c'), { metaKey: true });
    fireEvent.click(rowOf(container, 'el-a'), { metaKey: true });
    expect(probeText(container)).toBe('el-b|el-c');
  });

  it('cmd-click on the sole selection deselects (ledger A12)', () => {
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-a'), { metaKey: true });
    expect(probeText(container)).toBe('|');
  });

  it('AI tool active ignores modifiers (plain-select behavior wins)', () => {
    h.activeTool = 'ai';
    const { container } = renderTree(THREE_ROOTS);
    fireEvent.click(rowOf(container, 'el-a'));
    fireEvent.click(rowOf(container, 'el-b'), { metaKey: true });
    expect(probeText(container)).toBe('el-b|');
  });
});

it('Layers retains the clicked imported card link evidence without borrowing its sibling', () => {
  h.doc = buildDoc(); h.activeTool = 'select';
  const { container } = renderTree([
    { ...scanned('el-a', null), tagName: 'article', postLinkPaths: ['/works/first'] },
    { ...scanned('el-b', null), tagName: 'article', postLinkPaths: ['/works/second'] },
  ]);
  fireEvent.click(rowOf(container, 'el-b'));
  expect(container.querySelector('[data-testid="probe"]')?.getAttribute('data-post-links')).toBe('["/works/second"]');
});
