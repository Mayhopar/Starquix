/**
 * Finding 29 — the local PREVIEW_NAVIGATE announce must record the natively-
 * reached route in localNativeRoute BEFORE driving setActivePage, so
 * ViewportFrame's src render can skip the attribute re-set for that route
 * (one link click = one document load). The marker is a statement about the
 * frame's LOCATION, so it is recorded even when the editor stays put
 * (self-link, unmappable route). WC/server announces never touch it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handlePreviewNavigate } from '../previewNavigation';
import { localNativeRoute } from '../../previewSrc';
import { makeFakeCtx } from './fakeContext';
import type { PageData } from '@/store/types';

function localPage(id: string, route: string): PageData {
  return { id, name: route, rootElementIds: [], children: [] } as unknown as PageData;
}

const LOCAL_PAGES: PageData[] = [
  localPage('index', '/'),
  localPage('about', '/about'),
];

function localCtx(overrides: { currentPageId?: string | null } = {}) {
  return makeFakeCtx({
    env: { projectId: 'browser_lf_abc123', pages: LOCAL_PAGES },
    refs: { currentPageId: { current: overrides.currentPageId ?? 'index' } },
  });
}

beforeEach(() => { localNativeRoute.current = null; });
afterEach(() => {
  localNativeRoute.current = null;
  vi.restoreAllMocks();
});

describe('PREVIEW_NAVIGATE records the native route (finding 29)', () => {
  it('records the normalized route and still drives setActivePage', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(localNativeRoute.current).toBe('/about');
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('about');
  });

  it('normalizes the href (trailing slash) before recording', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, { href: '/about/' });
    expect(localNativeRoute.current).toBe('/about');
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('about');
  });

  it('records for a self-link even though the page switch is dropped', () => {
    const ctx = localCtx({ currentPageId: 'about' });
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(localNativeRoute.current).toBe('/about');
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  });

  it('records for an unmappable route (the frame really is there; the editor honestly stays put)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = localCtx();
    handlePreviewNavigate(ctx, { href: '/no-such-page' });
    expect(localNativeRoute.current).toBe('/no-such-page');
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  });

  it('never touches the marker for a non-local project', () => {
    const ctx = makeFakeCtx({
      env: { projectId: 'browser_p1', pages: LOCAL_PAGES },
      refs: { currentPageId: { current: 'index' } },
    });
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(localNativeRoute.current).toBeNull();
  });

  it('never touches the marker when the payload has no href', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, {});
    expect(localNativeRoute.current).toBeNull();
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  });
});
