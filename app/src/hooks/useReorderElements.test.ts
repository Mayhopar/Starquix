// app/src/hooks/useReorderElements.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useReorderElements } from './useReorderElements';

// Every editor command the hook hands to durable acceptance is recorded here
// (fdd2d12f: the hook no longer dispatches — it calls acceptEditorCommands).
const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
const mockClaimSnapshot = vi.fn(() => undefined);
const mockCreateSnapshot = vi.fn(() => ({ sourceClasses: {}, pageOrder: {} }));
const testDoc = new Y.Doc();

// Mock store hooks
vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => testDoc,
  useYjsValue: () => 'test-page-id', // Mock currentPageId
}));

vi.mock('@/store/commandGesture', () => ({
  acceptEditorCommands: vi.fn(async (_doc: unknown, commands: unknown[]) => {
    for (const command of commands) mockDispatch(command);
    return { ok: true };
  }),
}));

vi.mock('@/utils/masterOrderWrite', () => ({
  collectOrderCommands: vi.fn(() => []),
}));

// Mock UndoContext
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({
    takeSnapshot: mockTakeSnapshot,
    claimSnapshot: mockClaimSnapshot,
    createSnapshot: mockCreateSnapshot,
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
  }),
}));

// Mock SelectionContext
const mockScannedElements = [
  {
    key: 'elem-1:1:1',
    parentKey: null,
    hasSourceTracking: true,
    tagName: 'section',
    classes: '',
    rect: { top: 0, left: 0, width: 100, height: 100 },
  },
  {
    key: 'elem-2:1:1',
    parentKey: null,
    hasSourceTracking: true,
    tagName: 'section',
    classes: '',
    rect: { top: 100, left: 0, width: 100, height: 100 },
  },
  {
    key: 'elem-3:1:1',
    parentKey: null,
    hasSourceTracking: true,
    tagName: 'section',
    classes: '',
    rect: { top: 200, left: 0, width: 100, height: 100 },
  },
];

vi.mock('@/context/SelectionContext', () => ({
  useScannedElements: vi.fn(() => ({
    scannedElements: mockScannedElements,
    setScannedElements: vi.fn(),
    updateScannedElementRects: vi.fn(),
  })),
}));

describe('useReorderElements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTakeSnapshot.mockClear();
    mockCreateSnapshot.mockClear();
  });

  it('returns root elements filtered from scanned elements', () => {
    const { result } = renderHook(() => useReorderElements());

    expect(result.current.rootElements).toHaveLength(3);
    expect(result.current.rootElements[0].key).toBe('elem-1:1:1');
  });

  it('can find elements by key for drag operations', () => {
    const { result } = renderHook(() => useReorderElements());

    // Simulate what Editor.handleDragEnd does
    const activeKey = 'elem-1:1:1';
    const overKey = 'elem-3:1:1';

    const oldIndex = result.current.rootElements.findIndex((el) => el.key === activeKey);
    const newIndex = result.current.rootElements.findIndex((el) => el.key === overKey);

    expect(oldIndex).toBe(0);
    expect(newIndex).toBe(2);
  });

  it('dispatches REORDER_PAGE_ELEMENTS when reordering', async () => {
    const { result } = renderHook(() => useReorderElements());

    await act(async () => {
      await result.current.reorderRootElements(0, 2);
    });

    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'test-page-id',
      elementIds: ['elem-2:1:1', 'elem-3:1:1', 'elem-1:1:1'],
    });
  });

  it('does not dispatch when oldIndex equals newIndex', async () => {
    const { result } = renderHook(() => useReorderElements());

    await act(async () => {
      await result.current.reorderRootElements(1, 1);
    });

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('extracts element IDs correctly from keys with colons', async () => {
    const { result } = renderHook(() => useReorderElements());

    // Move elem-1 to position 1 (after elem-2)
    await act(async () => {
      await result.current.reorderRootElements(0, 1);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'test-page-id',
      elementIds: ['elem-2:1:1', 'elem-1:1:1', 'elem-3:1:1'],
    });
  });
});

describe('useReorderElements - auto-unwrap infrastructure container', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns children when single root is Astro page container', async () => {
    // Simulate the #sq-components div that Astro adds source tracking to
    const elementsWithContainer = [
      {
        key: 'src/pages/preview/[projectId]/[pageId].astro:7:27',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'div',
        classes: '',
        rect: { top: 0, left: 0, width: 800, height: 1000 },
      },
      {
        key: 'el-section-1:1:1',
        parentKey: 'src/pages/preview/[projectId]/[pageId].astro:7:27',
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 0, left: 0, width: 800, height: 400 },
      },
      {
        key: 'el-section-2:1:1',
        parentKey: 'src/pages/preview/[projectId]/[pageId].astro:7:27',
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 400, left: 0, width: 800, height: 400 },
      },
    ];

    // Override the mock for this test
    const { useScannedElements } = await import('@/context/SelectionContext');
    vi.mocked(useScannedElements).mockReturnValue({
      scannedElements: elementsWithContainer,
      setScannedElements: vi.fn(),
      updateScannedElementRects: vi.fn(),
    });

    const { result } = renderHook(() => useReorderElements());

    // Should return the sections (children), not the container div
    expect(result.current.rootElements).toHaveLength(2);
    expect(result.current.rootElements[0].tagName).toBe('section');
    expect(result.current.rootElements[1].tagName).toBe('section');
  });
});

describe('useReorderElements within same container', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockTakeSnapshot.mockClear();
    mockCreateSnapshot.mockClear();

    // Reset the mock to use the original scannedElements
    const { useScannedElements } = await import('@/context/SelectionContext');
    vi.mocked(useScannedElements).mockReturnValue({
      scannedElements: mockScannedElements,
      setScannedElements: vi.fn(),
      updateScannedElementRects: vi.fn(),
    });
  });

  it('reorders element from end to beginning', async () => {
    const { result } = renderHook(() => useReorderElements());

    // Move last element (index 2) to first position (index 0)
    await act(async () => {
      await result.current.reorderRootElements(2, 0);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'test-page-id',
      elementIds: ['elem-3:1:1', 'elem-1:1:1', 'elem-2:1:1'],
    });
  });

  it('reorders element from beginning to end', async () => {
    const { result } = renderHook(() => useReorderElements());

    // Move first element (index 0) to last position (index 2)
    await act(async () => {
      await result.current.reorderRootElements(0, 2);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'REORDER_PAGE_ELEMENTS',
      pageId: 'test-page-id',
      elementIds: ['elem-2:1:1', 'elem-3:1:1', 'elem-1:1:1'],
    });
  });

  it('handles single element reorder (no-op)', async () => {
    const { result } = renderHook(() => useReorderElements());

    // Try to reorder element to same position
    await act(async () => {
      await result.current.reorderRootElements(1, 1);
    });

    // Should not dispatch when indices are the same
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});

describe('useReorderElements takes snapshot for undo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTakeSnapshot.mockClear();
  });

  it('calls takeSnapshot before reordering', async () => {
    const { result } = renderHook(() => useReorderElements());

    await act(async () => {
      await result.current.reorderRootElements(0, 2);
    });

    // takeSnapshot should be called before dispatch
    expect(mockTakeSnapshot).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalled();

    // Verify takeSnapshot was called first
    const takeSnapshotCallOrder = mockTakeSnapshot.mock.invocationCallOrder[0];
    const dispatchCallOrder = mockDispatch.mock.invocationCallOrder[0];
    expect(takeSnapshotCallOrder).toBeLessThan(dispatchCallOrder);
  });
});

describe('useReorderElements - reducer rejects source-keyed parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTakeSnapshot.mockClear();
  });

  it('hook still calls dispatch, but reducer would reject a source-keyed parentKey', async () => {
    // This test documents the end-to-end contract: the hook is intentionally
    // unaware of the source-key constraint, but the reducer guard in
    // commands.ts SET_CHILD_ORDER must refuse such keys. We assert the action
    // shape the hook produces so a future change that silently rewrites the
    // parentKey at this layer surfaces immediately.
    const { result } = renderHook(() => useReorderElements());
    const bogusParent = 'src/pages/preview/[projectId]/[pageId].astro:7:27';

    await act(async () => {
      await result.current.reorderChildElements(bogusParent, ['el-a:section-0', 'el-b:section-0']);
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SET_CHILD_ORDER',
        parentKey: bogusParent,
      }),
    );
    // The reducer (not the hook) is the layer that rejects this. See
    // commands-comprehensive.test.ts: "rejects SET_CHILD_ORDER when parentKey
    // parses as a source location".
  });
});
