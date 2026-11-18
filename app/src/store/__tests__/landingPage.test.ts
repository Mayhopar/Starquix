import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import {
  selectLandingPageId, isPageInTree, selectCurrentPageId, selectIsPostPage, selectRootPageIds,
  selectAncestorPageIds,
} from '../selectors';
import type { PageData } from '../types';

/**
 * Owner, 2026-08-13: opening the project landed on the blog DETAIL page —
 * "Post Title / Date / Post content goes here…" — with nothing highlighted in
 * the Pages panel and no way to navigate back to it. Clicking a post navigates
 * there, so it gets persisted as currentPageId, but the panel filters it out of
 * the tree and the post that fills it in is in-memory state, null on open.
 *
 * Pages are seeded through ADD_PAGE, the way the app creates them (see
 * utils/createPostPage.ts). That matters: a first cut of this fix gated on
 * tree-reachability and was a NO-OP, because ADD_PAGE pushes every page —
 * detail pages included — into rootPages. Hand-built Y.Maps hid that.
 */
const addPage = (doc: Y.Doc, page: Partial<PageData> & { id: string }) =>
  applyCommand(doc, {
    type: 'ADD_PAGE',
    page: { name: page.id, rootElementIds: [], ...page } as PageData,
  });

function seed() {
  const doc = createEditorDoc();
  addPage(doc, { id: 'home', name: 'Home', isHome: true });
  addPage(doc, { id: 'about', name: 'About' });
  // The detail page, created exactly as createPostPage does it.
  addPage(doc, { id: 'detail', name: 'Post Page', pageType: 'post', collectionId: 'c1' });
  return doc;
}

describe('the detail page really is in rootPages — the trap the first fix fell into', () => {
  it('is tree-reachable, so reachability alone cannot exclude it', () => {
    const doc = seed();
    expect(selectRootPageIds(doc)).toContain('detail');
    expect(isPageInTree(doc, 'detail')).toBe(true);
  });

  it('is what the Pages panel filters out of the tree', () => {
    const doc = seed();
    expect(selectIsPostPage(doc, 'detail')).toBe(true);
    expect(selectIsPostPage(doc, 'home')).toBe(false);
  });
});

describe('selectLandingPageId', () => {
  it('falls back to home when the restored page has no row (the reported bug)', () => {
    const doc = seed();
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: 'detail' });
    expect(selectCurrentPageId(doc)).toBe('detail'); // what the doc restored
    expect(selectLandingPageId(doc)).toBe('home');   // what we open on
  });

  it('keeps a restored page the user can actually see', () => {
    const doc = seed();
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: 'about' });
    expect(selectLandingPageId(doc)).toBe('about');
  });

  it('keeps a restored nested page', () => {
    const doc = seed();
    addPage(doc, { id: 'nested', name: 'Nested' });
    applyCommand(doc, { type: 'MOVE_PAGE', pageId: 'nested', newParentId: 'home', index: 0 });
    expect(isPageInTree(doc, 'nested')).toBe(true);
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: 'nested' });
    expect(selectLandingPageId(doc)).toBe('nested');
  });

  it('never lands on a page the panel would not show', () => {
    const doc = seed();
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: 'detail' });
    const landing = selectLandingPageId(doc)!;
    expect(selectIsPostPage(doc, landing)).toBe(false);
    expect(isPageInTree(doc, landing)).toBe(true);
  });

  it('skips a home page that is itself collection-bound', () => {
    const doc = createEditorDoc();
    // Only a detail page and one ordinary page; home resolution must not pick
    // the detail page just because it sorts first.
    addPage(doc, { id: 'detail', name: 'Post Page', pageType: 'post', collectionId: 'c1' });
    addPage(doc, { id: 'plain', name: 'Plain' });
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: 'detail' });
    expect(selectLandingPageId(doc)).toBe('plain');
  });

  it('returns null when every page is a detail page', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'detail', name: 'Post Page', pageType: 'post', collectionId: 'c1' });
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: 'detail' });
    expect(selectLandingPageId(doc)).toBeNull();
  });
});

describe('selectAncestorPageIds', () => {
  it('lists the ancestors a nested landing page needs expanded', () => {
    const doc = seed();
    addPage(doc, { id: 'child', name: 'Child' });
    addPage(doc, { id: 'grandchild', name: 'Grandchild' });
    applyCommand(doc, { type: 'MOVE_PAGE', pageId: 'child', newParentId: 'home', index: 0 });
    applyCommand(doc, { type: 'MOVE_PAGE', pageId: 'grandchild', newParentId: 'child', index: 0 });
    expect(selectAncestorPageIds(doc, 'grandchild')).toEqual(['child', 'home']);
  });

  it('is empty for a root page', () => {
    expect(selectAncestorPageIds(seed(), 'home')).toEqual([]);
  });
});
