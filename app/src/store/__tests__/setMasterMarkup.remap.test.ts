/**
 * task-118 — SET_MASTER_MARKUP structural remap: when a component's markup
 * changes shape, positional override keys are rewritten via computeSelectorRemap
 * (data-sq-id anchor, fingerprint fallback) in the same transaction; unmatched
 * data-holding selectors become overrideOrphans records — never silently dropped.
 * Ledger: docs/plans/2026-07-17-task-118-structural-safe-overrides-design.md §8.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { applyCommand, addKeysToMarkup } from '../commands';
import { readMasterMarkupRev, selectMasterMarkup, selectMasterChildOverrides, MASTERS_MAP } from '../masters';
import { ORPHANS_MAP, type OverrideOrphan } from '../overrideOrphans';

const SRC = 'Section.astro';

/** Seed an instance and create an override through the real command path
 *  (mints the data-sq-id anchor + masters entry). */
function seedOverridden(doc: Y.Doc, id = 'el-1', raw = '<section><div>hello</div><p>world</p></section>') {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  el.set('astroSource', SRC);
  el.set('staticMarkup', addKeysToMarkup(raw, id));
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

function classOverrideOn(el: Y.Map<unknown>, selector: string): string[] | undefined {
  const co = el.get('classOverrides') as Y.Map<unknown> | undefined;
  const entry = co?.get(selector) as Y.Map<Y.Array<string>> | undefined;
  return entry ? (entry.get('base') as Y.Array<string>).toArray() : undefined;
}

function orphans(doc: Y.Doc): OverrideOrphan[] {
  const out: OverrideOrphan[] = [];
  doc.getMap(ORPHANS_MAP).forEach((v) => out.push(v as OverrideOrphan));
  return out;
}

describe('SET_MASTER_MARKUP structural remap', () => {
  it('sibling insert: classOverrides + sourceClasses/sourceText keys remapped on ALL placements (#1,#17)', () => {
    const doc = new Y.Doc();
    const el1 = seedOverridden(doc, 'el-1');
    const el2 = seedOverridden(doc, 'el-2');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'] });
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: 'el-2:div-0', classes: 'text-red-500' });
    applyCommand(doc, { type: 'UPDATE_SOURCE_TEXT', sourceKey: 'el-2:div-0', textContent: 'edited' });

    // structural edit: new div inserted BEFORE the overridden one
    const master = selectMasterMarkup(doc, SRC)!; // carries minted ids
    const edited = master.replace('<div', '<div>new one</div><div');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: edited });

    expect(classOverrideOn(el1, 'div-1')).toEqual(['font-bold']);
    expect(classOverrideOn(el1, 'div-0')).toBeUndefined();
    const sc = doc.getMap('sourceClasses');
    const st = doc.getMap('sourceText');
    expect((sc.get('el-2:div-1') as Y.Map<unknown>).get('classes')).toBe('text-red-500');
    expect(sc.has('el-2:div-0')).toBe(false);
    expect((st.get('el-2:div-1') as Y.Map<unknown>).get('textContent')).toBe('edited');
    expect(orphans(doc)).toEqual([]);
  });

  it('override survives when another element is orphan-ambiguous but holds no data (#12)', () => {
    const doc = new Y.Doc();
    const el = seedOverridden(doc, 'el-1', '<section><ul><li>item</li></ul><p>world</p></section>');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'p-0', breakpoint: 'base', classes: ['italic'] });

    // li duplicated (ambiguous, no id, no data) — p keeps its id anchor
    const master = selectMasterMarkup(doc, SRC)!;
    const edited = master.replace('</ul>', '<li>item</li></ul>');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: edited });

    expect(classOverrideOn(el, 'p-0')).toEqual(['italic']);
    expect(orphans(doc)).toEqual([]); // li held no data → no orphan record
  });

  it('deleted overridden element → overrideOrphans entry with snapshot, live entries removed (#2)', () => {
    const doc = new Y.Doc();
    const el = seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'] });
    applyCommand(doc, { type: 'UPDATE_SOURCE_TEXT', sourceKey: 'el-1:div-0', textContent: 'bye' });
    const master = selectMasterMarkup(doc, SRC)!;
    const sqId = /data-sq-id="([a-z0-9]+)"/.exec(master)![1];

    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<section><p>world</p></section>' });

    const o = orphans(doc);
    expect(o).toHaveLength(1);
    expect(o[0]).toMatchObject({
      astroSource: SRC,
      instanceId: 'el-1',
      oldSelector: 'div-0',
      sqId,
      fingerprint: { tag: 'div' },
    });
    const stores = o[0].entries.map((e) => e.store).sort();
    expect(stores).toEqual(['classOverrides', 'sourceText']);
    expect(classOverrideOn(el, 'div-0')).toBeUndefined();
    expect(doc.getMap('sourceText').has('el-1:div-0')).toBe(false);
  });

  it('deletedSelectors whose target vanished from source: dropped with console.info, NOT orphaned (#15)', () => {
    const doc = new Y.Doc();
    const el = seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-1', selector: 'div-0' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<section><p>world</p></section>' });

    expect((el.get('deletedSelectors') as Y.Array<string>).toArray()).toEqual([]);
    expect(orphans(doc)).toEqual([]);
    expect(info).toHaveBeenCalled();
    info.mockRestore();
  });

  it('unchanged markup → no remap, no rev bump (#23)', () => {
    const doc = new Y.Doc();
    seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<section>a</section>' });
    expect(readMasterMarkupRev(doc, SRC)).toBe(1);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<section>a</section>' });
    expect(readMasterMarkupRev(doc, SRC)).toBe(1);
  });

  it('id-only diff (graft round) → NO rev bump: rev compares id-stripped markup (#21/#22)', () => {
    const doc = new Y.Doc();
    seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'] });
    const withId = selectMasterMarkup(doc, SRC)!;
    expect(withId).toContain('data-sq-id');
    expect(readMasterMarkupRev(doc, SRC)).toBe(0);

    // a sync round re-delivers the same structure WITHOUT the doc-only id
    const shed = withId.replace(/\s+data-sq-id="[a-z0-9]+"/, '');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: shed });

    expect(selectMasterMarkup(doc, SRC)).toContain('data-sq-id'); // grafted back
    expect(readMasterMarkupRev(doc, SRC)).toBe(0); // id-only diff ≠ real change
  });

  it('first sync, no masters entry, two placements with different frozen staticMarkup → per-distinct-markup remap (#14)', () => {
    const doc = new Y.Doc();
    // legacy (pre-feature) overrides: seeded directly, NO masters entry, no ids
    const el1 = seedOverridden(doc, 'el-1', '<section><div>alpha</div><p>world</p></section>');
    const el2 = seedOverridden(doc, 'el-2', '<section><span>pad</span><div>alpha</div><p>world</p></section>');
    for (const [el, sel] of [[el1, 'div-0'], [el2, 'div-0']] as const) {
      const co = new Y.Map<unknown>();
      const slot = new Y.Map<unknown>();
      const base = new Y.Array<string>();
      base.push(['font-bold']);
      slot.set('base', base);
      co.set(sel, slot);
      el.set('classOverrides', co);
    }
    expect(doc.getMap(MASTERS_MAP).size).toBe(0);

    // new source: div shifted by an inserted sibling div
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: SRC,
      markup: '<section><div>intro</div><div>alpha</div><p>world</p></section>',
    });

    // el-1: unique tag+text 'alpha' → div-1; el-2 same via ITS OWN frozen markup
    expect(classOverrideOn(el1, 'div-1')).toEqual(['font-bold']);
    expect(classOverrideOn(el2, 'div-1')).toEqual(['font-bold']);
  });

  it('undo restores markup + keys + removes orphans coherently (#24)', () => {
    const doc = new Y.Doc();
    const el = seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'] });
    const before = selectMasterMarkup(doc, SRC)!;
    const undoMgr = new Y.UndoManager(
      [doc.getMap('elements'), doc.getMap(MASTERS_MAP), doc.getMap(ORPHANS_MAP)],
      { trackedOrigins: new Set([null]), captureTimeout: 0 }
    );

    // production dispatch wraps applyCommand in ONE doc.transact (PagesContext)
    doc.transact(() => {
      applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<section><p>world</p></section>' });
    });
    expect(orphans(doc)).toHaveLength(1);

    undoMgr.undo();
    expect(selectMasterMarkup(doc, SRC)).toBe(before);
    expect(orphans(doc)).toEqual([]);
    expect(classOverrideOn(el, 'div-0')).toEqual(['font-bold']);
  });

  it('masters childOverrides placementKey subSelectors remapped; vanished ones orphaned', () => {
    const doc = new Y.Doc();
    seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<div class="card"><h3 data-sq-id="abc123">t</h3><em>keepless</em></div>' });
    applyCommand(doc, {
      type: 'SET_MASTER_CHILD_OVERRIDES', astroSource: SRC, placementKey: 'posts',
      overrides: { 'h3-0': { base: ['font-bold'] }, 'em-0': { base: ['italic'] } },
    });

    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: SRC,
      markup: '<div class="card"><p>lead</p><h3 data-sq-id="abc123">t</h3></div>', // em deleted, h3 keeps id
    });

    const co = selectMasterChildOverrides(doc, SRC);
    expect(co.posts['h3-0']).toEqual({ base: ['font-bold'] }); // h3 index unchanged (own counter)
    expect(co.posts['em-0']).toBeUndefined();
    const o = orphans(doc);
    expect(o).toHaveLength(1);
    expect(o[0].entries[0].store).toBe('masters.childOverrides');
  });

  it('swap-safe rekey: div-0↔div-1 exchange does not clobber either override', () => {
    const doc = new Y.Doc();
    const el = seedOverridden(doc, 'el-1', '<section><div data-sq-id="aaaaaa">first</div><div data-sq-id="bbbbbb">second</div></section>');
    // seed masters from frozen markup via a real override on each div
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['a'] });
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-1', breakpoint: 'base', classes: ['b'] });

    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: SRC,
      markup: '<section><div data-sq-id="bbbbbb">second</div><div data-sq-id="aaaaaa">first</div></section>',
    });

    expect(classOverrideOn(el, 'div-0')).toEqual(['b']);
    expect(classOverrideOn(el, 'div-1')).toEqual(['a']);
  });

  it('DISCARD_OVERRIDE_ORPHAN deletes the record; false for unknown id', () => {
    const doc = new Y.Doc();
    seedOverridden(doc, 'el-1');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'] });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: SRC, markup: '<section><p>world</p></section>' });
    const map = doc.getMap(ORPHANS_MAP);
    expect(map.size).toBe(1);
    const orphanId = [...map.keys()][0];

    expect(applyCommand(doc, { type: 'DISCARD_OVERRIDE_ORPHAN', orphanId: 'nope' })).toBe(false);
    expect(map.size).toBe(1);
    applyCommand(doc, { type: 'DISCARD_OVERRIDE_ORPHAN', orphanId });
    expect(map.size).toBe(0);
  });

  it('orderOverrides / renderOrderOverrides / deletedSelectors values remapped', () => {
    const doc = new Y.Doc();
    const el = seedOverridden(doc, 'el-1', '<section data-sq-id="rooot1"><div data-sq-id="aaaaaa">x</div><div data-sq-id="bbbbbb">y</div><p data-sq-id="cccccc">z</p></section>');
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['a'] });
    const order = new Y.Array<string>();
    order.push(['div-1', 'div-0', 'p-0']);
    el.set('orderOverrides', order);
    const roo = new Y.Map<Y.Array<string>>();
    const rooArr = new Y.Array<string>();
    rooArr.push(['div-1', 'div-0']);
    roo.set('section-0', rooArr);
    el.set('renderOrderOverrides', roo);
    const dels = new Y.Array<string>();
    dels.push(['p-0']);
    el.set('deletedSelectors', dels);

    // insert a sibling div at the front → indices shift by one
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP', astroSource: SRC,
      markup: '<section data-sq-id="rooot1"><div>new</div><div data-sq-id="aaaaaa">x</div><div data-sq-id="bbbbbb">y</div><p data-sq-id="cccccc">z</p></section>',
    });

    expect((el.get('orderOverrides') as Y.Array<string>).toArray()).toEqual(['div-2', 'div-1', 'p-0']);
    const newRoo = el.get('renderOrderOverrides') as Y.Map<Y.Array<string>>;
    expect(newRoo.get('section-0')!.toArray()).toEqual(['div-2', 'div-1']);
    expect((el.get('deletedSelectors') as Y.Array<string>).toArray()).toEqual(['p-0']);
  });
});
