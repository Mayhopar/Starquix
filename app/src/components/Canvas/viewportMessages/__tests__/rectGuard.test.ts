/**
 * Regression (2026-07-24): RECT_UPDATED for a NON-selected key moved the
 * selection overlay — class-sync bursts (override re-apply touches every
 * overridden selector) snapped the selection box to whichever element
 * reported last (seen live as a misaligned box after selecting an svg).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeFakeCtx } from './fakeContext';
import { handleRectUpdated } from '../hoverAndRects';

const RECT = { top: 10, left: 10, width: 96, height: 96 };

describe('handleRectUpdated selection-key guard', () => {
  it('updates the selection rect when the key matches the selection', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'el-1:svg-0' } } });
    handleRectUpdated(ctx, { key: 'el-1:svg-0', rect: RECT });
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(RECT);
  });

  it('ignores rect updates for other keys', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'el-1:svg-0' } } });
    handleRectUpdated(ctx, { key: 'el-1:h3-0', rect: { top: 200, left: 0, width: 400, height: 40 } });
    expect(ctx.actions.updateSelectionRect).not.toHaveBeenCalled();
  });

  it('keyless payloads keep legacy behavior (still update)', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'el-1:svg-0' } } });
    handleRectUpdated(ctx, { rect: RECT });
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(RECT);
  });

  it('matching key still triggers the pending grid refresh', () => {
    const ctx = makeFakeCtx({
      refs: {
        selectedKey: { current: 'el-1:svg-0' },
        pendingGridRefreshKey: { current: 'el-1:svg-0' },
        iframe: { current: { contentWindow: { postMessage: vi.fn() } } as unknown as HTMLIFrameElement },
      },
    });
    handleRectUpdated(ctx, { key: 'el-1:svg-0', rect: RECT });
    expect(ctx.refs.pendingGridRefreshKey.current).toBeNull();
  });
});
