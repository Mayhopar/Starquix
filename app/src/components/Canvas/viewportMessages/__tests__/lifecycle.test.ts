import { describe, it, expect, vi } from 'vitest';
import { handleReady, handleIframeReady, handleAssetsOwned, handleContentHeight, handlePageChanged } from '../lifecycle';
import { makeFakeCtx, makeFakeIframe } from './fakeContext';
import { viteClassWriter } from '@/services/ViteClassWriter';

vi.mock('@/services/ViteClassWriter', () => ({ viteClassWriter: { setIframeRef: vi.fn() } }));
vi.mock('@/services/ViteTextWriter', () => ({ viteTextWriter: { setIframeRef: vi.fn() } }));
vi.mock('@/services/ViteImageWriter', () => ({ viteImageWriter: { setIframeRef: vi.fn() } }));
vi.mock('@/db', () => ({ db: { assets: { where: vi.fn() } } }));

describe('READY', () => {
  it('marks the legacy ready ref', () => {
    const ctx = makeFakeCtx();
    handleReady(ctx);
    expect(ctx.refs.isReady.current).toBe(true);
  });
});

describe('IFRAME_READY', () => {
  it('without an iframe does nothing', () => {
    const ctx = makeFakeCtx();
    handleIframeReady(ctx);
    expect(ctx.actions.setIsIframeReady).not.toHaveBeenCalled();
  });

  it('sets writer refs and opens the ready gate', () => {
    const { iframe } = makeFakeIframe();
    const ctx = makeFakeCtx({
      refs: { iframe },
    });
    handleIframeReady(ctx);
    expect(viteClassWriter.setIframeRef).toHaveBeenCalledWith(iframe.current);
    // isIframeReady is a monotonic gate — it must never be flipped back to
    // false (the false→true re-flip coalesced into a no-op and was the
    // 2026-07-24 blank-canvas bug).
    expect(ctx.actions.setIsIframeReady).toHaveBeenCalledExactlyOnceWith(true);
  });

  // Regression (2026-07-24, server-mode blank canvas): on a RELOAD the ready
  // state is already true, so a boolean flip cannot re-fire any effect — the
  // RENDER effect never re-ran and content generated before the reload stayed
  // off the canvas ("page is there but empty"). Every reload must signal the
  // iframeReloaded EDGE (reloadCount bump + RENDER force-arm), which fires
  // the RENDER, SET_MODE, theme, and grid-probe effects regardless of gate
  // state.
  it('signals the iframeReloaded edge on every (re)load', () => {
    const { iframe } = makeFakeIframe();
    const ctx = makeFakeCtx({
      refs: { iframe },
    });
    handleIframeReady(ctx);
    expect(ctx.actions.iframeReloaded).toHaveBeenCalledTimes(1);
  });

  // Regression: a real iframe (re)load (e.g. server-mode astro dev full-reload
  // after a .astro write) destroys any in-iframe text-edit session, so the
  // bridge's EXIT_EDIT_MODE never arrives. If the parent's isEditingText flag
  // stays true, the RENDER effect early-returns forever and the fresh (empty)
  // shell never gets components — blank canvas until a full editor reload.
  it('clears a stuck text-edit session on reload', () => {
    const { iframe } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe, isEditingText: { current: true } } });
    handleIframeReady(ctx);
    expect(ctx.actions.exitEditMode).toHaveBeenCalled();
  });

  it('does not touch edit mode when no session is active', () => {
    const { iframe } = makeFakeIframe();
    const ctx = makeFakeCtx({ refs: { iframe, isEditingText: { current: false } } });
    handleIframeReady(ctx);
    expect(ctx.actions.exitEditMode).not.toHaveBeenCalled();
  });
});

describe('ASSETS_OWNED (task-120)', () => {
  it('relays the owned ids as a sq:assets-owned window event', () => {
    const ctx = makeFakeCtx();
    const seen: string[][] = [];
    const listener = (e: Event) => seen.push((e as CustomEvent<{ ids: string[] }>).detail.ids);
    window.addEventListener('sq:assets-owned', listener);
    handleAssetsOwned(ctx, { ids: ['a1', 'a2'] });
    window.removeEventListener('sq:assets-owned', listener);
    expect(seen).toEqual([['a1', 'a2']]);
  });

  it('tolerates a missing payload', () => {
    const ctx = makeFakeCtx();
    expect(() => handleAssetsOwned(ctx, null)).not.toThrow();
  });
});

describe('CONTENT_HEIGHT', () => {
  it('sets content height', () => {
    const ctx = makeFakeCtx();
    handleContentHeight(ctx, { height: 900 });
    expect(ctx.actions.setContentHeight).toHaveBeenCalledWith(900, { height: 900 });
  });
});

describe('PAGE_CHANGED', () => {
  it('clears selection and hover', () => {
    const ctx = makeFakeCtx();
    handlePageChanged(ctx);
    expect(ctx.actions.clearSelection).toHaveBeenCalled();
    expect(ctx.actions.setHoveredRect).toHaveBeenCalledWith(null);
  });
});
