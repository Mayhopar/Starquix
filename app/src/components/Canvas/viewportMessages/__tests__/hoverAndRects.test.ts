import { describe, it, expect } from 'vitest';
import {
  handleElementHover,
  handleElementHoverEnd,
  handleElementHovered,
  handleElementRect,
  handleElementRectResponse,
  handleRectUpdated,
  handleRectsUpdated,
} from '../hoverAndRects';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';

const rect = { top: 1, left: 2, width: 3, height: 4 };
const msg = (data: unknown) => new MessageEvent('message', { data });

describe('hoverAndRects handlers', () => {
  it('ELEMENT_HOVER sets hovered rect + key/tagName', () => {
    const ctx = makeFakeCtx();
    handleElementHover(ctx, { rect, key: 'k1', tagName: 'img' });
    expect(ctx.actions.setHoveredRect).toHaveBeenCalledWith({ rect, key: 'k1', tagName: 'img' });
  });

  it('ELEMENT_HOVER_END clears hovered rect', () => {
    const ctx = makeFakeCtx();
    handleElementHoverEnd(ctx);
    expect(ctx.actions.setHoveredRect).toHaveBeenCalledWith(null);
  });

  it('ELEMENT_HOVERED (legacy) reads rect from event.data, defaults to null', () => {
    const ctx = makeFakeCtx();
    handleElementHovered(ctx, undefined, msg({ type: 'ELEMENT_HOVERED', rect }));
    expect(ctx.actions.setHoveredRect).toHaveBeenCalledWith({ rect });
    handleElementHovered(ctx, undefined, msg({ type: 'ELEMENT_HOVERED' }));
    expect(ctx.actions.setHoveredRect).toHaveBeenLastCalledWith(null);
  });

  it('ELEMENT_RECT (legacy) updates selection rect only for the selected element', () => {
    const ctx = makeFakeCtx({ refs: { selectedElementId: { current: 'el-1' } } });
    handleElementRect(ctx, undefined, msg({ type: 'ELEMENT_RECT', elementId: 'el-2', rect }));
    expect(ctx.actions.updateSelectionRect).not.toHaveBeenCalled();
    handleElementRect(ctx, undefined, msg({ type: 'ELEMENT_RECT', elementId: 'el-1', rect }));
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(rect);
  });

  it('ELEMENT_RECT_RESPONSE updates selection rect for selected key and hover for AI highlight key', () => {
    const ctx = makeFakeCtx({
      refs: { selectedKey: { current: 'k1' }, aiHighlightKey: { current: 'k2' } },
    });
    handleElementRectResponse(ctx, { key: 'k1', rect });
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(rect);
    expect(ctx.actions.setHoveredRect).not.toHaveBeenCalled();
    handleElementRectResponse(ctx, { key: 'k2', rect });
    expect(ctx.actions.setHoveredRect).toHaveBeenCalledWith({ rect, key: 'k2' });
  });

  it('RECT_UPDATED updates selection rect and fires pending grid refresh', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({
      // selectedKey must match: non-selected rect updates no longer move the
      // selection overlay (rectGuard.test.ts pins the guard).
      refs: { iframe, pendingGridRefreshKey: { current: 'k1' }, selectedKey: { current: 'k1' } },
    });
    handleRectUpdated(ctx, { key: 'k1', rect });
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(rect);
    expect(ctx.refs.pendingGridRefreshKey.current).toBeNull();
    expect(postMessage).toHaveBeenCalledWith(
      { type: 'REQUEST_GRID_GEOMETRY', payload: { key: 'k1' } }, '*',
    );
  });

  it('RECT_UPDATED without pending grid refresh does not post', () => {
    const { iframe, postMessage } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe, pendingGridRefreshKey: { current: null } } });
    handleRectUpdated(ctx, { key: 'k1', rect });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('RECTS_UPDATED forwards rects and syncs selected rect', () => {
    const ctx = makeFakeCtx({ refs: { selectedKey: { current: 'k2' } } });
    const rects = [
      { key: 'k1', rect: { ...rect, top: 9 } },
      { key: 'k2', rect },
    ];
    handleRectsUpdated(ctx, { rects });
    expect(ctx.actions.updateScannedElementRects).toHaveBeenCalledWith(rects);
    expect(ctx.actions.updateSelectionRect).toHaveBeenCalledWith(rect);
  });
});
