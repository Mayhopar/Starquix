/**
 * task-133 Task 10 sweep: hook-level wiring tests for useLayersDrag's LOCAL
 * branch (the Task 6 review gap) — drop zone → structural position →
 * moveLocalElement, with the doc path never dispatched — plus the honest
 * mixed-drag (drawn ↔ source row) gate.
 *
 * The routing predicates (isSourceKeyedElementKey, layersZoneToStructuralPosition)
 * stay REAL; only the write op itself is mocked (useKeyboardShortcuts
 * integration-test pattern).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DragEndEvent } from '@dnd-kit/core';

const {
  mockDispatch,
  mockTakeSnapshot,
  mockPushStructuralUndo,
  mockMoveLocalElement,
  mockToast,
  mockReorderRootElementsByKeys,
  mockReorderChildElements,
  projectIdRef,
} = vi.hoisted(() => ({
  mockDispatch: vi.fn(() => true),
  mockTakeSnapshot: vi.fn(),
  mockPushStructuralUndo: vi.fn(),
  mockMoveLocalElement: vi.fn(async () => true),
  mockToast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
  mockReorderRootElementsByKeys: vi.fn(),
  mockReorderChildElements: vi.fn(),
  projectIdRef: { current: 'browser_lf_test-project' },
}));

vi.mock('@/store', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => 'page-1',
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => ({}),
}));

vi.mock('@/store/selectors', () => ({
  selectCurrentPageId: vi.fn(),
  selectProjectId: () => projectIdRef.current,
}));

vi.mock('@/hooks', () => ({
  useReorderElements: () => ({
    rootElements: [],
    reorderRootElementsByKeys: mockReorderRootElementsByKeys,
    reorderChildElements: mockReorderChildElements,
  }),
}));

vi.mock('@/context/SelectionContext', () => ({
  // task-148 item 7: the real context also exposes scannedByKeyRef, which the
  // drag path now forwards to moveLocalElement for the usage re-target. An
  // empty map means "no re-target", i.e. these cases behave as they always did.
  useScannedElementsRef: () => ({
    scannedElementsRef: { current: [] },
    scannedByKeyRef: { current: new Map() },
  }),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    takeSnapshot: mockTakeSnapshot,
    pushStructuralUndo: mockPushStructuralUndo,
  }),
}));

vi.mock('react-hot-toast', () => ({ default: mockToast }));

vi.mock('@/components/Editor/localStructuralOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Editor/localStructuralOps')>()),
  moveLocalElement: mockMoveLocalElement,
}));

import { useLayersDrag } from '../useLayersDrag';
import { LOCAL_MIXED_DRAG_BLOCKED, LOCAL_GROUP_BLOCKED } from '../localStructuralOps';
import { DRAG_TYPES } from '@/types/drag';

const SRC_A = 'src/pages/index.astro:8:3';
const SRC_B = 'src/pages/index.astro:14:3';
const DRAWN = 'el-drawn-123';

/** Minimal DragEndEvent for the LAYERS_PANEL path. relY defaults to 0.5 → 'inside' zone (no row snapshot). */
function dragEnd(
  activeKey: string,
  overKey: string,
  overNode?: { tagName?: string; children?: unknown[] },
  activeData: Record<string, unknown> = {},
): DragEndEvent {
  return {
    active: { id: activeKey, data: { current: { type: DRAG_TYPES.LAYERS_PANEL, ...activeData } } },
    over: { id: overKey, data: { current: { node: overNode } } },
    activatorEvent: { clientY: 0 },
    delta: { x: 0, y: 0 },
  } as unknown as DragEndEvent;
}

describe('useLayersDrag — local runtime branch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectIdRef.current = 'browser_lf_test-project';
    mockMoveLocalElement.mockResolvedValue(true);
  });

  it('source-keyed drop on a container row wires zone→inside-end→moveLocalElement, no doc dispatch', async () => {
    const onReorderPending = vi.fn();
    const { result } = renderHook(() => useLayersDrag({ onReorderPending }));
    await act(async () => {
      result.current.onDragEnd(dragEnd(SRC_A, SRC_B, { tagName: 'section', children: [{}] }));
    });
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith({
      key: SRC_A,
      targetKey: SRC_B,
      position: 'inside-end',
      pushUndo: mockPushStructuralUndo,
      // task-148 item 7: the scan tree rides along so the op can re-target a
      // component root to its `<Component />` usage tag.
      scannedByKey: new Map(),
    });
    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
    expect(onReorderPending).toHaveBeenCalledTimes(1); // after the resolved write
  });

  it('inside-zone drop on a LEAF row demotes to position:after (layersZoneToStructuralPosition)', async () => {
    const { result } = renderHook(() => useLayersDrag());
    await act(async () => {
      result.current.onDragEnd(dragEnd(SRC_A, SRC_B, { tagName: 'img', children: [] }));
    });
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ position: 'after' }),
    );
  });

  it('failed write → no onReorderPending', async () => {
    mockMoveLocalElement.mockResolvedValue(false);
    const onReorderPending = vi.fn();
    const { result } = renderHook(() => useLayersDrag({ onReorderPending }));
    await act(async () => {
      result.current.onDragEnd(dragEnd(SRC_A, SRC_B, { tagName: 'section', children: [{}] }));
    });
    expect(onReorderPending).not.toHaveBeenCalled();
  });

  // Task 10 sweep fix: the mixed drag used to fall into moveLocalElement and
  // toast the misleading "no source location" copy.
  it('drawn row dragged over a source row → honest mixed-drag toast, no write, no dispatch', async () => {
    const { result } = renderHook(() => useLayersDrag());
    await act(async () => {
      result.current.onDragEnd(dragEnd(DRAWN, SRC_B, { tagName: 'section', children: [{}] }));
    });
    expect(mockToast).toHaveBeenCalledExactlyOnceWith(LOCAL_MIXED_DRAG_BLOCKED);
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('source row dragged over a drawn row → same honest gate', async () => {
    const { result } = renderHook(() => useLayersDrag());
    await act(async () => {
      result.current.onDragEnd(dragEnd(SRC_A, DRAWN, { tagName: 'div', children: [] }));
    });
    expect(mockToast).toHaveBeenCalledExactlyOnceWith(LOCAL_MIXED_DRAG_BLOCKED);
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
  });

  it('group drag containing a source-keyed member stays blocked with the group toast', async () => {
    const { result } = renderHook(() => useLayersDrag());
    await act(async () => {
      result.current.onDragEnd(
        dragEnd(SRC_A, SRC_B, { tagName: 'section', children: [{}] }, { groupKeys: [SRC_A, SRC_B] }),
      );
    });
    expect(mockToast).toHaveBeenCalledExactlyOnceWith(LOCAL_GROUP_BLOCKED);
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
  });

  it('non-local project never routes source-keyed rows to the writer (pin)', async () => {
    projectIdRef.current = 'browser_test-project';
    const { result } = renderHook(() => useLayersDrag());
    await act(async () => {
      result.current.onDragEnd(dragEnd(SRC_A, SRC_B, { tagName: 'section', children: [{}] }));
    });
    expect(mockMoveLocalElement).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalledWith(LOCAL_MIXED_DRAG_BLOCKED);
  });
});
