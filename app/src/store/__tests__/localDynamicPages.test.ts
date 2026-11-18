// task-132: discovered slugs nest as sub-pages of their listing page; the
// '[slug]' placeholder page is dropped and currentPageId repaired.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { hydrateFromProject, seedLocalDynamicPages, pruneLocalDynamicPages } from '../useProjectSync';
import type { Project } from '@/api/types';
import { autoMigration } from '@/store/useProjectSync';

function localDoc(): Y.Doc {
  const doc = new Y.Doc();
  hydrateFromProject(doc, {
    _id: 'browser_lf_x',
    name: 'site',
    pagesTree: [],
    pages: {
      'index': { name: '/', components: [] },
      'about': { name: '/about', components: [] },
      'works-[slug]': { name: '/works/[slug]', components: [] },
    },
  } as unknown as Project);
  return doc;
}

const INSTANCES = [{ route: '/works/[slug]', parentRoute: '/', paths: ['/works/petcube', '/works/other'] }];

autoMigration.enabled = false; // Phase 6.2: these test the doc-truth load path itself

describe('seedLocalDynamicPages', () => {
  it('adds concrete pages as children of the parent page and drops the placeholder', () => {
    const doc = localDoc();
    seedLocalDynamicPages(doc, INSTANCES);
    const pages = doc.getMap('pages');
    expect(pages.has('works-petcube')).toBe(true);
    expect(pages.has('works-other')).toBe(true);
    expect(pages.has('works-[slug]')).toBe(false);
    const parent = pages.get('index') as Y.Map<unknown>;
    expect((parent.get('children') as Y.Array<string>).toArray()).toEqual(['works-petcube', 'works-other']);
    expect(doc.getArray('rootPages').toArray()).not.toContain('works-[slug]');
    expect((pages.get('works-petcube') as Y.Map<unknown>).get('name')).toBe('/works/petcube');
  });

  it('repairs currentPageId when the placeholder was current; idempotent on re-run', () => {
    const doc = localDoc();
    doc.getMap('meta').set('currentPageId', 'works-[slug]');
    seedLocalDynamicPages(doc, INSTANCES);
    expect(doc.getMap('meta').get('currentPageId')).toBe('works-petcube');
    seedLocalDynamicPages(doc, INSTANCES); // second run: no dupes
    const parent = doc.getMap('pages').get('index') as Y.Map<unknown>;
    expect((parent.get('children') as Y.Array<string>).toArray()).toEqual(['works-petcube', 'works-other']);
  });


  it('a LATER re-seed with a new post adds exactly that page (mid-session create)', () => {
    // The Editor re-seeds on every discovery update — a post created
    // mid-session must appear without a reload (owner, 2026-08-10).
    const doc = localDoc();
    seedLocalDynamicPages(doc, INSTANCES);
    const grown = INSTANCES.map(i => ({ ...i, paths: [...i.paths, '/works/brand-new'] }));
    seedLocalDynamicPages(doc, grown);
    const pages = doc.getMap('pages');
    expect(pages.has('works-brand-new')).toBe(true);
    const parent = pages.get('index') as Y.Map<unknown>;
    expect((parent.get('children') as Y.Array<string>).toArray())
      .toEqual(['works-petcube', 'works-other', 'works-brand-new']);
  });

  it('missing parent page falls back to root-level pages', () => {
    const doc = localDoc();
    seedLocalDynamicPages(doc, [{ route: '/works/[slug]', parentRoute: '/gone', paths: ['/works/petcube'] }]);
    expect(doc.getArray('rootPages').toArray()).toContain('works-petcube');
  });
});

// Deleting a post from the Content tab must prune its stale page row from the
// Pages tree — discovery shrinks dynamicInstances, seeding only ADDS.
describe('pruneLocalDynamicPages', () => {
  // What /__sq/local/pages reports for this folder: statics + the dynamic
  // placeholder route (the pages list includes dynamic routes too).
  const STATIC_ROUTES = ['/', '/about', '/works/[slug]'];

  it('removes a vanished instance page and its parent-children entry; keeps pages still in instances', () => {
    const doc = localDoc();
    seedLocalDynamicPages(doc, INSTANCES);
    const shrunk = [{ ...INSTANCES[0], paths: ['/works/petcube'] }]; // '/works/other' post deleted
    pruneLocalDynamicPages(doc, shrunk, STATIC_ROUTES);
    const pages = doc.getMap('pages');
    expect(pages.has('works-other')).toBe(false);
    expect(pages.has('works-petcube')).toBe(true);
    const parent = pages.get('index') as Y.Map<unknown>;
    expect((parent.get('children') as Y.Array<string>).toArray()).toEqual(['works-petcube']);
    expect(doc.getArray('rootPages').toArray()).not.toContain('works-other');
  });

  it('no-op when every instance page is still discovered', () => {
    const doc = localDoc();
    seedLocalDynamicPages(doc, INSTANCES);
    pruneLocalDynamicPages(doc, INSTANCES, STATIC_ROUTES);
    const parent = doc.getMap('pages').get('index') as Y.Map<unknown>;
    expect((parent.get('children') as Y.Array<string>).toArray()).toEqual(['works-petcube', 'works-other']);
  });

  it('keeps a REAL static /x/y page and the dynamic placeholder route', () => {
    const doc = new Y.Doc();
    hydrateFromProject(doc, {
      _id: 'browser_lf_x',
      name: 'site',
      pagesTree: [],
      pages: {
        'index': { name: '/', components: [] },
        'works-special': { name: '/works/special', components: [] }, // real src/pages/works/special.astro
        'works-[slug]': { name: '/works/[slug]', components: [] },
      },
    } as unknown as Project);
    pruneLocalDynamicPages(doc, [], ['/', '/works/special', '/works/[slug]']);
    const pages = doc.getMap('pages');
    expect(pages.has('works-special')).toBe(true);
    expect(pages.has('works-[slug]')).toBe(true);
  });

  it('an EMPTY instances list (last post deleted) prunes every instance page', () => {
    const doc = localDoc();
    seedLocalDynamicPages(doc, INSTANCES);
    pruneLocalDynamicPages(doc, [], STATIC_ROUTES);
    const pages = doc.getMap('pages');
    expect(pages.has('works-petcube')).toBe(false);
    expect(pages.has('works-other')).toBe(false);
    expect(pages.has('index')).toBe(true);
    expect(pages.has('about')).toBe(true);
  });

  it('repairs currentPageId to the first remaining root page when the pruned page was current', () => {
    const doc = localDoc();
    seedLocalDynamicPages(doc, INSTANCES);
    doc.getMap('meta').set('currentPageId', 'works-other');
    pruneLocalDynamicPages(doc, [{ ...INSTANCES[0], paths: ['/works/petcube'] }], STATIC_ROUTES);
    expect(doc.getMap('meta').get('currentPageId')).toBe(doc.getArray('rootPages').get(0));
  });
});
