import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { bakeEditorMaster } from '@/utils/bakeEditorMaster';
import { selectMasterMarkup, selectMasterChildOverrides } from '@/store/masters';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { applyCommand } from '@/store/commands';

/**
 * Task 4 — the component-editor flush bakes the editor element's resolved
 * markup (base + its child overrides) into the masters overlay, keyed by the
 * editor element's astroSource. This is the dev persistence + propagation that
 * replaces the task-077 localStorage tier and the .astro round-trip.
 */
function editorEl(doc: Y.Doc, id: string, astroSource: string | undefined, staticMarkup: string) {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', COMPONENT_EDITOR_PAGE_ID);
  if (astroSource) el.set('astroSource', astroSource);
  el.set('staticMarkup', staticMarkup);
  doc.getMap('elements').set(id, el);
  return el;
}

describe('bakeEditorMaster', () => {
  it('bakes a child text override into masters[astroSource]', () => {
    const doc = new Y.Doc();
    const el = editorEl(doc, 'ed-1', 'Card.astro', '<div><h1>Original</h1></div>');
    const overrides = new Y.Map<Y.Map<unknown>>();
    el.set('overrides', overrides);
    const o = new Y.Map<unknown>();
    o.set('text', 'Baked Title');
    overrides.set('h1-0', o);

    const ok = bakeEditorMaster(doc, 'ed-1');
    expect(ok).toBe(true);
    const master = selectMasterMarkup(doc, 'Card.astro');
    expect(master).toContain('Baked Title');
    expect(master).not.toContain('Original');
  });

  it('no-ops (returns false) when the editor element has no astroSource', () => {
    const doc = new Y.Doc();
    editorEl(doc, 'ed-1', undefined, '<div><h1>x</h1></div>');
    expect(bakeEditorMaster(doc, 'ed-1')).toBe(false);
  });

  it('returns false when the element is missing', () => {
    const doc = new Y.Doc();
    expect(bakeEditorMaster(doc, 'nope')).toBe(false);
  });
});

describe('bakeEditorMaster mirrors child instance overrides into childOverrides (task-098)', () => {
  const SLOT_PATH = 'src/components/library/BlogSlot.astro';
  const CARD_PATH = 'src/components/library/BlogCard.astro';
  const PLACEHOLDER = `<sq-child data-sq-astro-source="${CARD_PATH}" data-sq-placement="posts" data-sq-slot-fallback="posts"></sq-child>`;

  function seedEditorWithCard(doc: Y.Doc) {
    const editor = editorEl(doc, 'ed-1', SLOT_PATH, `<section><slot name="posts">${PLACEHOLDER}</slot></section>`);
    const card = new Y.Map<unknown>();
    card.set('id', 'card-1');
    card.set('pageId', COMPONENT_EDITOR_PAGE_ID);
    card.set('parentId', 'ed-1');
    card.set('slotName', 'posts');
    card.set('placementKey', 'posts');
    card.set('astroSource', CARD_PATH);
    card.set('staticMarkup', '<div class="bg-stone-200"><h3>t</h3></div>');
    card.set('classOverrides', new Y.Map());
    doc.getMap('elements').set('card-1', card);
    return { editor, card };
  }

  it('bakes a child classOverride into masters[parent].childOverrides; placeholders survive the bake', () => {
    const doc = new Y.Doc();
    seedEditorWithCard(doc);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'card-1', selector: 'div-0', breakpoint: 'base', classes: ['bg-rose-500'],
    });

    expect(bakeEditorMaster(doc, 'ed-1')).toBe(true);
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'div-0': { base: ['bg-rose-500'] } } });
    // Regression guard: applyAllOverrides must not strip the placeholder tag.
    expect(selectMasterMarkup(doc, SLOT_PATH)).toContain('<sq-child');
  });

  it('merges per-selector: pre-existing selectors on the same placement survive', () => {
    const doc = new Y.Doc();
    seedEditorWithCard(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH,
      placementKey: 'posts', overrides: { 'h3-0': { base: ['font-bold'] } },
    });
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'card-1', selector: 'div-0', breakpoint: 'base', classes: ['bg-rose-500'],
    });

    bakeEditorMaster(doc, 'ed-1');
    expect(selectMasterChildOverrides(doc, SLOT_PATH).posts).toEqual({
      'h3-0': { base: ['font-bold'] },
      'div-0': { base: ['bg-rose-500'] },
    });
  });

  it('bake is ONE masters transaction — persistence saver must see the complete state at once', () => {
    // Regression (red fill lost on fast reload): markup + childOverrides used to
    // land in TWO transactions; the 400ms leading save wrote the first half and
    // the trailing write (with the childOverrides) died with the page.
    const doc = new Y.Doc();
    seedEditorWithCard(doc);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'card-1', selector: 'div-0', breakpoint: 'base', classes: ['bg-rose-500'],
    });
    let fires = 0;
    doc.getMap('masters').observeDeep(() => { fires += 1; });
    bakeEditorMaster(doc, 'ed-1');
    expect(fires).toBe(1);
  });

  it('child with empty classOverrides leaves the existing childOverrides entry untouched', () => {
    const doc = new Y.Doc();
    seedEditorWithCard(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SLOT_PATH, markup: '<section></section>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SLOT_PATH,
      placementKey: 'posts', overrides: { 'h3-0': { base: ['font-bold'] } },
    });

    bakeEditorMaster(doc, 'ed-1');
    expect(selectMasterChildOverrides(doc, SLOT_PATH)).toEqual({ posts: { 'h3-0': { base: ['font-bold'] } } });
  });
});
