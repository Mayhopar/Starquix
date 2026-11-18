import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { selectResolvedStaticMarkup, selectPageComponents } from '@/store/selectors';

/**
 * Task 3 — the canvas resolves an instance's render base through baseMarkup()
 * (the masters overlay): edited master markup wins, with overrides on top;
 * falls back to frozen staticMarkup when no master entry exists.
 */
function addInstance(doc: Y.Doc, id: string, astroSource: string, staticMarkup: string) {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('astroSource', astroSource);
  el.set('staticMarkup', staticMarkup);
  doc.getMap('elements').set(id, el);
  return el;
}

function addPageWithRoot(doc: Y.Doc, pageId: string, rootId: string) {
  const page = new Y.Map<unknown>();
  page.set('name', 'Home');
  const rootIds = new Y.Array<string>();
  rootIds.push([rootId]);
  page.set('rootElementIds', rootIds);
  doc.getMap('pages').set(pageId, page);
}

describe('canvas render via baseMarkup', () => {
  it('selectResolvedStaticMarkup falls back to staticMarkup with no master', () => {
    const doc = new Y.Doc();
    addInstance(doc, 'el-1', 'Section.astro', '<section><h1>Frozen</h1></section>');
    expect(selectResolvedStaticMarkup(doc, 'el-1')).toContain('Frozen');
  });

  it('selectResolvedStaticMarkup prefers the edited master', () => {
    const doc = new Y.Doc();
    addInstance(doc, 'el-1', 'Section.astro', '<section><h1>Frozen</h1></section>');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section><h1>Edited</h1></section>' });
    const out = selectResolvedStaticMarkup(doc, 'el-1');
    expect(out).toContain('Edited');
    expect(out).not.toContain('Frozen');
  });

  it('selectPageComponents renders the master base with overrides on top', () => {
    const doc = new Y.Doc();
    const el = addInstance(doc, 'el-1', 'Section.astro', '<section><h1>Frozen</h1></section>');
    addPageWithRoot(doc, 'page-1', 'el-1');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section><h1>Edited</h1><p>body</p></section>' });
    const overrides = new Y.Map<Y.Map<unknown>>();
    el.set('overrides', overrides);
    const pOverride = new Y.Map<unknown>();
    pOverride.set('text', 'Overridden body');
    overrides.set('p-0', pOverride);

    const comps = selectPageComponents(doc, 'page-1');
    const markup = comps.map((c) => c.staticMarkup).join('');
    expect(markup).toContain('Edited');
    expect(markup).toContain('Overridden body');
    expect(markup).not.toContain('Frozen');
  });
});

describe('CHILD instance composition honors the masters overlay', () => {
  // Regression (blogcard push-to-master → canvas stays grey): composedMarkup
  // in buildPageComposer read the CHILD's raw staticMarkup, ignoring the
  // masters overlay — while roots, DesignBar and the override sync all read
  // baseMarkup (overlay wins, task-082). A pushed master (e.g. bg-white on
  // the BlogCard) showed in the DesignBar but never rendered on the canvas.
  it('a child instance renders from its edited master, not frozen staticMarkup', () => {
    const doc = new Y.Doc();
    // Root slot with a <slot name="posts"/> placeholder.
    const root = new Y.Map<unknown>();
    root.set('id', 'el-slot');
    root.set('pageId', 'page-1');
    root.set('staticMarkup', '<section><slot name="posts"/></section>');
    doc.getMap('elements').set('el-slot', root);
    // Child card instance (frozen grey markup).
    const card = new Y.Map<unknown>();
    card.set('id', 'el-card');
    card.set('pageId', 'page-1');
    card.set('parentId', 'el-slot');
    card.set('slotName', 'posts');
    card.set('astroSource', 'library/BlogCard.astro');
    card.set('staticMarkup', '<article class="bg-stone-400"><div class="p-4 bg-neutral-400">t</div></article>');
    doc.getMap('elements').set('el-card', card);
    addPageWithRoot(doc, 'page-1', 'el-slot');

    // Push-to-master baked white into the overlay.
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP',
      astroSource: 'library/BlogCard.astro',
      markup: '<article class="bg-stone-400 md:bg-white"><div class="p-4 h-full bg-white">t</div></article>',
    });

    const comps = selectPageComponents(doc, 'page-1');
    const markup = comps.map((c) => c.staticMarkup).join('');
    expect(markup).toContain('bg-white');
    expect(markup).not.toContain('bg-neutral-400'); // frozen child markup must not win
  });
});
