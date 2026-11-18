import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { wrapPostPageInBlogPost } from '../wrapPostPageInBlogPost';
import { BLOG_POST_ASTRO_SOURCE, BLOG_POST_COMPONENT_NAME } from '../blogPostTemplate';

const FAKE_BLOGPOST_HTML =
  '<header data-sq-source="Header.astro:5:1">H</header><slot></slot><footer data-sq-source="Footer.astro:5:1">F</footer>';

function makePostPage(doc: Y.Doc, pageId: string, rootIds: string[]): void {
  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');
  const page = new Y.Map();
  page.set('id', pageId);
  page.set('pageType', 'post');
  const yRoots = new Y.Array<string>();
  yRoots.push(rootIds);
  page.set('rootElementIds', yRoots);
  pages.set(pageId, page);

  for (const id of rootIds) {
    const el = new Y.Map();
    el.set('id', id);
    el.set('pageId', pageId);
    el.set('parentId', null);
    el.set('staticMarkup', `<article id="${id}"></article>`);
    elements.set(id, el);
  }
}

describe('wrapPostPageInBlogPost', () => {
  it('wraps a single-root post page in a BlogPost instance and reparents the article', async () => {
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', ['article-1']);

    const wrapped = await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);
    expect(wrapped).toBe(true);

    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    const rootIds = (page.get('rootElementIds') as Y.Array<string>).toArray();
    expect(rootIds).toHaveLength(1);

    const wrapperId = rootIds[0];
    const wrapper = doc.getMap('elements').get(wrapperId) as Y.Map<unknown>;
    expect(wrapper.get('astroSource')).toBe(BLOG_POST_ASTRO_SOURCE);
    expect(wrapper.get('componentType')).toBe(BLOG_POST_COMPONENT_NAME);
    // data-keys are stamped into the staticMarkup so overrides can address
    // sub-tags via `<wrapperId>:<selector>`; the original Header/Footer text
    // and slot survive intact.
    const stamped = wrapper.get('staticMarkup') as string;
    expect(stamped).toMatch(/<header[^>]*data-key="[^"]+:header-0"[^>]*>H<\/header>/);
    expect(stamped).toMatch(/<slot[^>]*><\/slot>/);
    expect(stamped).toMatch(/<footer[^>]*data-key="[^"]+:footer-0"[^>]*>F<\/footer>/);

    const article = doc.getMap('elements').get('article-1') as Y.Map<unknown>;
    expect(article.get('parentId')).toBe(wrapperId);
  });

  it('is idempotent — re-running with the same html is a no-op', async () => {
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', ['article-1']);
    await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);

    const firstRootIds = (doc.getMap('pages').get('page-1') as Y.Map<unknown>)
      .get('rootElementIds') as Y.Array<string>;
    const firstWrapperId = firstRootIds.get(0);

    const wrappedAgain = await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);
    expect(wrappedAgain).toBe(false);

    const secondRootIds = (doc.getMap('pages').get('page-1') as Y.Map<unknown>)
      .get('rootElementIds') as Y.Array<string>;
    expect(secondRootIds.toArray()).toEqual([firstWrapperId]);
  });

  it('does NOT auto-refresh the wrapper staticMarkup when source has changed (idempotent re-wrap)', async () => {
    // Regression: previously the wrap utility silently rebased the wrapper's
    // staticMarkup whenever the source drifted. That broke parity with regular
    // component instances (Header on a page doesn't auto-pull Header.astro
    // edits). Re-wrapping an already-wrapped page is a no-op (returns false) and
    // leaves the stored markup untouched.
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', ['article-1']);
    await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);

    const rootIds = (doc.getMap('pages').get('page-1') as Y.Map<unknown>)
      .get('rootElementIds') as Y.Array<string>;
    const wrapperId = rootIds.get(0);
    const wrapper = doc.getMap('elements').get(wrapperId) as Y.Map<unknown>;
    const beforeMarkup = wrapper.get('staticMarkup') as string;

    const NEW_BLOGPOST_HTML =
      '<header data-sq-source="Header.astro:5:1">EDITED</header><slot></slot><footer data-sq-source="Footer.astro:5:1">F</footer>';

    const result = await wrapPostPageInBlogPost(doc, 'page-1', NEW_BLOGPOST_HTML);
    expect(result).toBe(false);

    expect(wrapper.get('staticMarkup')).toBe(beforeMarkup);
  });

  it('wraps multi-root post pages so every existing root becomes a slot child', async () => {
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', ['a', 'b', 'c']);

    await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);

    const page = doc.getMap('pages').get('page-1') as Y.Map<unknown>;
    const rootIds = (page.get('rootElementIds') as Y.Array<string>).toArray();
    expect(rootIds).toHaveLength(1);
    const wrapperId = rootIds[0];

    const elements = doc.getMap('elements');
    expect((elements.get('a') as Y.Map<unknown>).get('parentId')).toBe(wrapperId);
    expect((elements.get('b') as Y.Map<unknown>).get('parentId')).toBe(wrapperId);
    expect((elements.get('c') as Y.Map<unknown>).get('parentId')).toBe(wrapperId);
  });

  it('returns false on an empty post page', async () => {
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', []);
    expect(await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML)).toBe(false);
  });

  it('returns false when given empty BlogPost HTML', async () => {
    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', ['article-1']);
    expect(await wrapPostPageInBlogPost(doc, 'page-1', '')).toBe(false);
  });

  it('after wrap, selectPageComponents composes the article into BlogPost slot', async () => {
    const { selectPageComponents } = await import('@/store/selectors');

    const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
    makePostPage(doc, 'page-1', ['article-1']);
    await wrapPostPageInBlogPost(doc, 'page-1', FAKE_BLOGPOST_HTML);

    const components = selectPageComponents(doc, 'page-1');
    expect(components).toHaveLength(1);
    // Header survives, slot is filled with the article, footer survives.
    expect(components[0].staticMarkup).toMatch(/<header[^>]*>H<\/header>/);
    expect(components[0].staticMarkup).toMatch(/<article[^>]*>/);
    expect(components[0].staticMarkup).toMatch(/<footer[^>]*>F<\/footer>/);
  });
});
