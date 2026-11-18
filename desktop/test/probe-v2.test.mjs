// V2 writer probe (desktop/probe/v2probe.mjs): from the editor marks of a compbig S1 run (cls:set, v2:write, v2:csv, v2:sync, v2:seed, v2:reg, cls:accepted) decide
// whether the V2 symptom (a canvas SYNC or the live doc carrying an older class than the one just typed) comes from the stale-scan mechanism (the observer
// reads the latest SCAN class: currentSourceClassValue branch scan-stale-owner; design 3.1 mechanism 1) or the client-id overwrite (a live-doc write that races the
// staged update of the edit and wins by client id; design 3.1 mechanism 2), and name the writer.
import { describe, expect, it } from 'vitest';
import { marksOfRun, v2Report, v2Run, v2Verdict } from '../probe/v2probe.mjs';

const KEY = 'src/pages/index.astro:34:7~p4317f4b4863ead18';
const K = KEY.slice(-14);
let clock = 0;
const mk = (what, data = {}, dt = 1) => ({ t: (clock += dt), what, ...data });
const OP = ['aaa111', 'bbb222', 'ccc333'];
const TYPED = ['w-[3px]', 'w-[30px]', 'w-[300px]'];
const origin = op => `durable-edit:class-edit:…${op}`;

/** One edit as the editor marks it when nothing goes wrong: ask, apply (live-doc write), observer SYNC, accepted. `over` overrides pieces. */
function edit(i, over = {}) {
  const typed = TYPED[i]; const op = OP[i];
  return [
    mk('cls:set', { key: K, cls: typed, op }, 20),
    mk('acc:enter', { op }),
    ...(over.before?.() ?? []),
    mk('v2:write', { origin: origin(op), local: true, w: [{ key: KEY, act: over.act ?? 'update', old: TYPED[i - 1] ?? 'w-full', now: over.doc ?? typed }] }, 30),
    mk('v2:csv', { b: over.branch ?? 'entry' }, 0),
    mk('v2:sync', { key: K, op, v: over.sync ?? typed, e: over.doc ?? typed, s: over.scan ?? null, sv: 'sva', ov: over.ov ?? 'sva' }, 0),
    mk('cls:accepted', { key: K, typed, doc: over.accepted ?? over.doc ?? typed }, 5),
  ];
}

describe('v2Run: one run of marks', () => {
  it('a clean run (every apply, SYNC and accepted doc equals what was typed) has no symptom', () => {
    clock = 0;
    const r = v2Run([...edit(0), ...edit(1), ...edit(2)]);
    expect(r.edits).toHaveLength(3);
    expect(r.edits.map(e => e.typed)).toEqual(TYPED);
    expect(r.edits.map(e => [e.applied?.now, e.syncs[0].v, e.syncs[0].branch, e.accepted?.doc])).toEqual(TYPED.map(t => [t, t, 'entry', t]));
    expect(r).toMatchObject({ symptoms: 0, mechanisms: {} });
  });

  it('stale scan: the third SYNC carries an older class through the scan-stale-owner branch while the live doc is right', () => {
    clock = 0;
    const r = v2Run([...edit(0), ...edit(1), ...edit(2, { sync: 'w-[30px]', branch: 'scan-stale-owner', scan: 'w-[30px]', ov: 'svb' })]);
    expect(r.symptoms).toBe(1);
    expect(r.mechanisms).toEqual({ 'stale-scan': 1 });
    expect(r.edits[2]).toMatchObject({ symptom: true, mechanism: 'stale-scan', docOverwritten: false, syncStale: true });
    expect(r.edits[2].syncs[0]).toMatchObject({ v: 'w-[30px]', e: 'w-[300px]', branch: 'scan-stale-owner' });
  });

  it('client-id overwrite: a scan seed wrote the live entry inside the lane window and the staged class lost, so the doc (and the SYNC) carry the older class', () => {
    clock = 0;
    const seedWindow = () => [mk('v2:seed', { key: K, now: 'w-[30px]', master: 'w-full' }), mk('v2:write', { origin: 'null', local: true, w: [{ key: KEY, act: 'update', old: 'w-[30px]', now: 'w-[30px]' }] })];
    const r = v2Run([...edit(0), ...edit(1), ...edit(2, { before: seedWindow, act: 'other', doc: 'w-[30px]' })]);
    expect(r.symptoms).toBe(1);
    expect(r.mechanisms).toEqual({ 'client-id-overwrite': 1 });
    expect(r.edits[2]).toMatchObject({ docOverwritten: true, mechanism: 'client-id-overwrite', writer: 'scan-seed' });
    expect(r.edits[2].foreign.map(f => f.tag)).toEqual(['scan-seed']);
    expect(r.writes.find(w => w.origin === 'null')).toMatchObject({ tag: 'scan-seed', key: KEY, act: 'update', now: 'w-[30px]' });
  });

  it('names registerElement as the writer when its mark precedes the foreign write, and reports foreign writes that did no harm', () => {
    clock = 0;
    const reg = () => [mk('v2:reg', { b: 'external', key: K, old: 'w-[3px]', now: 'w-[3px]x' }), mk('v2:write', { origin: 'sync', local: true, w: [{ key: KEY, act: 'update', old: 'a', now: 'b' }] })];
    const r = v2Run([...edit(0), ...edit(1, { before: reg }), ...edit(2)]);
    expect(r.symptoms).toBe(0);
    expect(r.edits[1].foreign.map(f => f.tag)).toEqual(['register:external']);
    expect(r.foreign).toBe(1);
  });

  it('a stale SYNC from another branch is a symptom nobody explained', () => {
    clock = 0;
    const r = v2Run([...edit(0), ...edit(1, { sync: 'w-[3px]', branch: 'carrier' })]);
    expect(r.edits[1]).toMatchObject({ symptom: true, mechanism: 'unclassified:carrier' });
    expect(r.mechanisms).toEqual({ 'unclassified:carrier': 1 });
  });

  it('timestamps go through rel and an edit with no marks of its own stays harmless', () => {
    clock = 0;
    const r = v2Run([mk('cls:set', { key: K, cls: 'w-[3px]', op: 'zzz999' })], t => t * 10);
    expect(r.edits[0]).toMatchObject({ typed: 'w-[3px]', setAt: 10, applied: null, syncs: [], accepted: null, symptom: false });
  });
});

describe('v2Verdict: all the runs', () => {
  const run = marks => v2Run(marks);
  it('no marks at all is no data, not a clean bill', () => {
    expect(v2Verdict([v2Run([])])).toMatchObject({ mechanism: 'no-data', runsWithMarks: 0 });
    expect(v2Verdict([]).mechanism).toBe('no-data');
  });

  it('no symptom in any run: not reproduced, with the counts that say how much was looked at', () => {
    clock = 0;
    const v = v2Verdict([run([...edit(0), ...edit(1), ...edit(2)]), run([...edit(0), ...edit(1), ...edit(2)])]);
    expect(v).toMatchObject({ mechanism: 'not-reproduced', runs: 2, runsWithMarks: 2, edits: 6, symptoms: 0 });
    expect(v.verdict).toMatch(/not reproduced/i);
    expect(v.verdict).toMatch(/2 runs/);
  });

  it('one mechanism or the other is named with its writer; both seen is both', () => {
    clock = 0;
    const stale = run([...edit(0), ...edit(1), ...edit(2, { sync: 'w-[30px]', branch: 'scan-stale-owner' })]);
    const over = run([...edit(0), ...edit(1), ...edit(2, { before: () => [mk('v2:seed', { key: K, now: 'x', master: 'y' }), mk('v2:write', { origin: 'null', w: [{ key: KEY, act: 'update', now: 'w-[30px]' }] })], act: 'other', doc: 'w-[30px]' })]);
    const a = v2Verdict([stale, run([...edit(0), ...edit(1), ...edit(2)])]);
    expect(a).toMatchObject({ mechanism: 'stale-scan', symptoms: 1, runsWithSymptom: 1 });
    expect(a.verdict).toMatch(/stale-scan/);
    const b = v2Verdict([over]);
    expect(b).toMatchObject({ mechanism: 'client-id-overwrite', writers: { 'scan-seed': 1 } });
    expect(b.verdict).toMatch(/scan-seed/);
    expect(v2Verdict([stale, over]).mechanism).toBe('both');
  });
});

describe('v2Report', () => {
  it('prints the verdict, a per-run edit table and the mark excerpt around the first symptom', () => {
    clock = 0;
    const marks = [...edit(0), ...edit(1), ...edit(2, { sync: 'w-[30px]', branch: 'scan-stale-owner' })];
    const text = v2Report([{ name: 'compbig-S1-p90-r1', marks, result: v2Run(marks) }]);
    expect(text).toContain('stale-scan');
    expect(text).toContain('compbig-S1-p90-r1');
    expect(text).toMatch(/w-\[30px\].*scan-stale-owner/s);
    expect(text).toContain('v2:sync');
  });
});

describe('marksOfRun: the editor marks plus the scans the canvas reported, in time order', () => {
  it('merges ELEMENTS_SCANNED messages from the canvas into the marks (where a scan landed against a lane window is the evidence for both mechanisms), on the runner clock', () => {
    const run = { calib: { editor: { offset: 100 } }, docs: [
      { role: 'editor', data: { ev: [{ t: 10, what: 'cls:set', key: K, cls: 'a', op: 'x' }, { t: 30, what: 'v2:write', origin: 'sync', w: [] }, { t: 1, what: 'start' }], msg: [{ t: 20, type: 'ELEMENTS_SCANNED', self: false, n: 12 }, { t: 25, type: 'SYNC_CLASSES_TO_IFRAME', self: true }, { t: 26, type: 'ELEMENTS_SCANNED', self: true }] } },
      { role: 'frame', data: { ev: [{ t: 5, what: 'cls:set' }] } }] };
    expect(marksOfRun(run).map(m => [m.what, m.t])).toEqual([['start', 101], ['cls:set', 110], ['msg:ELEMENTS_SCANNED', 120], ['v2:write', 130]]);
    expect(marksOfRun(run).find(m => m.what === 'msg:ELEMENTS_SCANNED').n).toBe(12);
  });

  it('keeps the SYNC mark right behind the branch mark it explains, even when their timestamps are equal', () => {
    const run = { calib: { editor: { offset: 0 } }, docs: [{ role: 'editor', data: { ev: [{ t: 5, what: 'v2:csv', b: 'carrier' }, { t: 5, what: 'v2:sync', key: K, op: 'x', v: 'a', e: 'a' }], msg: [{ t: 5, type: 'ELEMENTS_SCANNED', self: false }] } }] };
    expect(marksOfRun(run).map(m => m.what).filter(w => w.startsWith('v2:'))).toEqual(['v2:csv', 'v2:sync']);
  });
});
