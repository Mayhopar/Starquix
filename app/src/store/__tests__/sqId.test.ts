/**
 * task-118 — data-sq-id minting: override-creating commands stamp a stable id
 * onto the target element in masters[astroSource].markup so a later structural
 * source edit can rebind the override (selectorRemap.ts). Doc-only, NO rev
 * bump (ledger #21 — the id is semantically invisible; a bump would flip ↻).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand, addKeysToMarkup } from '../commands';
import { readMasterMarkupRev, selectMasterMarkup, MASTERS_MAP } from '../masters';
import { mintSqId } from '../sqId';

const RAW = '<section class="p-10"><div>hello</div><p>world</p></section>';

function seedInstance(doc: Y.Doc, id = 'el-1', astroSource: string | null = 'Section.astro') {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  if (astroSource) el.set('astroSource', astroSource);
  el.set('staticMarkup', addKeysToMarkup(RAW, id));
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

const idOn = (markup: string | undefined, tag: string): string | undefined =>
  new RegExp(`<${tag}[^>]*data-sq-id="([A-Za-z0-9_-]+)"`).exec(markup ?? '')?.[1];

describe('mintSqId', () => {
  it('mints 6-char base36, avoiding collisions', () => {
    const id = mintSqId('');
    expect(id).toMatch(/^[a-z0-9]{6}$/);
    // collision avoidance: markup already containing an id never re-mints it
    const taken = mintSqId('');
    expect(mintSqId(`<div data-sq-id="${taken}">`)).not.toBe(taken);
  });
});

describe('ensureSqIdInMasters via override commands', () => {
  it('UPDATE_THEME_INSTANCE_CLASS_OVERRIDE mints data-sq-id into masters markup, NO rev bump (#21)', () => {
    const doc = new Y.Doc();
    seedInstance(doc);
    expect(selectMasterMarkup(doc, 'Section.astro')).toBeUndefined();

    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'],
    });

    const markup = selectMasterMarkup(doc, 'Section.astro');
    const minted = idOn(markup, 'div');
    expect(minted).toMatch(/^[a-z0-9]{6}$/);
    expect(idOn(markup, 'p')).toBeUndefined(); // only the overridden element (ledger #29)
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(0); // no rev bump

    // second dispatch reuses the same id (no re-mint)
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold', 'text-xl'],
    });
    expect(idOn(selectMasterMarkup(doc, 'Section.astro'), 'div')).toBe(minted);
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(0);
  });

  it('reuses an EXISTING masters entry markup and does not clobber its rev', () => {
    const doc = new Y.Doc();
    seedInstance(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: RAW }); // rev 1
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(1);

    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-1', selector: 'p-0', breakpoint: 'base', classes: ['italic'],
    });
    expect(idOn(selectMasterMarkup(doc, 'Section.astro'), 'p')).toBeDefined();
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(1); // untouched
  });

  it('no-op for elements without astroSource (drawn/source-key domains)', () => {
    const doc = new Y.Doc();
    seedInstance(doc, 'drawn-1', null);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'drawn-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'],
    });
    expect(doc.getMap(MASTERS_MAP).size).toBe(0);
  });

  it('non-selector keys (dynamic:*, blogcard) never mint (#32)', () => {
    const doc = new Y.Doc();
    seedInstance(doc);
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-1', selector: 'blogcard', breakpoint: 'base', classes: ['x'],
    });
    expect(doc.getMap(MASTERS_MAP).size).toBe(0);
  });

  it('UPDATE_SOURCE_CLASSES with instance-child sourceKey mints; source-domain key skips', () => {
    const doc = new Y.Doc();
    seedInstance(doc);
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: 'el-1:div-0', classes: 'text-red-500',
    });
    expect(idOn(selectMasterMarkup(doc, 'Section.astro'), 'div')).toBeDefined();

    // file:line:col source-domain key → out of scope, no mint, no crash
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: 'src/Hero.astro:5:1', classes: 'text-blue-500',
    });
    expect(doc.getMap(MASTERS_MAP).size).toBe(1);
  });

  it('UPDATE_SOURCE_TEXT mints too', () => {
    const doc = new Y.Doc();
    seedInstance(doc);
    applyCommand(doc, { type: 'UPDATE_SOURCE_TEXT', sourceKey: 'el-1:p-0', textContent: 'hi' });
    expect(idOn(selectMasterMarkup(doc, 'Section.astro'), 'p')).toBeDefined();
  });

  it('DELETE_INSTANCE_CHILD mints (deletion must survive structural edits)', () => {
    const doc = new Y.Doc();
    seedInstance(doc);
    applyCommand(doc, { type: 'DELETE_INSTANCE_CHILD', instanceId: 'el-1', selector: 'div-0' });
    expect(idOn(selectMasterMarkup(doc, 'Section.astro'), 'div')).toBeDefined();
  });

  it('undo reverts both the override and the minted id together (#24)', () => {
    const doc = new Y.Doc();
    const el = seedInstance(doc);
    const undoMgr = new Y.UndoManager(
      [doc.getMap('elements'), doc.getMap(MASTERS_MAP)],
      { trackedOrigins: new Set([null]) }
    );
    applyCommand(doc, {
      type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE',
      instanceId: 'el-1', selector: 'div-0', breakpoint: 'base', classes: ['font-bold'],
    });
    expect(selectMasterMarkup(doc, 'Section.astro')).toContain('data-sq-id');

    undoMgr.undo();
    expect(selectMasterMarkup(doc, 'Section.astro') ?? '').not.toContain('data-sq-id');
    const overrides = el.get('classOverrides') as Y.Map<unknown> | undefined;
    expect(overrides?.has('div-0') ?? false).toBe(false);
  });
});
