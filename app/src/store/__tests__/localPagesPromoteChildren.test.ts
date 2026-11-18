import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { promoteLocalChildPages, followLocalPageFiles, watchLocalPageFiles } from '../localPages';

function docWith(root: string[], children: Record<string, string[]>): Y.Doc {
  const doc = new Y.Doc();
  const pages = doc.getMap('pages');
  for (const id of [...root, ...Object.values(children).flat()]) {
    const p = new Y.Map();
    p.set('id', id); p.set('name', `/${id}`); p.set('rootElementIds', new Y.Array());
    const kids = new Y.Array<string>(); kids.push(children[id] ?? []); p.set('children', kids);
    pages.set(id, p);
  }
  doc.getArray<string>('rootPages').push(root);
  return doc;
}

describe('local page delete with derived child pages (owner 2026-09-24: page-4 refused)', () => {
  it('DELETE_PAGE alone refuses a root page with children', () => {
    const doc = docWith(['a', 'page-4', 'b'], { 'page-4': ['post-1', 'post-2'] });
    expect(applyCommand(doc, { type: 'DELETE_PAGE', pageId: 'page-4' })).toBe(false);
  });

  it('children are lifted to where the page stood, then the page deletes', () => {
    const doc = docWith(['a', 'page-4', 'b'], { 'page-4': ['post-1', 'post-2'] });
    promoteLocalChildPages(doc, 'page-4');
    expect(applyCommand(doc, { type: 'DELETE_PAGE', pageId: 'page-4' })).toBe(true);
    expect(doc.getArray('rootPages').toArray()).toEqual(['a', 'post-1', 'post-2', 'b']);
    expect(doc.getMap('pages').has('post-1')).toBe(true);
  });
});

// task-270: files are truth. A page file that appears or vanishes by another
// road than Add / Delete Page (write_file, an agent in the terminal, git) is
// followed by the doc — it used to take a reopen.
describe('the doc follows page files', () => {
  const names = (doc: Y.Doc) => doc.getArray<string>('rootPages').toArray();

  it('a new static page file becomes a page; dynamic routes, non-pages and known pages add nothing', () => {
    const doc = docWith(['index'], {});
    expect(followLocalPageFiles(doc, ['src/pages/about.astro', 'src/pages/blog/[slug].astro', 'src/components/Card.astro', 'src/pages/index.astro'])).toEqual(['about']);
    expect(names(doc)).toEqual(['index', 'about']);
    expect((doc.getMap('pages').get('about') as Y.Map<unknown>).get('name')).toBe('/about');
  });

  it('a vanished page file drops its page, lifts its children and moves the editor off it', () => {
    const doc = docWith(['index', 'blog'], { blog: ['blog-first'] });
    doc.getMap('meta').set('currentPageId', 'blog');
    followLocalPageFiles(doc, [], [{ route: '/blog', file: 'src/pages/blog.astro' }]);
    expect(names(doc)).toEqual(['index', 'blog-first']);
    expect(doc.getMap('meta').get('currentPageId')).toBe('index');
  });

  it('every disk change of the open project reaches the doc; a removed folder takes the pages under it', () => {
    const doc = docWith(['index', 'docs-intro'], {});
    const stop = watchLocalPageFiles(doc, 'browser_a', [{ route: '/', file: 'src/pages/index.astro' }, { route: '/docs/intro', file: 'src/pages/docs/intro.astro' }]);
    const change = (projectId: string, files: string[], gone: string[]) => window.dispatchEvent(new CustomEvent('sq:files-changed', { detail: { projectId, files, gone } }));
    change('browser_other', ['src/pages/nope.astro'], []);
    change('browser_a', ['src/pages/pricing.astro'], ['src/pages/docs']);
    expect(names(doc)).toEqual(['index', 'pricing']);
    stop();
    change('browser_a', ['src/pages/late.astro'], []);
    expect(names(doc)).toEqual(['index', 'pricing']);
  });
});
