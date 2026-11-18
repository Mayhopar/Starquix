import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { selectPostContentMarkup } from '../selectors';

function buildWrappedPostDoc(): Y.Doc {
  const doc = new Y.Doc();
  const pages = doc.getMap('pages');
  const yPage = new Y.Map();
  yPage.set('id', 'page-post');
  yPage.set('name', 'Post Page');
  yPage.set('pageType', 'post');
  yPage.set('collectionId', 'coll-blog');
  yPage.set('rootElementIds', Y.Array.from(['pp-wrapper']));
  pages.set('page-post', yPage);

  const elements = doc.getMap('elements');
  const wrapper = new Y.Map();
  wrapper.set('id', 'pp-wrapper');
  wrapper.set('pageId', 'page-post');
  wrapper.set('type', 'component');
  wrapper.set('componentType', 'BlogPost');
  wrapper.set('astroSource', 'library/BlogPost.astro');
  wrapper.set('staticMarkup', '<layout><header>chrome</header><slot /><footer>chrome</footer></layout>');
  elements.set('pp-wrapper', wrapper);

  const article = new Y.Map();
  article.set('id', 'pp-article');
  article.set('pageId', 'page-post');
  article.set('parentId', 'pp-wrapper');
  article.set('staticMarkup', '<article data-key="pp-article:article-0"><h1 data-key="pp-article:h1-0">T</h1></article>');
  elements.set('pp-article', article);
  return doc;
}

describe('selectPostContentMarkup', () => {
  it('returns the wrapper children composed, chrome excluded', () => {
    const out = selectPostContentMarkup(buildWrappedPostDoc(), 'page-post');
    expect(out).toContain('<article data-key="pp-article:article-0">');
    expect(out).not.toContain('<header>chrome</header>');
    expect(out).not.toContain('<layout');
  });

  it('falls back to page roots when the page was never wrapped', () => {
    const doc = buildWrappedPostDoc();
    // simulate un-migrated page: root is the article itself
    const yPage = doc.getMap('pages').get('page-post') as Y.Map<unknown>;
    const roots = yPage.get('rootElementIds') as Y.Array<string>;
    roots.delete(0, roots.length);
    roots.push(['pp-article']);
    (doc.getMap('elements').get('pp-article') as Y.Map<unknown>).set('parentId', null);
    const out = selectPostContentMarkup(doc, 'page-post');
    expect(out).toContain('<article data-key="pp-article:article-0">');
  });

  it('returns null for an empty page', () => {
    const doc = new Y.Doc();
    const yPage = new Y.Map();
    yPage.set('rootElementIds', new Y.Array());
    doc.getMap('pages').set('p', yPage);
    expect(selectPostContentMarkup(doc, 'p')).toBeNull();
  });
});
