import { describe, it, expect } from 'vitest';
import { createEditorDoc } from '../createEditorDoc';
import { applyCommand } from '../commands';
import { selectHomePageId, selectPage } from '../selectors';
import type { PageData } from '../types';

function addPage(doc: ReturnType<typeof createEditorDoc>, page: Partial<PageData> & { id: string; name: string }) {
  applyCommand(doc, { type: 'ADD_PAGE', page: { rootElementIds: [], children: [], ...page } as PageData });
  doc.getArray('rootPages').push([page.id]);
}

describe('selectHomePageId', () => {
  it('returns the flagged page, in rootPages order, beating name-magic', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'home' });          // legacy magic match
    addPage(doc, { id: 'p2', name: 'Landing', isHome: true });
    expect(selectHomePageId(doc)).toBe('p2');
  });

  it('legacy fallback: pageId "default" wins when nothing is flagged', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'About' });
    addPage(doc, { id: 'default', name: 'Whatever' });
    expect(selectHomePageId(doc)).toBe('default');
  });

  it('legacy fallback: first root page named "home" (case-insensitive)', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'About' });
    addPage(doc, { id: 'p2', name: 'HOME' });
    expect(selectHomePageId(doc)).toBe('p2');
  });

  it('final fallback: first non-post root page; null when no pages', () => {
    const doc = createEditorDoc();
    expect(selectHomePageId(doc)).toBeNull();
    addPage(doc, { id: 'post-pg', name: 'Post Page', pageType: 'post' });
    addPage(doc, { id: 'p2', name: 'About' });
    expect(selectHomePageId(doc)).toBe('p2');
  });

  it('selectPage projects isHome', () => {
    const doc = createEditorDoc();
    addPage(doc, { id: 'p1', name: 'Landing', isHome: true });
    expect(selectPage(doc, 'p1')?.isHome).toBe(true);
  });
});
