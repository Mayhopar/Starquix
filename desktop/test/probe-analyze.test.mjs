// desktop/probe/analyze.mjs: the blocks the P-1b scenarios need (T3 late-change counts at class and visible level, the undo checks of S7/S7b, the journal row kinds
// of S10, the CPU throttle record of S13, the V2 writer marks) built from SYNTHETIC raw runs shaped like the JSON run2.mjs writes. The old blocks (key-to-paint,
// per-image late changes, S2 switch ...) are not re-tested here: they are pinned by comparing against the R11/R12 raw runs (see the P-1b report).
import { describe, expect, it } from 'vitest';
import { analyzeRun, summaryLine } from '../probe/analyze.mjs';

const KEYS = [{ ch: '3', t0: 100, t1: 104, expect: 3 }, { ch: '0', t0: 190, t1: 194, expect: 30 }, { ch: '0', t0: 280, t1: 284, expect: 300 }];
const cc = (t, old, val, extra = {}) => ({ t, id: extra.id ?? 1, n: extra.n ?? 1, eid: '', tag: 'IMG', old, val });
const INITIAL = 'w-full rounded';
const TYPED = [cc(108, INITIAL, 'w-[3px] rounded'), cc(198, 'w-[3px] rounded', 'w-[30px] rounded'), cc(288, 'w-[30px] rounded', 'w-[300px] rounded')];

/** A run: image 1 (and 2) sampled every 16 ms; `widths(t)` = [w1, w2]; `records` = the class mutations the canvas recorder logged (`cc`). */
function rawRun({ records = TYPED, widths = () => [311, 192], marks = [], typedKeys = KEYS, tStop = 4000, editor = {}, extra = {}, cls = [] } = {}) {
  const frames = []; for (let t = 0; t <= tStop; t += 16) frames.push([t, t, ...widths(t).flatMap(w => [w, 100])]);
  return {
    scn: 'S1', param: 90, rep: 1, nImages: 2, img1: 1, img2: 2, calib: { editor: { offset: 0 }, frame: { offset: 0 } }, cfg: { nImages: 2 }, ipc: [], disk: [], ws: [], loadStart: [1], loadEnd: [1],
    nodeLog: [{ t: 0, what: 'capture-start' }, { t: 90, what: 'initial', n: 1, cls: INITIAL }, ...(typedKeys ? [{ t: 285, what: 'typed', n: 1, text: '300', delay: 90, keys: typedKeys }] : []), ...marks, { t: tStop, what: 'capture-stop' }],
    docs: [{ docId: 'e1', role: 'editor', data: editor }, { docId: 'f1', role: 'frame', data: { frames, cls, cc: records } }], ...extra };
}
const stepWidths = steps => t => { let w = 311; for (const [at, v] of steps) if (t >= at) w = v; return [w, 192]; };
const CLEAN = stepWidths([[110, 3], [200, 30], [290, 300]]);

describe('analyzeRun: T3 class-level and visible-frame late changes', () => {
  it('a clean typed run: every element settles on its final value and nothing changes after it', () => {
    const a = analyzeRun(rawRun({ widths: CLEAN }));
    expect(a.t3).toMatchObject({ source: 'cc', totals: { lateMutations: 0, lateWrongStates: 0, lateVisible: 0, collateral: 0, edited: 1, dwellMs: 0 } });
    const el = a.t3.elements[0];
    expect(el).toMatchObject({ label: 1, edited: true, initial: 'rounded w-full', final: 'rounded w-[300px]', neverReached: false });
    expect(el.timeline.map(s => [s.at, s.cls])).toEqual([[8, 'w-[3px] rounded'], [98, 'w-[30px] rounded'], [188, 'w-[300px] rounded']]);
    expect(el.reachedAt).toBe(188); expect(el.lastInputAt).toBe(184);
  });

  it('a stale class after the final value: counted at class level (2 mutations, 1 wrong state, 40 ms) and visible (a frame stood on it); the width log agrees', () => {
    const records = [...TYPED, cc(1200, 'w-[300px] rounded', 'w-[30px] rounded'), cc(1240, 'w-[30px] rounded', 'w-[300px] rounded')];
    const widths = t => (t >= 1200 && t < 1240 ? [30, 192] : CLEAN(t));
    const a = analyzeRun(rawRun({ records, widths }));
    expect(a.t3.totals).toMatchObject({ lateMutations: 2, lateOnEdited: 2, lateWrongStates: 1, lateVisible: 1, dwellMs: 40, maxDwellMs: 40 });
    expect(a.t3.elements[0].late).toMatchObject({ mutations: 2, valueChanges: 2, wrongStates: 1, visibleWrong: 1, dwellMs: 40 });
    expect(a.perImage[1].changesAfterFinal.length).toBeGreaterThan(0); // the old rAF-level block still sees it
    expect(summaryLine({ ...rawRun({ records, widths }), analysis: a, ok: true })).toContain('T3 late 2');
  });

  it('class level and visible level differ: a wrong class that lasted 5 ms between two frame ticks is counted, not visible', () => {
    const records = [...TYPED, cc(1203, 'w-[300px] rounded', 'w-[30px] rounded'), cc(1208, 'w-[30px] rounded', 'w-[300px] rounded')];
    const a = analyzeRun(rawRun({ records, widths: CLEAN }));
    expect(a.t3.totals).toMatchObject({ lateMutations: 2, lateWrongStates: 1, lateVisible: 0, dwellMs: 5 });
  });

  it('an element nobody touched whose class changes is collateral, whatever page element it is', () => {
    const records = [...TYPED, { t: 900, id: 5, n: null, eid: '', tag: 'SECTION', old: 'mt-6 flex', val: 'mt-6 flex gap-4' }];
    const a = analyzeRun(rawRun({ records, widths: CLEAN }));
    expect(a.t3.totals).toMatchObject({ collateral: 1, lateMutations: 1, lateOnEdited: 0 });
    expect(a.t3.elements.find(e => e.tag === 'SECTION')).toMatchObject({ edited: false, collateral: 1, label: 'section@5' });
  });

  it('a run recorded before the `cc` buffer existed falls back to the probe-image `cls` log, flagged as such; no class log at all is null, not zero', () => {
    const old = analyzeRun(rawRun({ records: null, widths: CLEAN, cls: [{ t: 108, n: 1, attr: 'class', old: INITIAL, val: 'w-[3px] rounded' }, { t: 198, n: 1, attr: 'class', old: 'w-[3px] rounded', val: 'w-[30px] rounded' }, { t: 288, n: 1, attr: 'class', old: 'w-[30px] rounded', val: 'w-[300px] rounded' },
      { t: 1200, n: 1, attr: 'class', old: 'w-[300px] rounded', val: 'w-[30px] rounded' }, { t: 1204, n: 1, attr: 'class', old: 'w-[30px] rounded', val: 'w-[300px] rounded' }, { t: 1300, n: 1, attr: 'data-sq-source-version', old: 'a', val: 'b' }] }));
    expect(old.t3).toMatchObject({ source: 'cls', totals: { lateMutations: 2, lateWrongStates: 1 } });
    const none = analyzeRun(rawRun({ records: [], widths: CLEAN }));
    expect(none.t3).toMatchObject({ source: 'cc', totals: { lateMutations: 0, elements: 0 } });
    const absent = rawRun({ widths: CLEAN }); delete absent.docs[1].data.cc; delete absent.docs[1].data.cls;
    expect(analyzeRun(absent).t3).toBeNull();
  });

  it('inputs come from every kind of mark: typed keys and Enter, a hold, a discrete click, an undo; the last one decides when the final value had to arrive', () => {
    const marks = [{ t: 700, what: 'hold', key: 'ArrowUp', n: 1, count: 2, interval: 33, ts: [650, 683] }, { t: 800, what: 'click', i: 0, n: 1, label: 'Fit', expect: 'contain', t0: 790, t1: 800 }, { t: 900, what: 'undo', k: 1, n: 1, t0: 880, t1: 890, target: 'initial' }];
    const records = [...TYPED, cc(905, 'w-[300px] rounded', INITIAL)];
    const a = analyzeRun(rawRun({ records, marks, widths: CLEAN }));
    expect(a.t3.elements[0]).toMatchObject({ lastInputAt: 890 - 100, reachedAt: 905 - 100, neverReached: false, late: { mutations: 0 } });
  });
});

describe('analyzeRun: undo checks (S7, S7b)', () => {
  const press = (k, n, t0, target) => ({ t: t0 + 10, what: 'undo', k, n, t0, t1: t0 + 10, target, focus: 'blur' });
  const base = [{ t: 90, what: 'initial', n: 2, cls: 'w-48 rounded' }];

  it('S7 as the design wants it: one Cmd-Z puts the pre-edit class back and nothing else changes after it', () => {
    const records = [...TYPED, cc(1300, 'w-[300px] rounded', INITIAL)];
    const a = analyzeRun(rawRun({ records, marks: [press(1, 1, 1280, 'initial')], widths: CLEAN }));
    expect(a.undo.presses).toEqual([expect.objectContaining({ k: 1, n: 1, target: 'initial', painted: true, paintMs: 20, nonUndoValue: 0, endSatisfied: true, focus: 'blur' })]);
    expect(a.undo.endIsPreEdit).toEqual({ 1: true });
    expect(a.undo.nonUndoValue).toBe(0);
  });

  it('S7 against today\'s code: one Cmd-Z only takes the last digit back (3 undo steps per typed number), so the pre-edit class is never painted', () => {
    const records = [...TYPED, cc(1300, 'w-[300px] rounded', 'w-[30px] rounded')];
    const a = analyzeRun(rawRun({ records, marks: [press(1, 1, 1280, 'initial')], widths: CLEAN }));
    expect(a.undo.presses[0]).toMatchObject({ painted: false, paintMs: null, nonUndoValue: 1, endSatisfied: false });
    expect(a.undo.endIsPreEdit).toEqual({ 1: false });
  });

  it('class changes after the press that are not the undo value count: a late typed paint before the undo, and the edit value flashing back after it', () => {
    const records = [cc(108, INITIAL, 'w-[3px] rounded'), cc(1500, 'w-[3px] rounded', 'w-[30px] rounded'), cc(1600, 'w-[30px] rounded', INITIAL), cc(3100, INITIAL, 'w-[30px] rounded'), cc(3140, 'w-[30px] rounded', INITIAL)];
    const a = analyzeRun(rawRun({ records, marks: [press(1, 1, 1280, 'initial')], widths: CLEAN }));
    expect(a.undo.presses[0]).toMatchObject({ painted: true, paintMs: 320, nonUndoValue: 2, endSatisfied: true });
    expect(a.t3.elements[0].late).toMatchObject({ wrongStates: 1, mutations: 2 }); // the flash after the undo value arrived is also a T3 late change
  });

  it('an undo the canvas then loses (the one-shot restore re-applies the edit value after the replay) is late wrong states, judged against the pre-edit class, and endIsPreEdit says false', () => {
    const records = [cc(108, INITIAL, 'w-[3px] rounded'), cc(1300, 'w-[3px] rounded', INITIAL), cc(5200, INITIAL, 'w-[3px] rounded'), cc(5203, 'w-[3px] rounded', INITIAL), cc(5400, INITIAL, 'w-[3px] rounded')];
    const a = analyzeRun(rawRun({ records, marks: [press(1, 1, 1280, 'initial')], widths: CLEAN, tStop: 6000 }));
    expect(a.t3.elements[0]).toMatchObject({ final: 'rounded w-full', neverReached: false, late: { mutations: 3, wrongStates: 2 } });
    expect(a.undo.endIsPreEdit).toEqual({ 1: false });
    expect(a.undo.presses[0]).toMatchObject({ painted: true, endSatisfied: false });
  });

  it('S7b: three undos over two images, each judged against its own target until the next undo of the same element', () => {
    const two = (t, old, val) => cc(t, old, val, { id: 2, n: 2 });
    const records = [cc(100, INITIAL, 'w-[2px] rounded'), cc(700, 'w-[2px] rounded', 'w-[3px] rounded'), two(1400, 'w-48 rounded', 'w-[4px] rounded'),
      two(2500, 'w-[4px] rounded', 'w-48 rounded'), cc(3500, 'w-[3px] rounded', 'w-[2px] rounded'), cc(4500, 'w-[2px] rounded', INITIAL)];
    const marks = [...base, press(1, 2, 2480, 'initial'), press(2, 1, 3480, { has: ['w-[2px]'], not: ['w-[3px]'] }), press(3, 1, 4480, 'initial')];
    const a = analyzeRun(rawRun({ records, marks, typedKeys: null, widths: () => [311, 192], tStop: 6000 }));
    expect(a.undo.presses.map(p => [p.k, p.n, p.painted, p.nonUndoValue, p.endSatisfied])).toEqual([[1, 2, true, 0, true], [2, 1, true, 0, true], [3, 1, true, 0, true]]);
    expect(a.undo.endIsPreEdit).toEqual({ 1: true, 2: true });
    expect(a.undo.nonUndoValue).toBe(0);
  });
});

describe('analyzeRun: journal rows, throttle, no numeric final', () => {
  it('summarises the row kinds the run added to the journal (S10: V1 class-write rows are deferred, V2/V3 file-batch rows are not)', () => {
    const journalRows = [{ rev: 5, op: 'a', commands: [{ kind: 'file-batch', files: ['src/pages/index.astro:100>101', 'src/components/Photo.astro:114>140'] }] },
      { rev: 6, op: 'b', commands: [{ kind: 'file-batch', files: ['src/pages/index.astro:101>102'] }] }, { rev: 7, op: 'c', commands: [{ kind: 'class-write', files: [], cls: 'w-[3px]', deferIn: 4997 }] }];
    const a = analyzeRun(rawRun({ widths: CLEAN, extra: { journalRows } }));
    expect(a.rows).toEqual({ n: 3, kinds: { 'file-batch': 2, 'class-write': 1 }, files: { 'src/pages/index.astro': 2, 'src/components/Photo.astro': 1 }, deferIn: [4997] });
  });

  it('carries the CPU throttle record of an S13 run into the analysis', () => {
    const throttle = { rate: 4, targets: [{ role: 'editor', ok: true, ratio: 3.9 }, { role: 'frame', ok: true, ratio: 4.1 }] };
    expect(analyzeRun(rawRun({ widths: CLEAN, extra: { throttle } })).throttle).toEqual(throttle);
    expect(analyzeRun(rawRun({ widths: CLEAN })).throttle ?? null).toBeNull();
  });

  it('a scenario whose end state is not the typed number (S7) says so: no numeric final expectation, canvas and file checks are null', () => {
    const marks = [{ t: 1000, what: 'burst-end', final: { 1: null } }];
    const a = analyzeRun(rawRun({ widths: CLEAN, marks }));
    expect(a.perImage[1]).toMatchObject({ expectFinal: null, finalOk: null });
  });

  it('carries the V2 writer verdict inputs when the editor marks exist, and nothing when they do not', () => {
    const ev = [{ t: 120, what: 'cls:set', key: 'c/ex.astro:1:1', cls: 'w-[3px]', op: 'aaa111' }, { t: 130, what: 'v2:write', origin: 'durable-edit:class-edit:…aaa111', local: true, w: [{ key: 'src/ex.astro:1:1', act: 'update', now: 'w-[3px]' }] },
      { t: 131, what: 'v2:csv', b: 'entry' }, { t: 131, what: 'v2:sync', key: 'c/ex.astro:1:1', op: 'aaa111', v: 'w-[3px]', e: 'w-[3px]' }];
    const withMarks = analyzeRun(rawRun({ widths: CLEAN, editor: { ev } }));
    expect(withMarks.v2).toMatchObject({ symptoms: 0, edits: [expect.objectContaining({ op: 'aaa111', typed: 'w-[3px]' })] });
    expect(analyzeRun(rawRun({ widths: CLEAN })).v2 ?? null).toBeNull();
  });
});

describe('analyzeRun: selection-overlay jumps (cfg.overlay, --overlay 1)', () => {
  // the box follows the image one frame behind: its width at frame t is the image width at t - 16
  const overlayRun = flash => {
    const widths = t => [flash && t >= 1200 && t < 1240 ? 30 : CLEAN(t)[0], 192];
    const records = flash ? [...TYPED, cc(1200, 'w-[300px] rounded', 'w-[30px] rounded'), cc(1240, 'w-[30px] rounded', 'w-[300px] rounded')] : TYPED;
    const run = rawRun({ records, widths, extra: { iframeGeom: { x: 0, y: 0, w: 375, lw: 375 }, cfg: { nImages: 2, overlay: true } } });
    run.docs[1].data.frames = run.docs[1].data.frames.map(r => [...r, 0, 0, 0, 0]); // x, y of the two images
    run.docs[0].data.frames = run.docs[1].data.frames.map(r => [r[0], r[1], '300', [[0, 0, widths(r[1] - 16)[0], 100]]]);
    return run;
  };

  it('counts the selection-box steps after the box first showed the final width: none when the page is calm, the flash and its restore when it jumps', () => {
    expect(analyzeRun(overlayRun(false)).overlay[1]).toMatchObject({ lateSteps: 0, lateStepList: [] });
    const a = analyzeRun(overlayRun(true));
    expect(a.overlay[1]).toMatchObject({ lateSteps: 2 });
    expect(a.overlay[1].lateStepList.map(st => st.w)).toEqual([30, 300]);
  });
});
