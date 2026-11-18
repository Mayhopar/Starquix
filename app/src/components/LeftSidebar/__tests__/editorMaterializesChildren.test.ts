import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { baseMarkup } from '@/store/masters';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { resolveCanvasHtmlWithPlacements } from '@/utils/canvasHtml';
import { seedComponentEditorPage } from '@/components/LeftSidebar/seedComponentEditor';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const CARD_PATH = 'src/components/library/BlogCard.astro';
const SLOT_PATH = 'src/components/library/BlogSlot.astro';
const HEADER_PATH = 'src/components/library/Header.astro';
const FOOTER_PATH = 'src/components/library/Footer.astro';
const POST_PATH = 'src/components/library/BlogPost.astro';

const lib = (name: string, path: string, html: string): ScannedComponent => ({
  name, path, source: 'built-in', html, category: 'Test', props: [], slots: [], dependencies: [],
});

const CARD_HTML = '<div class="bg-stone-200"><h3>{title}</h3></div>';
const BLOGSLOT_SRC = `<section class="bg-stone-100"><slot name="posts"><BlogCard /></slot></section>`;
const BLOGPOST_SRC = `<article><Header /><main>body</main><Footer /></article>`;

const LIBRARY = [
  lib('BlogCard', CARD_PATH, CARD_HTML),
  lib('Header', HEADER_PATH, '<header class="p-4">Site</header>'),
  lib('Footer', FOOTER_PATH, '<footer class="p-2">Foot</footer>'),
];

function open(doc: Y.Doc, name: string, path: string, src: string) {
  const component = lib(name, path, src);
  const { html, placements } = resolveCanvasHtmlWithPlacements(src, LIBRARY);
  return seedComponentEditorPage(doc, { component, html, placements, library: LIBRARY });
}

function editorChildren(doc: Y.Doc, editorId: string) {
  const out: Array<Y.Map<unknown>> = [];
  doc.getMap<Y.Map<unknown>>('elements').forEach((el) => {
    if (el.get('pageId') === COMPONENT_EDITOR_PAGE_ID && el.get('parentId') === editorId) out.push(el);
  });
  return out;
}

describe('editor open materializes nested components as child instances', () => {
  it('BlogSlot open: editor root keeps the placeholder; card becomes a real child element', () => {
    const doc = new Y.Doc();
    const editorId = open(doc, 'BlogSlot', SLOT_PATH, BLOGSLOT_SRC);

    const editorEl = doc.getMap<Y.Map<unknown>>('elements').get(editorId)!;
    expect(editorEl.get('staticMarkup')).toContain('<sq-child');
    expect(editorEl.get('staticMarkup')).toContain('data-sq-placement="posts"');
    expect(editorEl.get('staticMarkup')).not.toContain('bg-stone-200'); // card html NOT inlined

    const kids = editorChildren(doc, editorId);
    expect(kids).toHaveLength(1);
    const card = kids[0];
    expect(card.get('astroSource')).toBe(CARD_PATH);
    expect(card.get('placementKey')).toBe('posts');
    expect(card.get('slotName')).toBe('posts');
    expect(card.get('type')).toBe('component');
  });

  it('pre-set masters childOverrides render via baseMarkup, NOT seeded as child classOverrides', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH,
      placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } },
    });
    const editorId = open(doc, 'BlogSlot', SLOT_PATH, BLOGSLOT_SRC);
    const card = editorChildren(doc, editorId)[0];
    expect((card.get('classOverrides') as Y.Map<unknown>).size).toBe(0);
    expect(baseMarkup(doc, card)).toContain('bg-white');
  });

  it('BlogPost open: non-slot placements materialize as header-0 / footer-0 children', () => {
    const doc = new Y.Doc();
    const editorId = open(doc, 'BlogPost', POST_PATH, BLOGPOST_SRC);
    const keys = editorChildren(doc, editorId).map((k) => k.get('placementKey')).sort();
    expect(keys).toEqual(['footer-0', 'header-0']);
  });

  // Regression: pages expand a master's <sq-child> via expandLeftoverPlaceholders,
  // which reads the MASTERS overlay only — a missing child master silently
  // dropped Footer from every blog-post page.
  it('open seeds missing child masters from the library (existing masters untouched)', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: HEADER_PATH, markup: '<header class="edited">E</header>' });
    open(doc, 'BlogPost', POST_PATH, BLOGPOST_SRC);
    const masters = doc.getMap('masters');
    expect((masters.get(FOOTER_PATH) as Y.Map<unknown>).get('markup')).toContain('Foot');
    // Pre-existing (edited) master is NOT overwritten by library html.
    expect((masters.get(HEADER_PATH) as Y.Map<unknown>).get('markup')).toContain('edited');
  });

  // Regression: a stale masters bake (e.g. without a newly-added placement)
  // shadowed the fresh source forever — baseMarkup prefers masters and the
  // auto-bake re-bakes from baseMarkup, a self-perpetuating loop.
  it('open refreshes the opened component\'s OWN master from the fresh resolve', () => {
    const doc = new Y.Doc();
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: POST_PATH,
      markup: '<layout class="stale-no-nav"><slot ></slot></layout>',
    });
    open(doc, 'BlogPost', POST_PATH, BLOGPOST_SRC);
    const markup = (doc.getMap('masters').get(POST_PATH) as Y.Map<unknown>).get('markup') as string;
    expect(markup).not.toContain('stale-no-nav');
    expect(markup).toContain('data-sq-placement="header-0"');
    expect(markup).toContain('data-sq-placement="footer-0"');
  });

  it('re-seeding sweeps previous children (resetComponentEditorPage by pageId)', () => {
    const doc = new Y.Doc();
    const firstId = open(doc, 'BlogSlot', SLOT_PATH, BLOGSLOT_SRC);
    expect(editorChildren(doc, firstId)).toHaveLength(1);
    const secondId = open(doc, 'BlogPost', POST_PATH, BLOGPOST_SRC);
    expect(doc.getMap('elements').get(firstId)).toBeUndefined();
    expect(editorChildren(doc, firstId)).toHaveLength(0);
    expect(editorChildren(doc, secondId)).toHaveLength(2);
  });
});
