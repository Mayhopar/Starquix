import * as Y from 'yjs';
import { afterEach, describe, expect, it } from 'vitest';
import { currentSourceClassValue, SOURCE_CLASS_CARRIERS } from '../sourceClassIdentity';

// The V2 writer probe (desktop/probe, docs/plans/2026-11-17-instant-edit-gates/V2-writer-probe.md) has to say WHICH branch of
// currentSourceClassValue produced the value the observer posts to the canvas: an accepted carrier, the latest scan (the entry owner is proven
// to be another element), the entry's own class, or the scan as the fallback for an entry with no class. One `v2:csv` mark per call, never a change.
type Hook = (what: string, data?: Record<string, unknown>) => void;
const g = globalThis as unknown as { __sqProbeMark?: Hook };
afterEach(() => { delete g.__sqProbeMark; });

const loc = (over: Record<string, unknown> = {}) => ({ file: 'src/pages/index.astro', line: 34, column: 7, sourceVersion: 'sva', sourceRevision: 1, ...over });
function docWithEntry(classes: string | undefined, owner: Record<string, unknown> | undefined) {
  const doc = new Y.Doc();
  const entry = new Y.Map<unknown>();
  doc.getMap('sourceClasses').set('k', entry);
  if (classes !== undefined) entry.set('classes', classes);
  if (owner) entry.set('sourceLocation', new Y.Map(Object.entries(owner)));
  return { doc, entry };
}
const collect = () => { const seen: Array<Record<string, unknown> | undefined> = []; g.__sqProbeMark = (what, data) => { if (what === 'v2:csv') seen.push(data); }; return seen; };

describe('currentSourceClassValue marks the branch that produced its value', () => {
  it('carrier: an accepted edit newer than the scan, at the scan\'s own address', () => {
    const { doc, entry } = docWithEntry('w-[3px]', loc());
    doc.getMap<string>(SOURCE_CLASS_CARRIERS).set('c1', JSON.stringify({ owner: loc(), view: loc(), revision: 5, classes: 'w-[300px]' }));
    const seen = collect();
    expect(currentSourceClassValue(entry, { sourceLocation: loc(), classes: 'w-[30px]' }, doc)).toBe('w-[300px]');
    expect(seen).toEqual([{ b: 'carrier' }]);
  });

  it('scan-stale-owner: the entry owner is another element (file bytes differ), so the latest SCAN class wins over the entry', () => {
    const { doc, entry } = docWithEntry('w-[300px]', loc({ sourceVersion: 'sva' }));
    const seen = collect();
    expect(currentSourceClassValue(entry, { sourceLocation: loc({ sourceVersion: 'svb', sourceRevision: 2 }), classes: 'w-[30px]' }, doc)).toBe('w-[30px]');
    expect(seen).toEqual([{ b: 'scan-stale-owner' }]);
  });

  it('entry: the owner is the scanned element, so the entry class is the value', () => {
    const { doc, entry } = docWithEntry('w-[300px]', loc());
    const seen = collect();
    expect(currentSourceClassValue(entry, { sourceLocation: loc({ sourceRevision: 9 }), classes: 'w-[30px]' }, doc)).toBe('w-[300px]');
    expect(seen).toEqual([{ b: 'entry' }]);
  });

  it('scan-fallback: an entry with no class falls back to the scan', () => {
    const { doc, entry } = docWithEntry(undefined, undefined);
    const seen = collect();
    expect(currentSourceClassValue(entry, { sourceLocation: loc(), classes: 'w-[30px]' }, doc)).toBe('w-[30px]');
    expect(seen).toEqual([{ b: 'scan-fallback' }]);
  });

  it('with no scan target the entry class is returned and the mark says entry', () => {
    const { doc, entry } = docWithEntry('w-[300px]', loc());
    const seen = collect();
    expect(currentSourceClassValue(entry, undefined, doc)).toBe('w-[300px]');
    expect(seen).toEqual([{ b: 'entry' }]);
  });

  it('returns exactly the same values without the recorder hook (the marks never change what the app does)', () => {
    const stale = docWithEntry('w-[300px]', loc({ sourceVersion: 'sva' }));
    const plain = docWithEntry('w-[300px]', loc());
    const none = docWithEntry(undefined, undefined);
    expect(currentSourceClassValue(stale.entry, { sourceLocation: loc({ sourceVersion: 'svb' }), classes: 'w-[30px]' }, stale.doc)).toBe('w-[30px]');
    expect(currentSourceClassValue(plain.entry, { sourceLocation: loc(), classes: 'w-[30px]' }, plain.doc)).toBe('w-[300px]');
    expect(currentSourceClassValue(none.entry, { sourceLocation: loc(), classes: 'w-[30px]' }, none.doc)).toBe('w-[30px]');
    expect(currentSourceClassValue(none.entry, undefined, none.doc)).toBeUndefined();
  });
});
