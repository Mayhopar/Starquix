import 'fake-indexeddb/auto';
/**
 * Blog Content Slot Element — Task 3.
 *
 * Task 2 stopped storing the 'body' entry in postPageBindings; the body
 * render target is now the collection-content element. Bridge Phase 6 and
 * generatePostPage (the template-aware export route) still consume
 * `bindings[key] === 'body'`, so `selectPostPageRenderData` must synthesize
 * that entry from the element — none of those consumers change.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createPostPage } from '@/utils/createPostPage';
import { applyCommand } from '@/store/commands';
import { selectCollectionContentBodyKey, selectPostPageRenderData } from '../selectors';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const home = new Y.Map();
    home.set('id', 'home');
    home.set('name', 'Home');
    home.set('rootElementIds', new Y.Array());
    home.set('children', new Y.Array());
    pages.set('home', home);
    doc.getArray('rootPages').push(['home']);
  }, 'sync');
  return doc;
}

describe('selectPostPageRenderData — body binding from collection-content element', () => {
  it('synthesizes the body binding from the collection-content element', async () => {
    const doc = setupDoc();
    const pageId = await createPostPage(doc, 'col-1', 'blog', null);
    const data = selectPostPageRenderData(doc, pageId)!;
    expect(data).not.toBeNull();
    expect(data.collectionId).toBe('col-1');

    const bodyEntries = Object.entries(data.bindings).filter(([, f]) => f === 'body');
    expect(bodyEntries).toHaveLength(1);
    const [key] = bodyEntries[0];

    // The key must match the data-key stamped on the element's own root tag
    // (stamped at creation by createElementYMap → addKeysToMarkup).
    let contentMarkup = '';
    doc.getMap('elements').forEach((v) => {
      const el = v as Y.Map<unknown>;
      if (el.get('pageId') !== pageId) return;
      if (el.get('bindingType') !== 'collection-content') return;
      contentMarkup = (el.get('staticMarkup') as string) || '';
    });
    expect(contentMarkup).toContain(`data-key="${key}"`);
    // Single-root markup: the first data-key IS the root tag's key.
    expect(contentMarkup.match(/data-key="([^"]+)"/)?.[1]).toBe(key);
  });

  it('keeps the frontmatter field bindings intact', async () => {
    const doc = setupDoc();
    const pageId = await createPostPage(doc, 'col-1', 'blog', null);
    const data = selectPostPageRenderData(doc, pageId)!;
    const fields = Object.values(data.bindings);
    expect(fields).toEqual(expect.arrayContaining(['title', 'date', 'thumbnail']));
  });

  it('passes a legacy body binding through untouched when no collection-content element exists (pre-migration doc)', async () => {
    const doc = setupDoc();
    const pageId = 'post-legacy';
    doc.transact(() => {
      applyCommand(doc, { type: 'ADD_PAGE', page: {
        id: pageId, name: 'Post Page', rootElementIds: [], children: [],
        pageType: 'post', collectionId: 'col-1', routePrefix: '/blog/posts',
      }});
      applyCommand(doc, { type: 'SET_POST_PAGE_COLLECTION', pageId, collectionId: 'col-1' });
      applyCommand(doc, { type: 'SET_POST_PAGE_BINDING', pageId, elementKey: 'el-legacy:div-0', fieldName: 'body' });
    }, 'user');

    expect(selectCollectionContentBodyKey(doc, pageId)).toBeNull();

    const data = selectPostPageRenderData(doc, pageId)!;
    expect(data).not.toBeNull();
    expect(data.bindings).toEqual({ 'el-legacy:div-0': 'body' });
  });

  it('drops a legacy body entry under a different key when the element exists — exactly one body entry, keyed by the element', async () => {
    const doc = setupDoc();
    const pageId = await createPostPage(doc, 'col-1', 'blog', null);
    // Pre-migration doc shape: a stale 'body' entry under some other element key.
    doc.transact(() => {
      applyCommand(doc, { type: 'SET_POST_PAGE_BINDING', pageId, elementKey: 'el-stale:div-0', fieldName: 'body' });
    }, 'user');

    const data = selectPostPageRenderData(doc, pageId)!;
    const bodyEntries = Object.entries(data.bindings).filter(([, f]) => f === 'body');
    expect(bodyEntries).toHaveLength(1);
    expect(bodyEntries[0][0]).toBe(selectCollectionContentBodyKey(doc, pageId));
    expect(data.bindings['el-stale:div-0']).toBeUndefined();
  });
});
