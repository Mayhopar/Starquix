/**
 * Parity gap 25/58 — local preview link navigation must move the editor's
 * active page.
 *
 * In local mode the bridge lets the browser navigate natively and (with this
 * fix) still sends PREVIEW_NAVIGATE with the destination pathname. The parent
 * maps that route to the doc page id with localPageId — THE derivation the doc
 * seeding used (useProjectSync) — and drives the SAME setActivePage path the
 * sidebar uses. Without it the doc kept naming page A while the iframe showed
 * page B, and the task-133 wrong-file guard refused every structural op.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handlePreviewNavigate } from '../previewNavigation';
import { makeFakeCtx } from './fakeContext';
import type { PageData } from '@/store/types';

/** Local seeded pages: id = localPageId(route), name = route. */
function localPage(id: string, route: string): PageData {
  return { id, name: route, rootElementIds: [], children: [] } as unknown as PageData;
}

const LOCAL_PAGES: PageData[] = [
  localPage('index', '/'),
  localPage('about', '/about'),
  localPage('works-timepad-redesign', '/works/timepad-redesign'),
];

function localCtx(overrides: { currentPageId?: string | null } = {}) {
  return makeFakeCtx({
    env: { projectId: 'browser_lf_abc123', pages: LOCAL_PAGES },
    refs: { currentPageId: { current: overrides.currentPageId ?? 'index' } },
  });
}

afterEach(() => vi.restoreAllMocks());

describe('PREVIEW_NAVIGATE in local mode (gap 25/58)', () => {
  it('selects the page whose localPageId matches the navigated route', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('about');
  });

  it('resolves the root route to the index page', () => {
    const ctx = localCtx({ currentPageId: 'about' });
    handlePreviewNavigate(ctx, { href: '/' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('index');
  });

  it('resolves a seeded dynamic-instance route', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, { href: '/works/timepad-redesign' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('works-timepad-redesign');
  });

  it('tolerates a trailing slash', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, { href: '/about/' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('about');
  });

  it('loop guard: a route already active never re-selects (no SET_PAGE churn)', () => {
    const ctx = localCtx({ currentPageId: 'about' });
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  });

  it('warns and stays inert for a route no doc page knows', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = localCtx();

    handlePreviewNavigate(ctx, { href: '/nope' });

    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/nope'));
  });

  it('never routes through findPageByHref (WC path) — local ids are route-derived', () => {
    // A WC-shaped page whose slugified name would match must NOT hijack the
    // local resolution: only the localPageId identity counts.
    const pages = [
      ...LOCAL_PAGES,
      { id: 'p-wc', name: 'About', rootElementIds: [], children: [] } as unknown as PageData,
    ];
    const ctx = makeFakeCtx({
      env: { projectId: 'browser_lf_abc123', pages },
      refs: { currentPageId: { current: 'index' } },
    });
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('about');
  });

  it('a missing href payload is ignored', () => {
    const ctx = localCtx();
    handlePreviewNavigate(ctx, {});
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
    expect(ctx.actions.goToPost).not.toHaveBeenCalled();
  });
});

describe('WC path unchanged when projectId is not local', () => {
  it('still resolves via findPageByHref for a browser_ project', () => {
    const pages: PageData[] = [
      { id: 'p-home', name: 'Home', rootElementIds: [], children: [], isHome: true } as unknown as PageData,
      { id: 'p-about', name: 'About', rootElementIds: [], children: [] } as unknown as PageData,
    ];
    const ctx = makeFakeCtx({ env: { projectId: 'browser_test', pages } });
    handlePreviewNavigate(ctx, { href: '/about' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('p-about');
  });
});


it('marks known native adoption before the sole editor action, including canonical self-links', () => {
  const ctx = localCtx();
  const adopt = vi.fn();
  handlePreviewNavigate(ctx, { href: '/about/?q=1' }, undefined, adopt);
  expect(adopt).toHaveBeenCalledWith('/about');
  expect(adopt.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ctx.actions.setActivePage).mock.invocationCallOrder[0]);
  const same = localCtx({ currentPageId: 'about' });
  handlePreviewNavigate(same, { href: '/about/?q=2' }, undefined, adopt);
  expect(adopt).toHaveBeenCalledTimes(2);
  expect(same.actions.setActivePage).not.toHaveBeenCalled();
});

it('does not grant adoption identity to an undiscovered route', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const ctx = localCtx();
  const adopt = vi.fn();
  handlePreviewNavigate(ctx, { href: '/later' }, undefined, adopt);
  expect(adopt).not.toHaveBeenCalled();
  expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('/later'));
});
