import 'fake-indexeddb/auto';
/**
 * task-031 — post-page routePrefix must include the `/posts` segment so the
 * dev-time anchor URLs in the iframe match the export-time detail-page route
 * (`src/pages/<collection>/posts/[...slug].astro`).
 *
 * Before fix: routePrefix was `/<collection>`, the iframe wrote anchors like
 * `/blog/hello` while the exported file lived at `/blog/posts/hello` — a link
 * that worked in dev preview but 404'd at publish (or vice versa).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createPostPage } from '../createPostPage';

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

describe('task-031 — createPostPage routePrefix shape', () => {
  it('sets routePrefix to `/<collection>/posts` so anchor URLs match the export route', async () => {
    const doc = setupDoc();
    const pageId = await createPostPage(doc, 'col-1', 'news', 'home');

    const yPage = doc.getMap('pages').get(pageId) as Y.Map<unknown>;
    expect(yPage.get('routePrefix')).toBe('/news/posts');
  });

  it('routePrefix uses the collection name verbatim — not normalised or lowercased', async () => {
    const doc = setupDoc();
    const pageId = await createPostPage(doc, 'col-2', 'BlogPosts', 'home');

    const yPage = doc.getMap('pages').get(pageId) as Y.Map<unknown>;
    expect(yPage.get('routePrefix')).toBe('/BlogPosts/posts');
  });
});
