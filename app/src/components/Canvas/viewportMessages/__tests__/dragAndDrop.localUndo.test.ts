/**
 * Regression (wave-1 blocked follow-up, gap: canvas-drag local moves not
 * ⌘Z-able): moveLocalElement records its inverse via pushUndo — but the
 * canvas drag path passed NO pushUndo, so local flow-reorder / reparent drags
 * were the only structural ops without undo (Layers/gutter had it). The
 * ViewportMessageContext now carries pushStructuralUndo and both dragAndDrop
 * call sites forward it.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';

vi.mock('react-hot-toast', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: toast };
});
const { mockMoveLocalElement } = vi.hoisted(() => ({
  mockMoveLocalElement: vi.fn(async () => true),
}));
vi.mock('@/components/Editor/localStructuralOps', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/Editor/localStructuralOps')>()),
  moveLocalElement: mockMoveLocalElement,
}));

import { handleDragElementDrop } from '../dragAndDrop';
import { makeFakeCtx } from './fakeContext';

const SRC1 = 'src/pages/index.astro:8:3';
const SRC2 = 'src/pages/index.astro:15:3';

const localDoc = () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', 'browser_lf_abc');
  return doc;
};

describe('DRAG_ELEMENT_DROP — local moves carry pushStructuralUndo', () => {
  it('flow reorder forwards ctx.actions.pushStructuralUndo as pushUndo', async () => {
    vi.clearAllMocks();
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: [{ key: SRC1, parentKey: null }, { key: SRC2, parentKey: null }] as never },
      },
      env: { doc: localDoc() },
    });
    handleDragElementDrop(ctx, { cancelled: false, key: SRC1, insertIndex: 1 });
    await Promise.resolve();
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: SRC1, pushUndo: ctx.actions.pushStructuralUndo }),
    );
  });

  it('reparent drop forwards ctx.actions.pushStructuralUndo as pushUndo', () => {
    vi.clearAllMocks();
    const ctx = makeFakeCtx({
      refs: {
        currentPageId: { current: 'page-1' },
        scannedElements: { current: [{ key: SRC1, parentKey: null }, { key: SRC2, parentKey: null }] as never },
      },
      env: { doc: localDoc() },
    });
    handleDragElementDrop(ctx, {
      cancelled: false, reparented: true, key: SRC1, newParentKey: SRC2, insertIndex: 0,
    });
    expect(mockMoveLocalElement).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ key: SRC1, pushUndo: ctx.actions.pushStructuralUndo }),
    );
  });
});
