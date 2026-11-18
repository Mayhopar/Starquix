/**
 * task-148 regression (gap: iframe-exit drag onto Layers, LAW VIOLATION):
 * ElementsTree.handleReparentDrop had NO local/source-keyed gate — dragging a
 * source-keyed element out of the canvas iframe and dropping it on a Layers
 * row dispatched a doc REPARENT_ELEMENT (element has no doc node), pushed a
 * phantom snapshot undo entry, and moved the DOM without ever writing the
 * file: the move silently reverted on the next HMR reload.
 *
 * Now the drop routes through the SAME structural writeMove path the
 * Layers-row drag uses (moveLocalElement + planLocalReparentInsert). The
 * routing predicates stay REAL; only the write op is mocked
 * (useLayersDrag.local.test.tsx pattern). Harness mirrors
 * ElementsTree.groupDrag.test.tsx (real SelectionProvider, unrelated
 * contexts mocked).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { DndContext } from '@dnd-kit/core';
import * as Y from 'yjs';
import { SelectionProvider, useScannedElements, useSelectionContext } from '@/context/SelectionContext';
import type { ScannedElement } from '@/context/SelectionContext';

const PAGE_ID = 'page-1';
const SRC_A = 'src/pages/index.astro:8:3';
const SRC_B = 'src/pages/index.astro:14:3';

const h = vi.hoisted(() => ({
  doc: null as unknown,
  mockDispatch: vi.fn(),
  mockTakeSnapshot: vi.fn(),
  mockPushStructuralUndo: vi.fn(),
  mockMoveLocalElement: vi.fn(async () => true),
  mockAcceptEditorCommands: vi.fn(async () => undefined),
  snapshot: { claimed: true },
}));

// fdd2d12f: the doc path commits through the durable gesture seam
// (acceptEditorCommands(doc, actions, claimSnapshot())), not useDispatch.
vi.mock('@/store/commandGesture', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store/commandGesture')>()),
  acceptEditorCommands: h.mockAcceptEditorCommands,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => h.mockDispatch,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useScopedYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
  useCurrentPageId: () => (h.doc as Y.Doc).getMap("meta").get("currentPageId"),
  useProjectId: () => (h.doc as Y.Doc).getMap("meta").get("projectId") ?? null,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    takeSnapshot: h.mockTakeSnapshot,
    claimSnapshot: () => h.snapshot,
    pushStructuralUndo: h.mockPushStructuralUndo,
  }),
}));

vi.mock('@/ai/AIContext', () => ({
  useAI: () => ({ activeKeys: [], recentlyTouchedKeys: [] }),
}));

vi.mock('@/context', () => ({
  useTool: () => ({ activeTool: 'select' }),
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({
  useLocalProjectPath: () => null,
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
    SparkleIcon: Stub,
  };
});

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: vi.fn() }),
}));

vi.mock('@/components/Editor/localStructuralOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Editor/localStructuralOps')>()),
  moveLocalElement: h.mockMoveLocalElement,
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

function buildDoc(projectId: string): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap('meta').set('currentPageId', PAGE_ID);
    doc.getMap('meta').set('projectId', projectId);
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

/** Seeds the scan AND arms the reparent drag (the iframe-exit drag state). */
function Seed({ elements, dragKey }: { elements: ScannedElement[]; dragKey: string }) {
  const { setScannedElements } = useScannedElements();
  const { setReparentDragKey } = useSelectionContext();
  useEffect(() => {
    setScannedElements(elements);
    setReparentDragKey(dragKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function renderTree(elements: ScannedElement[], dragKey: string) {
  return render(
    <SelectionProvider>
      <Seed elements={elements} dragKey={dragKey} />
      <DndContext>
        <ElementsTree />
      </DndContext>
    </SelectionProvider>,
  );
}

/** Hover the reparent overlay (jsdom zero-rects → first row, insert below it),
 *  then drop. With roots [SRC_A, SRC_B] this yields onDrop(null, 1). */
function dropOnZone(container: HTMLElement) {
  const overlay = container.querySelector('.cursor-crosshair');
  if (!overlay) throw new Error('reparent drop zone not rendered');
  fireEvent.mouseMove(overlay, { clientY: 10 });
  fireEvent.mouseUp(overlay);
}

describe('ElementsTree — reparent drop (iframe-exit drag) in the LOCAL runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.mockMoveLocalElement.mockResolvedValue(true);
  });

  it('source-keyed drop routes to moveLocalElement — NO doc REPARENT_ELEMENT, no snapshot', () => {
    h.doc = buildDoc('browser_lf_test');
    const { container } = renderTree([scanned(SRC_A, null), scanned(SRC_B, null)], SRC_A);
    dropOnZone(container);

    // onDrop(null, 1) → anchor before SRC_B (dragged key skipped by the planner)
    expect(h.mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith({
      key: SRC_A,
      targetKey: SRC_B,
      position: 'before',
      pushUndo: h.mockPushStructuralUndo,
      scannedByKey: expect.any(Map),
    });
    const dispatched = h.mockDispatch.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(dispatched).not.toContain('REPARENT_ELEMENT');
    expect(dispatched).not.toContain('SET_CHILD_ORDER');
    expect(h.mockAcceptEditorCommands).not.toHaveBeenCalled();
    expect(h.mockTakeSnapshot).not.toHaveBeenCalled();
  });

  it('non-local project keeps the doc REPARENT_ELEMENT path (pin)', () => {
    h.doc = buildDoc('browser_test');
    const { container } = renderTree([scanned(SRC_A, null), scanned(SRC_B, null)], SRC_A);
    dropOnZone(container);

    expect(h.mockMoveLocalElement).not.toHaveBeenCalled();
    expect(h.mockAcceptEditorCommands).toHaveBeenCalledExactlyOnceWith(
      h.doc,
      expect.arrayContaining([expect.objectContaining({ type: 'REPARENT_ELEMENT', elementKey: SRC_A })]),
      h.snapshot,
    );
    expect(h.mockTakeSnapshot).toHaveBeenCalled();
  });

  it('local drop of a DOC-BACKED (drawn) element keeps the doc path', () => {
    h.doc = buildDoc('browser_lf_test');
    const { container } = renderTree([scanned('el-drawn-1', null), scanned(SRC_B, null)], 'el-drawn-1');
    dropOnZone(container);

    expect(h.mockMoveLocalElement).not.toHaveBeenCalled();
    expect(h.mockAcceptEditorCommands).toHaveBeenCalledExactlyOnceWith(
      h.doc,
      expect.arrayContaining([expect.objectContaining({ type: 'REPARENT_ELEMENT', elementKey: 'el-drawn-1' })]),
      h.snapshot,
    );
  });
});
