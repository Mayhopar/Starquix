import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { serializeMasters, rebuildMasters, selectMasterChildOverrides, baseMarkup } from '@/store/masters';

const PARENT = 'src/components/library/BlogSlot.astro';

describe('masters childOverrides', () => {
  it('SET_MASTER_CHILD_OVERRIDES upserts one placement entry', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: PARENT, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT,
      placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } },
    });
    expect(selectMasterChildOverrides(doc, PARENT)).toEqual({ posts: { 'div-0': { base: ['bg-white'] } } });
  });

  it('SET_MASTER_CHILD_OVERRIDES with null overrides deletes the placement entry', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: PARENT, markup: '<section></section>' });
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } } });
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: null });
    expect(selectMasterChildOverrides(doc, PARENT)).toEqual({});
  });

  it('childOverrides survive serialize → rebuild round-trip', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: PARENT, markup: '<section></section>' });
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } } });
    const data = serializeMasters(doc)!;
    const doc2 = new Y.Doc();
    rebuildMasters(doc2, data);
    expect(selectMasterChildOverrides(doc2, PARENT)).toEqual({ posts: { 'div-0': { base: ['bg-white'] } } });
  });

  it('SET_MASTER_CHILD_OVERRIDES on a missing master entry is a safe no-op', () => {
    const doc = new Y.Doc();
    expect(() => applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: 'nope.astro', placementKey: 'x', overrides: {} })).not.toThrow();
    expect(selectMasterChildOverrides(doc, 'nope.astro')).toEqual({});
  });
});

const CARD = 'src/components/library/BlogCard.astro';

/** Parent placement el + child card el (parentId→parent, slotName='posts', astroSource=BlogCard). */
function seedParentChild(doc: Y.Doc) {
  const elements = doc.getMap<Y.Map<unknown>>('elements');
  const parent = new Y.Map<unknown>();
  parent.set('id', 'parent-1'); parent.set('astroSource', PARENT);
  elements.set('parent-1', parent);
  const card = new Y.Map<unknown>();
  card.set('id', 'card-1'); card.set('parentId', 'parent-1');
  card.set('slotName', 'posts'); card.set('astroSource', CARD);
  card.set('staticMarkup', '<div class="bg-stone-200"><h3>t</h3></div>');
  elements.set('card-1', card);
  return { parent, card };
}

describe('baseMarkup layers parent childOverrides', () => {
  it('layers masters[parent].childOverrides[slotName] onto a child element', () => {
    const doc = new Y.Doc();
    const { card } = seedParentChild(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: CARD, markup: '<div class="bg-stone-200"><h3>t</h3></div>' });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: PARENT, markup: '<section></section>' });
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } } });
    expect(baseMarkup(doc, card)).toContain('class="bg-white"');
    expect(baseMarkup(doc, card)).not.toContain('bg-stone-200');
  });

  it('layers onto the staticMarkup fallback path too (child master never edited)', () => {
    const doc = new Y.Doc();
    const { card } = seedParentChild(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: PARENT, markup: '<section></section>' });
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } } });
    expect(baseMarkup(doc, card)).toContain('class="bg-white"');
  });

  it('unchanged for a child whose parent has no childOverrides entry', () => {
    const doc = new Y.Doc();
    const { card } = seedParentChild(doc);
    expect(baseMarkup(doc, card)).toBe('<div class="bg-stone-200"><h3>t</h3></div>');
  });

  it('stampCache invalidates when childOverrides change', () => {
    const doc = new Y.Doc();
    const { card } = seedParentChild(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: CARD, markup: '<div class="bg-stone-200"><h3>t</h3></div>' });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: PARENT, markup: '<section></section>' });
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: { 'div-0': { base: ['bg-white'] } } });
    expect(baseMarkup(doc, card)).toContain('bg-white');
    applyCommand(doc, { type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: PARENT, placementKey: 'posts', overrides: { 'div-0': { base: ['bg-rose-500'] } } });
    expect(baseMarkup(doc, card)).toContain('bg-rose-500');
  });
});
