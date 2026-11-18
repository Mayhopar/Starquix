import { describe, it, expect } from 'vitest';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import { selectHomePageId } from '../selectors';
import type { PageData } from '../types';

function addPage(doc: ReturnType<typeof createEditorDoc>, page: Partial<PageData> & { id: string; name: string }) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { rootElementIds: [], children: [], ...page } as PageData });
  doc.getArray('rootPages').push([page.id]);
}
const flag = (doc: ReturnType<typeof createEditorDoc>, id: string) =>
  (doc.getMap('pages').get(id) as { get(k: string): unknown }).get('isHome');

describe('SET_HOME_PAGE', () => {
  it('sets the flag and clears it on every other page (exclusivity)', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'Home', isHome: true });
    addPage(doc, { id: 'p2', name: 'About' });
    expect(applyCommand(doc, { type: 'SET_HOME_PAGE', pageId: 'p2' })).not.toBe(false);
    expect(flag(doc, 'p2')).toBe(true);
    expect(flag(doc, 'p1')).toBeUndefined();
    expect(selectHomePageId(doc)).toBe('p2');
  });

  it('refuses unknown pages and post pages', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'Home', isHome: true });
    addPage(doc, { id: 'post-pg', name: 'Post Page', pageType: 'post' });
    expect(applyCommand(doc, { type: 'SET_HOME_PAGE', pageId: 'nope' })).toBe(false);
    expect(applyCommand(doc, { type: 'SET_HOME_PAGE', pageId: 'post-pg' })).toBe(false);
    expect(selectHomePageId(doc)).toBe('p1');
  });
});

describe('DELETE_PAGE home reassignment', () => {
  it('deleting the home page stamps the first remaining root page', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'Home', isHome: true });
    addPage(doc, { id: 'p2', name: 'About' });
    addPage(doc, { id: 'p3', name: 'Contact' });
    applyCommand(doc, { type: 'DELETE_PAGE', pageId: 'p1' });
    expect(flag(doc, 'p2')).toBe(true);
    expect(selectHomePageId(doc)).toBe('p2');
  });

  it('skips post/detail pages when picking the heir (stamps the first eligible root)', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'Home', isHome: true });
    addPage(doc, { id: 'post-pg', name: 'Blog Post', pageType: 'post', collectionId: 'blog' });
    addPage(doc, { id: 'p3', name: 'Contact' });
    applyCommand(doc, { type: 'DELETE_PAGE', pageId: 'p1' });
    // The heir must be a page SET_HOME_PAGE itself would accept — never a post page
    expect(flag(doc, 'post-pg')).toBeUndefined();
    expect(flag(doc, 'p3')).toBe(true);
    expect(selectHomePageId(doc)).toBe('p3');
  });

  it('deleting a non-home page leaves the flag alone', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'Home', isHome: true });
    addPage(doc, { id: 'p2', name: 'About' });
    applyCommand(doc, { type: 'DELETE_PAGE', pageId: 'p2' });
    expect(flag(doc, 'p1')).toBe(true);
  });
});
