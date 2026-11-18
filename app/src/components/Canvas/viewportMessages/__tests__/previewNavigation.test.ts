import { describe, it, expect, vi, afterEach } from 'vitest';
import * as Y from 'yjs';
import { handlePreviewNavigate } from '../previewNavigation';
import { makeFakeCtx } from './fakeContext';
import type { PageData } from '@/store/types';

function page(id: string, name: string, extra: Partial<PageData> = {}): PageData {
  return { id, name, rootElementIds: [], children: [], ...extra };
}

const PAGES: PageData[] = [
  page('p-home', 'Home', { isHome: true }),
  page('p-about', 'About'),
];

afterEach(() => vi.restoreAllMocks());

describe('PREVIEW_NAVIGATE', () => {
  it('switches to the matching page via the existing page-switch path', () => {
    const ctx = makeFakeCtx({ env: { pages: PAGES } });
    handlePreviewNavigate(ctx, { href: '/about' });
    // setActivePage is what the sidebar calls — the RENDER pipeline repaints
    // the iframe from there, so preview adds no new render path.
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('p-about');
  });

  it('resolves the home route', () => {
    const ctx = makeFakeCtx({ env: { pages: PAGES } });
    handlePreviewNavigate(ctx, { href: '/' });
    expect(ctx.actions.setActivePage).toHaveBeenCalledWith('p-home');
  });

  it('leaves an unmatched href inert and warns — no 404, no toast', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeFakeCtx({ env: { pages: PAGES } });

    handlePreviewNavigate(ctx, { href: '/nope' });

    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/nope'));
  });

  it.each([
    ['missing href', {}],
    ['empty href', { href: '' }],
    ['null payload', null],
  ])('ignores a %s payload', (_label, payload) => {
    const ctx = makeFakeCtx({ env: { pages: PAGES } });
    handlePreviewNavigate(ctx, payload);
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  });
});

/**
 * REGRESSION (found live, 2026-07-24): blog cards were dead in preview — the
 * card anchor's href is the published post route, which findPageByHref cannot
 * match (posts are slug-driven). The bridge sends { postSlug, slotKey }
 * instead; the handler resolves the slot's collection and drives the same
 * go-to-post path the sidebar uses.
 */
describe('PREVIEW_NAVIGATE blog-card (postSlug + slotKey)', () => {
  function docWithBinding(slotKey: string, collectionId: string): Y.Doc {
    const doc = new Y.Doc();
    const ySlot = new Y.Map<unknown>();
    ySlot.set('collectionId', collectionId);
    doc.getMap('blogSlotBindings').set(slotKey, ySlot);
    return doc;
  }

  it('resolves the slot binding and calls goToPost with collectionId + slug', () => {
    const doc = docWithBinding('el-slot1', 'col-1');
    const ctx = makeFakeCtx({ env: { doc, pages: PAGES } });

    handlePreviewNavigate(ctx, { postSlug: 'my-post', slotKey: 'el-slot1' });

    expect(ctx.actions.goToPost).toHaveBeenCalledWith('col-1', 'my-post');
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled(); // goToPost owns the page switch
  });

  it('warns and stays inert for an unbound slot', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = docWithBinding('el-slot1', '__defaults'); // UNBOUND_COLLECTION_ID
    const ctx = makeFakeCtx({ env: { doc, pages: PAGES } });

    handlePreviewNavigate(ctx, { postSlug: 'my-post', slotKey: 'el-slot1' });

    expect(ctx.actions.goToPost).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('el-slot1'));
  });

  it('warns and stays inert for a slot with no binding at all', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeFakeCtx({ env: { pages: PAGES } });

    handlePreviewNavigate(ctx, { postSlug: 'my-post', slotKey: 'el-missing' });

    expect(ctx.actions.goToPost).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('postSlug without slotKey falls through to the href path (inert here)', () => {
    const ctx = makeFakeCtx({ env: { pages: PAGES } });
    handlePreviewNavigate(ctx, { postSlug: 'my-post' });
    expect(ctx.actions.goToPost).not.toHaveBeenCalled();
    expect(ctx.actions.setActivePage).not.toHaveBeenCalled();
  });
});
