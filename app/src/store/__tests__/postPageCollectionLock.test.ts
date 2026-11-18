import 'fake-indexeddb/auto';
/**
 * task-036 — detail-page ↔ collection 1:1 lock.
 *
 * Every collection has exactly one detail page (pageType='post'), created and
 * deleted atomically with it. No UI can break this today; these guards make
 * the data model itself refuse the mutations that would. pageType has no
 * post-creation mutation command at
 * all (only ADD_PAGE writes it), so the guard surface is:
 *   - SET_POST_PAGE_COLLECTION rebinding to a different collection
 *   - ADD_PAGE creating a second detail page for an already-claimed collection
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPostPageInvariantViolations } from '../selectors';
import { createPostPage } from '@/utils/createPostPage';

const collection = (id: string, name: string) => ({
  id,
  name,
  fields: [],
  createdAt: '2026-07-02T00:00:00.000Z',
});

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

async function docWithBoundPostPage() {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
  applyCommand(doc, { type: 'ADD_CONTENT_COLLECTION', collection: collection('col-1', 'blog') });
  const pageId = await createPostPage(doc, 'col-1', 'blog', null);
  return { doc, pageId };
}

describe('SET_POST_PAGE_COLLECTION rebind guard', () => {
  it('refuses to rebind a detail page to a different collection and logs an error', async () => {
    const { doc, pageId } = await docWithBoundPostPage();

    const ok = applyCommand(doc, { type: 'SET_POST_PAGE_COLLECTION', pageId, collectionId: 'col-2' });

    expect(ok).toBe(false);
    const binding = doc.getMap('postPageBindings').get(pageId) as Y.Map<unknown>;
    expect(binding.get('collectionId')).toBe('col-1');
    const yPage = doc.getMap('pages').get(pageId) as Y.Map<unknown>;
    expect(yPage.get('collectionId')).toBe('col-1');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('SET_POST_PAGE_COLLECTION'));
  });

  it('still allows the initial bind and a same-collection re-apply', async () => {
    const { doc, pageId } = await docWithBoundPostPage();

    // Same collection again — idempotent, not a rebind.
    expect(applyCommand(doc, { type: 'SET_POST_PAGE_COLLECTION', pageId, collectionId: 'col-1' })).toBe(true);

    // Initial bind right after ADD_PAGE (the createPostPage sequence).
    applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'p-fresh', name: 'Post Page', rootElementIds: [], children: [],
      pageType: 'post', collectionId: 'col-9',
    }});
    expect(applyCommand(doc, { type: 'SET_POST_PAGE_COLLECTION', pageId: 'p-fresh', collectionId: 'col-9' })).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('ADD_PAGE duplicate detail-page guard', () => {
  it('refuses a second detail page for an already-claimed collection and logs an error', async () => {
    const { doc } = await docWithBoundPostPage();

    const ok = applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'p-dup', name: 'Post Page', rootElementIds: [], children: [],
      pageType: 'post', collectionId: 'col-1',
    }});

    expect(ok).toBe(false);
    expect(doc.getMap('pages').has('p-dup')).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ADD_PAGE'));
  });

  it('still allows a detail page for a different collection and normal pages', async () => {
    const { doc } = await docWithBoundPostPage();

    expect(applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'p-other', name: 'Post Page', rootElementIds: [], children: [],
      pageType: 'post', collectionId: 'col-2',
    }})).toBe(true);
    expect(applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'p-normal', name: 'About', rootElementIds: [], children: [],
    }})).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('selectPostPageInvariantViolations', () => {
  it('reports nothing for a clean collection + detail page pair', async () => {
    const { doc } = await docWithBoundPostPage();
    expect(selectPostPageInvariantViolations(doc)).toEqual([]);
  });

  it('reports a detail page whose collection does not exist', async () => {
    const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'p-orphan', name: 'Post Page', rootElementIds: [], children: [],
      pageType: 'post', collectionId: 'ghost',
    }});

    const violations = selectPostPageInvariantViolations(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('detail-page-without-collection');
    expect(violations[0].pageIds).toEqual(['p-orphan']);
    expect(violations[0].collectionId).toBe('ghost');
  });

  it('reports a detail page with no collectionId at all', async () => {
    const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    applyCommand(doc, { type: 'ADD_PAGE', page: {
      id: 'p-bare', name: 'Post Page', rootElementIds: [], children: [],
      pageType: 'post',
    }});

    const violations = selectPostPageInvariantViolations(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('detail-page-without-collection');
    expect(violations[0].pageIds).toEqual(['p-bare']);
    expect(violations[0].collectionId).toBeNull();
  });

  it('reports a collection with no detail page', async () => {
    const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    applyCommand(doc, { type: 'ADD_CONTENT_COLLECTION', collection: collection('col-lone', 'news') });

    const violations = selectPostPageInvariantViolations(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('collection-without-detail-page');
    expect(violations[0].collectionId).toBe('col-lone');
  });

  it('reports duplicate detail pages for one collection (guard bypassed via direct Yjs write)', async () => {
    const { doc } = await docWithBoundPostPage();

    // Simulate the corruption the ADD_PAGE guard exists to prevent.
    const dup = new Y.Map<unknown>();
    dup.set('id', 'p-dup');
    dup.set('name', 'Post Page');
    dup.set('rootElementIds', new Y.Array());
    dup.set('children', new Y.Array());
    dup.set('pageType', 'post');
    dup.set('collectionId', 'col-1');
    doc.getMap('pages').set('p-dup', dup);

    const violations = selectPostPageInvariantViolations(doc);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe('duplicate-detail-pages');
    expect(violations[0].collectionId).toBe('col-1');
    expect(violations[0].pageIds).toHaveLength(2);
  });
});

describe('collection delete cascade (regression)', () => {
  it('still deletes the detail page, its binding, and leaves no invariant violations', async () => {
    const { doc, pageId } = await docWithBoundPostPage();

    applyCommand(doc, { type: 'DELETE_CONTENT_COLLECTION', collectionId: 'col-1' });

    expect(doc.getMap('pages').has(pageId)).toBe(false);
    expect(doc.getMap('postPageBindings').has(pageId)).toBe(false);
    expect(doc.getMap('contentCollections').has('col-1')).toBe(false);
    expect(selectPostPageInvariantViolations(doc)).toEqual([]);
  });
});
