// desktop/probe metrics + gate checks: the pure part of probe/gate.mjs (run JSONs in, metric vector and pass/fail table out).
import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { cellMetrics, fixtureMetrics, laneCounts, lsq, quantile, scenarioFixtureMetrics, t3Metrics } from '../probe/metrics.mjs';
import { evaluateGate, renderTable } from '../probe/checks.mjs';

const GATES = JSON.parse(await fs.readFile(path.resolve(import.meta.dirname, '../probe/gates.json'), 'utf8'));

/** One captured run shaped like the JSON run2.mjs writes: raw editor marks (clock offset 0) plus the analysis fields the metrics read. */
function fakeRun({ scn = 'S1', cell = 1, jStart = 1, rep = 1, edits = [{ service: 20, queue: 0 }, { service: 30, queue: 5 }, { service: 40, queue: 0 }], scans = 6, receiptGets = 4,
  fileReads = 5, layoutPlan = 1, cardTriggers = 3, keyToPaint = [40, 50, 60], ok = true, gaveUp = false, late = false, finalFile = 'w-[300px] rounded', lost = 0, presses = 61 } = {}) {
  const ev = [];
  edits.forEach((e, i) => {
    const t0 = 1000 + i * 1000; const lane = t0 + e.queue; const done = lane + e.service;
    ev.push({ what: 'acc:enter', t: t0 }, { what: 'acc:lane', t: lane });
    for (let k = 0; k < scans; k++) ev.push({ what: 'sc:start', t: lane + 1 + k });
    ev.push({ what: 'ps:mat', t: lane + 2, rc: receiptGets }, { what: 'sc:end', t: lane + 3, rc: 0, n: 1 });
    for (let k = 0; k < fileReads; k++) ev.push({ what: 'lf', t: lane + 4 + k, m: 'GET', r: 'file&file=src%2Fpages%2Findex.astro&probe=1' });
    ev.push({ what: 'lf', t: lane + 5, m: 'GET', r: 'page-source&file=src%2Fpages%2Findex.astro' }); // not a whole-file read
    ev.push({ what: 'lf', t: lane + 6, m: 'GET', r: 'file&file=src%2Fpages%2Findex.astro' }); // no probe flag: not the lane's read
    ev.push({ what: 'acc:published', t: done });
  });
  const after = 1000 + edits.length * 1000 + 500;
  for (let k = 0; k < layoutPlan; k++) ev.push({ what: 'lf', t: after + k, m: 'POST', r: 'layout-plan' });
  for (let k = 0; k < cardTriggers; k++) ev.push({ what: 'lf', t: after + 100 + k, m: 'GET', r: 'pages' });
  ev.push({ what: 'lf', t: after + 200, m: 'GET', r: 'file&file=src%2Fpages%2Findex.astro&probe=1' }); // outside every lane window
  const hold = scn === 'S3' ? { presses, lostIncrements: lost, finalExpected: 161, finalPainted: 161 - lost, key2paint: { p50: 300, p95: 700, max: 800 }, settledAfterLastPress: 800 } : undefined;
  return { scn, param: scn === 'S3' ? 33 : 90, rep, cell, ok, label: 'fake', journalBefore: { accepted: jStart }, rowsAdded: edits.length, loadStart: [5, 5, 5], loadEnd: [6, 5, 5],
    loadGate: { first: 5, waitedMs: 0, now: 5, gaveUp }, calib: { editor: { offset: 0 } }, docs: [{ role: 'editor', data: { ev } }],
    finalPage: { imgs: { 1: finalFile }, bytes: 1000 },
    analysis: ok ? { keys: keyToPaint.length, acceptPhases: { edits: edits.length }, acceptSeries: edits.map(e => [e.service + e.queue, 0, 0, 0, 0, 0, 0, 0, e.queue, 0]),
      keyToPaint: keyToPaint.map((painted, i) => ({ n: 1, expect: 3, painted, frames: 2, dwell: 50, last: i === keyToPaint.length - 1 })),
      perImage: { 1: { expectFinal: 300, finalOk: true, changesAfterFinal: late ? [{ afterOwnLastKey: 4000, w: 30, frames: 1 }] : [] } },
      intermediate: { n: 2, painted: 2, visible2fr: 2 }, hold, ipc: { total: 120, perKeystroke: 12 }, longTasks: { editor: { n: 1, max: 60 }, frame: { n: 0, max: 0 } }, frameGap: { over34: 2 } } : null };
}

it('quantile and lsq are the ones the R11/R12 tables were built with', () => {
  const v = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
  expect(quantile(v, 0.5)).toBe(6); // sorted[floor(10 * 0.5)]
  expect(quantile(v, 0.95)).toBe(10);
  expect(quantile([], 0.5)).toBeNull();
  const fit = lsq([[1, 0], [1, 10], [1, 20], [1, 30]], [3, 8, 13, 18]);
  expect(fit.beta[0]).toBeCloseTo(3); expect(fit.beta[1]).toBeCloseTo(0.5); expect(fit.r2).toBeCloseTo(1);
});

it('counts reads inside each edit\'s own lane window only, and the layout and card traffic of the whole capture', () => {
  const lane = laneCounts(fakeRun({ edits: [{ service: 20, queue: 0 }, { service: 25, queue: 10 }], scans: 6, receiptGets: 2, fileReads: 3, layoutPlan: 2, cardTriggers: 4 }));
  expect(lane.edits).toEqual([{ scans: 6, receiptGets: 2, fileReads: 3 }, { scans: 6, receiptGets: 2, fileReads: 3 }]);
  expect(lane).toMatchObject({ layoutPlanPosts: 2, cardSourceTriggers: 4 });
});

it('reduces the S1 runs of a cell to the vector the gates read', () => {
  const runs = [fakeRun({ rep: 1 }), fakeRun({ rep: 2 })];
  const m = cellMetrics(runs, { planned: 2 });
  expect(m).toMatchObject({ cell: 1, jStart: 1, runsPlanned: 2, runsOk: 2, loadOk: true, S3: null });
  expect(m.S1).toMatchObject({ runs: 2, edits: 6, keys: 6, keysPainted: 6, finalCanvasOk: true, finalFileOk: true, lateChangeRuns: 0, rowsAdded: 6 });
  expect(m.S1.service).toEqual({ n: 6, p50: 30, p95: 40, max: 40 });
  expect(m.S1.accept).toMatchObject({ p50: 35, max: 40 });
  expect(m.S1.keyToPaint).toEqual({ n: 6, p50: 50, p95: 60, max: 60 });
  expect(m.S1.scansPerEdit).toEqual({ p50: 6, max: 6 });
  expect(m.S1.receiptGetsPerEdit).toEqual({ p50: 4, max: 4 });
  expect(m.S1.fileReadsPerEdit).toEqual({ p50: 5, max: 5 });
  expect(m.S1.layoutPlanPostsPerEdit).toBeCloseTo(2 / 6);
  expect(m.S1.cardSourceTriggers).toEqual({ max: 3 });
  expect(m.S1.ipcPerTrigger).toBeCloseTo(120 / 3);
  expect(m.S1.ipcPerKeystroke).toBe(12);
});

it('flags what makes a cell untrustworthy or wrong: a failed run, a load that never settled, a late class change, a wrong final value', () => {
  const m = cellMetrics([fakeRun({ rep: 1 }), fakeRun({ rep: 2, ok: false }), fakeRun({ rep: 3, gaveUp: true, late: true, finalFile: 'w-[30px] rounded' })], { planned: 3 });
  expect(m).toMatchObject({ runsPlanned: 3, runsOk: 2, loadOk: false });
  expect(m.S1).toMatchObject({ runs: 2, lateChangeRuns: 1, finalFileOk: false, finalCanvasOk: true });
});

it('reduces a held-key run: lost increments are the worse of the canvas and the persisted file', () => {
  const m = cellMetrics([fakeRun({ rep: 1 }), fakeRun({ scn: 'S3', lost: 3, finalFile: 'w-[158px]' })], { planned: 2 });
  expect(m.S3).toMatchObject({ runs: 1, presses: 61, lostIncrements: 3 });
  expect(m.S3.keyToPaint).toMatchObject({ p50: 300, p95: 700, max: 800 });
  const fileOnly = cellMetrics([fakeRun({ scn: 'S3', lost: 0, finalFile: 'w-[151px]' })], { planned: 1 });
  expect(fileOnly.S3.lostIncrements).toBe(10);
  expect(cellMetrics([fakeRun({ scn: 'S3', lost: 0, finalFile: 'w-[161px]' })], { planned: 1 }).S3.lostIncrements).toBe(0);
});

it('groups runs by journal-depth cell and fits lane service against the journal length', () => {
  const runs = [];
  for (const j0 of [1, 100, 220]) for (const rep of [1, 2, 3]) runs.push(fakeRun({ cell: j0, rep, jStart: j0 + rep, edits: [0, 1, 2].map(i => ({ service: 10 + 0.5 * (j0 + rep + i), queue: 0 })) }));
  const fx = fixtureMetrics(runs, { planned: 3, pages: 6 });
  expect(fx.cells.map(c => c.cell)).toEqual([1, 100, 220]);
  expect(fx.pages).toBe(6);
  expect(fx.fit.service.n).toBe(27);
  expect(fx.fit.service.a).toBeCloseTo(10, 4); expect(fx.fit.service.b).toBeCloseTo(0.5, 6); expect(fx.fit.service.r2).toBeCloseTo(1, 6);
  expect(fx.fit.serviceS1.b).toBeCloseTo(0.5, 6);
  expect(fixtureMetrics([fakeRun({ cell: null })], { planned: 1 }).cells.map(c => c.cell)).toEqual([null]); // a plan without CELL items
});

// ---------------------------------------------------------------- checks
const cell = (J, over = {}) => ({ cell: J, jStart: J, runsPlanned: 4, runsOk: 4, loadOk: true, S1: { service: { p95: 50 }, scansPerEdit: { max: 1 } }, S3: { lostIncrements: 0 }, ...over });
const vector = (over = {}) => ({ fixtures: { big: { cells: [cell(1), cell(220)], fit: { service: { b: 0.08 } } }, bigpage: { skipped: 'no such fixture' }, ...over } });
const GATE = { fixtures: ['big', 'bigpage'], checks: [
  { id: 'scans', label: 'journal scans per edit', level: 'cell', metric: 'S1.scansPerEdit.max', op: '<=', threshold: 1, baseline: 6, kind: 'structural' },
  { id: 'slope', label: 'service slope', level: 'fixture', metric: 'fit.service.b', op: '<=', threshold: { big: 0.1, owner: 1.3 }, baseline: { big: 0.52 }, kind: 'time' },
  { id: 'p95', label: 'service p95 at the deepest cell', level: 'cell', cells: 'deepest', metric: 'S1.service.p95', op: '<=', threshold: { big: 60 }, kind: 'time' },
  { id: 'lost', label: 'lost increments', level: 'cell', metric: 'S3.lostIncrements', op: '<=', threshold: 0, kind: 'structural' },
] };
const status = (result, id, fixture = 'big', cellJ) => result.rows.filter(r => r.check === id && r.fixture === fixture && (cellJ === undefined || r.cell === cellJ)).map(r => r.status);

it('passes what meets its threshold, reports what has none, and a skipped fixture makes the gate incomplete instead of green', () => {
  const r = evaluateGate(GATE, vector());
  expect(status(r, 'scans')).toEqual(['pass', 'pass']);
  expect(status(r, 'slope')).toEqual(['pass']);
  expect(status(r, 'p95')).toEqual(['pass']); // only the deepest cell
  expect(r.rows.find(c => c.check === 'p95').cell).toBe(220);
  expect(r.rows.find(c => c.fixture === 'bigpage')).toMatchObject({ status: 'skip' });
  expect(r).toMatchObject({ verdict: 'incomplete', exitCode: 4 });
  const noSkip = evaluateGate({ ...GATE, fixtures: ['big'] }, vector());
  expect(noSkip).toMatchObject({ verdict: 'pass', exitCode: 0 });
  expect(evaluateGate({ ...GATE, fixtures: ['big'] }, vector({ big: { cells: [cell(1)], fit: { service: { b: 0.08 } } } })).rows.find(c => c.check === 'slope').baseline).toBe(0.52);
});

it('a miss fails the gate (exit 1) and names the value, the threshold and the baseline', () => {
  const r = evaluateGate({ ...GATE, fixtures: ['big'] }, vector({ big: { cells: [cell(1), cell(220, { S1: { service: { p95: 90 }, scansPerEdit: { max: 6 } } })], fit: { service: { b: 0.52 } } } }));
  expect(status(r, 'scans')).toEqual(['pass', 'fail']);
  expect(status(r, 'slope')).toEqual(['fail']);
  expect(r.rows.find(c => c.check === 'p95')).toMatchObject({ status: 'fail', value: 90, op: '<=', threshold: 60, cell: 220 });
  expect(r).toMatchObject({ verdict: 'fail', exitCode: 1 });
});

it('no threshold for a fixture = report only; missing data is a failure, never a silent pass', () => {
  const noThreshold = evaluateGate({ ...GATE, fixtures: ['tiny'] }, { fixtures: { tiny: { cells: [cell(1)], fit: { service: { b: 99 } } } } });
  expect(status(noThreshold, 'slope', 'tiny')).toEqual(['report']);
  expect(status(noThreshold, 'p95', 'tiny')).toEqual(['report']);
  expect(noThreshold.verdict).toBe('pass');
  const nothing = evaluateGate({ ...GATE, fixtures: ['big'] }, vector({ big: { cells: [cell(1, { S1: null })], fit: { service: null } } }));
  expect(status(nothing, 'scans')).toEqual(['nodata']);
  expect(status(nothing, 'slope')).toEqual(['nodata']);
  expect(nothing).toMatchObject({ verdict: 'fail', exitCode: 1 });
});

it('time checks need a settled machine: a cell that gave up waiting for the load makes them invalid, structural checks still count', () => {
  const r = evaluateGate({ ...GATE, fixtures: ['big'] }, vector({ big: { cells: [cell(1), cell(220, { loadOk: false })], fit: { service: { b: 0.08 } } } }));
  expect(status(r, 'p95')).toEqual(['load']);
  expect(status(r, 'slope')).toEqual(['load']);
  expect(status(r, 'scans')).toEqual(['pass', 'pass']);
  expect(r).toMatchObject({ verdict: 'incomplete', exitCode: 4 });
});

it('"within" reproduces a reference value inside a relative tolerance', () => {
  const gate = { fixtures: ['big'], checks: [{ id: 'r12', label: 'slope vs R12', level: 'fixture', metric: 'fit.service.b', op: 'within', ref: { big: 0.52 }, tol: 0.2, kind: 'time' }] };
  const at = b => evaluateGate(gate, { fixtures: { big: { cells: [cell(1)], fit: { service: { b } } } } }).rows.find(r => r.check === 'r12');
  expect(at(0.45)).toMatchObject({ status: 'pass', threshold: 0.52 });
  expect(at(0.62).status).toBe('pass');
  expect(at(0.63).status).toBe('fail');
  expect(at(0.41).status).toBe('fail');
});

it('every gate also checks that all planned runs completed', () => {
  const r = evaluateGate({ fixtures: ['big'], checks: [] }, vector({ big: { cells: [cell(1, { runsOk: 3 }), cell(220)], fit: {} } }));
  expect(r.rows.filter(c => c.check === 'runs-ok').map(c => [c.cell, c.status])).toEqual([[1, 'fail'], [220, 'pass']]);
  expect(r.exitCode).toBe(1);
  const none = evaluateGate({ fixtures: ['big'], checks: [] }, vector({ big: { cells: [], fit: {} } }));
  expect(none.rows.find(c => c.check === 'runs-ok').status).toBe('nodata');
});

it('every gate also checks that the run never reached the owner\'s app (leaks are counted from the console and main log)', () => {
  const clean = evaluateGate({ fixtures: ['big'], checks: [] }, { ...vector({ big: { cells: [cell(1)], fit: {} } }), isolation: { leaks: 0 } });
  expect(clean.rows.find(c => c.check === 'isolation')).toMatchObject({ status: 'pass', value: 0 });
  const leaked = evaluateGate({ fixtures: ['big'], checks: [] }, { ...vector({ big: { cells: [cell(1)], fit: {} } }), isolation: { leaks: 2 } });
  expect(leaked.rows.find(c => c.check === 'isolation').status).toBe('fail');
});

it('renders one line per row with its status, check, fixture, value and threshold', () => {
  const text = renderTable(evaluateGate(GATE, vector({ big: { cells: [cell(1, { S1: { service: { p95: 50 }, scansPerEdit: { max: 6 } } }), cell(220)], fit: { service: { b: 0.08 } } } })).rows);
  const lines = text.split('\n');
  expect(lines.find(l => l.includes('FAIL'))).toMatch(/scans.*big|big.*scans/);
  expect(lines.some(l => l.includes('PASS'))).toBe(true);
  expect(lines.find(l => l.includes('SKIP'))).toContain('bigpage');
  expect(text).toContain('<= 1');
});

// ---------------------------------------------------------------- gates.json
it('gates.json carries the thresholds of design section 4.3 and the shared cells of G-0, G-L1 and G-L2', () => {
  const g = GATES.gates;
  expect(GATES.loadGate).toBe(13);
  expect(Object.keys(g).sort()).toEqual(['G-0', 'G-D', 'G-L1', 'G-L2', 'G-T1a', 'G-T1b', 'G-T3', 'V2', 'scenarios', 'smoke']);
  for (const name of ['G-D', 'G-T1a', 'G-T1b']) expect(g[name].implemented, name).toBe(false);
  for (const name of ['G-T3', 'V2']) expect(g[name].implemented, name).not.toBe(false);
  const by = (gate, id) => g[gate].checks.find(c => c.id === id);
  expect(by('G-L1', 'scans-per-edit')).toMatchObject({ metric: 'S1.scansPerEdit.max', op: '<=', threshold: 1, baseline: 6 });
  expect(by('G-L1', 'receipt-gets-per-edit')).toMatchObject({ op: '<=', threshold: 0 });
  expect(by('G-L1', 'layout-plan-posts-per-edit')).toMatchObject({ op: '<=', threshold: 0, baseline: 1 });
  expect(by('G-L1', 'file-reads-per-edit')).toMatchObject({ op: '<=', threshold: 2 });
  expect(by('G-L1', 'card-source-triggers')).toMatchObject({ op: '<=', threshold: 2 });
  expect(by('G-L1', 'ipc-per-trigger').threshold, 'reported, not gated').toBeNull();
  expect(by('G-L2', 'service-slope').threshold).toEqual({ owner: 1.3, bigpage: 0.5, big: 0.1 });
  expect(by('G-L2', 'service-slope').baseline).toEqual({ owner: 5.24, bigpage: 3.23, big: 0.52 });
  expect(by('G-L2', 'service-p95-deepest').threshold).toEqual({ owner: 350, bigpage: 150, big: 60 });
  expect(by('G-L2', 'service-p95-deepest').baseline).toEqual({ owner: 1386, bigpage: 754, big: 146 });
  expect(by('G-L2', 'lost-increments')).toMatchObject({ op: '<=', threshold: 0 });
  for (const name of ['G-0', 'G-L1', 'G-L2']) {
    expect(g[name].fixtures, name).toEqual(['tiny', 'big', 'bigpage', 'owner']);
    expect(g[name].run2).toMatchObject({ plan: 'CELL@1*1,CELL@100*1,CELL@220*1', measure: 'S1@90*3,S3@33*1' });
  }
  expect(g.smoke.fixtures).toEqual(['tiny']);
  expect(g.smoke.run2.plan).toBe('S1@90*1');
  for (const name of ['G-L1', 'G-L2']) for (const c of g[name].checks) expect(['structural', 'time'], `${name} ${c.id}`).toContain(c.kind);
});

// ---------------------------------------------------------------- P-1b: scenario cells (G-T3, V2), report-only targets
/** A run of any scenario with the analysis blocks the scenario metrics read. */
function scnRun({ scn = 'S1', param = 90, rep = 1, ok = true, gaveUp = false, t3 = {}, perImage = { 1: { expectFinal: 300, finalOk: true } }, overlay, finalFile = 'w-[300px] rounded', undo, rows, throttle, v2, keyToPaint = [40, 50, 60], noT3 = false } = {}) {
  const totals = { elements: 1, edited: 1, lateOnEdited: 0, collateral: 0, lateMutations: 0, lateValueChanges: 0, lateOther: 0, lateWrongStates: 0, lateVisible: 0, dwellMs: 0, maxDwellMs: 0, noop: 0, neverReached: 0, ...t3 };
  return { scn, param, rep, ok, label: 'fake', loadStart: [5, 5, 5], loadEnd: [6, 5, 5], loadGate: { first: 5, waitedMs: 0, now: 5, gaveUp }, calib: { editor: { offset: 0 } }, docs: [{ role: 'editor', data: { ev: [] } }], finalPage: { imgs: { 1: finalFile }, bytes: 1 },
    analysis: ok ? { keys: keyToPaint.length, acceptSeries: [[30, 0, 0, 0, 0, 0, 0, 0, 0, 0]], keyToPaint: keyToPaint.map((painted, i) => ({ n: 1, expect: 3, painted, frames: 2, dwell: 50, last: i === keyToPaint.length - 1 })), perImage,
      intermediate: { n: 2, painted: 2, visible2fr: 2 }, ipc: { total: 10, perKeystroke: 3 }, longTasks: { editor: { n: 0, max: 0 }, frame: { n: 0, max: 0 } }, frameGap: { over34: 0 },
      ...(noT3 ? { t3: null } : { t3: { source: 'cc', totals, elements: [] } }), ...(overlay ? { overlay } : {}), ...(undo ? { undo } : {}), ...(rows ? { rows } : {}), ...(throttle ? { throttle } : {}), ...(v2 ? { v2 } : {}) } : null };
}

it('t3Metrics sums the late changes of the runs of a cell and keeps the worst dwell; a clean cell is all zeros', () => {
  const m = t3Metrics([scnRun({ t3: { lateMutations: 2, lateOnEdited: 2, lateWrongStates: 1, lateVisible: 1, dwellMs: 40, maxDwellMs: 40 } }), scnRun({ rep: 2 }), scnRun({ rep: 3, t3: { collateral: 1, lateMutations: 1, lateWrongStates: 0, dwellMs: 7, maxDwellMs: 7 } })]);
  expect(m).toMatchObject({ runs: 3, runsLate: 2, lateMutations: 3, lateWrongStates: 1, lateVisible: 1, collateral: 1, dwellMs: { sum: 47, max: 40 }, overlayJumps: null, finalCanvasOk: true, finalFileOk: true, missing: 0 });
  expect(t3Metrics([scnRun(), scnRun({ rep: 2 })])).toMatchObject({ runsLate: 0, lateMutations: 0, dwellMs: { sum: 0, max: 0 } });
});

it('t3Metrics adds the selection-overlay jumps when the runs sampled the overlay, checks painted == typed == disk, and says which runs had no class log', () => {
  const m = t3Metrics([scnRun({ overlay: { 1: { lateSteps: 2 }, 2: { lateSteps: 1 } } }), scnRun({ rep: 2, overlay: { 1: { lateSteps: 0 } } })]);
  expect(m.overlayJumps).toBe(3);
  expect(t3Metrics([scnRun({ perImage: { 1: { expectFinal: 300, finalOk: false } } })]).finalCanvasOk).toBe(false);
  expect(t3Metrics([scnRun({ finalFile: 'w-[30px] rounded' })]).finalFileOk).toBe(false);
  expect(t3Metrics([scnRun({ perImage: { 1: { expectFinal: null, finalOk: null } }, finalFile: 'w-full rounded' })])).toMatchObject({ finalCanvasOk: true, finalFileOk: true }); // S7: no typed final to compare
  const partial = t3Metrics([scnRun(), scnRun({ rep: 2, noT3: true })]);
  expect(partial).toMatchObject({ runs: 1, missing: 1 });
  expect(t3Metrics([scnRun({ noT3: true })])).toBeNull();
  expect(t3Metrics([scnRun({ ok: false })])).toBeNull();
});

it('scenarioFixtureMetrics groups the runs of a fixture by scenario@cadence with their planned count, load flag, T3, typed stats, undo, row kinds and throttle', () => {
  const runs = [scnRun({ scn: 'S1', param: 90, rep: 1 }), scnRun({ scn: 'S1', param: 90, rep: 2, gaveUp: true }), scnRun({ scn: 'S1', param: 150 }),
    scnRun({ scn: 'S7', param: 90, undo: { presses: [], endIsPreEdit: { 1: false }, nonUndoValue: 1 } }),
    scnRun({ scn: 'S10', param: 90, rows: { n: 3, kinds: { 'file-batch': 3 }, files: {}, deferIn: [] } }),
    scnRun({ scn: 'S13', param: 90, throttle: { rate: 4, targets: [{ role: 'editor', ok: true }, { role: 'frame', ok: true }] }, keyToPaint: [30, 45, 80] }), scnRun({ scn: 'S1', param: 40, ok: false })];
  const fx = scenarioFixtureMetrics(runs, { planned: { 'S1@90': 3, 'S1@150': 3, 'S1@40': 1, 'S7@90': 1, 'S10@90': 1, 'S13@90': 1, 'S2@90': 3 }, pages: 1 });
  expect(fx.pages).toBe(1);
  expect(fx.cells.map(c => c.cell)).toEqual(['S1@40', 'S1@90', 'S1@150', 'S2@90', 'S7@90', 'S10@90', 'S13@90']);
  const by = id => fx.cells.find(c => c.cell === id);
  expect(by('S1@90')).toMatchObject({ scn: 'S1', param: 90, runsPlanned: 3, runsOk: 2, loadOk: false, T3: { runs: 2, lateMutations: 0 }, typed: { keysUnpainted: 0 } });
  expect(by('S1@40')).toMatchObject({ runsPlanned: 1, runsOk: 0, T3: null });
  expect(by('S2@90')).toMatchObject({ runsPlanned: 3, runsOk: 0 }); // planned and never produced a run: still a cell, so the gate says "runs-ok failed"
  expect(by('S7@90').undo).toEqual({ endIsPreEdit: false, nonUndoValue: 1 });
  expect(by('S10@90').rows).toEqual({ kinds: { 'file-batch': 3 }, n: 3 });
  expect(by('S13@90')).toMatchObject({ throttle: { rate: 4, bothTargets: true }, typed: { keyToPaint: { p50: 45 } } });
});

it('a threshold of null with a target is report-only: the row says what the target is and never fails the gate; cells named by scenario render as they are', () => {
  const gate = { fixtures: ['big'], checks: [{ id: 'late', label: 'late class changes', level: 'cell', metric: 'T3.lateMutations', op: '<=', threshold: null, target: 0, baseline: '23 of 117 runs', kind: 'structural' },
    { id: 'dwell', label: 'dwell', level: 'cell', metric: 'T3.dwellMs.max', op: '<=', threshold: null, target: 0, kind: 'time' }] };
  const vec = { fixtures: { big: { cells: [{ cell: 'S1@90', runsPlanned: 3, runsOk: 3, loadOk: true, T3: { lateMutations: 4, dwellMs: { max: 40 } } }], fit: {} } } };
  const r = evaluateGate(gate, vec);
  expect(r.rows.find(c => c.check === 'late')).toMatchObject({ status: 'report', value: 4, target: 0, threshold: null, baseline: '23 of 117 runs', cell: 'S1@90' });
  expect(r).toMatchObject({ verdict: 'pass', exitCode: 0 });
  const text = renderTable(r.rows);
  expect(text).toContain('S1@90');
  expect(text).not.toContain('JS1@90');
  expect(text).toMatch(/late\s+big\s+S1@90\s+4\s+target <= 0/);
});

// the plan grammar of run2.mjs and gate.mjs: NAME@param*reps, a name is S1, S7b, S13H, CELL ...
const planItems = plan => plan.split(',').map(x => { const m = /^([A-Z][A-Za-z0-9]*)@(\d+)\*(\d+)$/.exec(x); if (!m) throw new Error(`bad plan item ${x}`); return { scn: m[1], param: +m[2], reps: +m[3] }; });
const runs = (plan, only) => planItems(plan).filter(i => !only || only.includes(i.scn)).reduce((t, i) => t + i.reps, 0);

it('G-T3 runs the scenario list of design 4.3 on every fixture it names: fresh import per run, selection overlay sampled, every target report-only until P0b', () => {
  const g = GATES.gates['G-T3'];
  expect(g).toMatchObject({ implemented: true, slice: 'P0b', metrics: 'scenario' });
  expect(g.fixtures).toEqual(['tiny', 'big', 'huge', 'bigpage', 'owner', 'comp2', 'compbig']);
  const entryFor = f => g.run2.find(e => e.fixtures.includes(f));
  for (const f of g.fixtures) { expect(entryFor(f), f).toBeDefined(); expect(entryFor(f).args, f).toEqual(expect.arrayContaining(['--fresh', '1', '--overlay', '1', '--replaycapture', '1'])); }
  expect(entryFor('tiny').args, 'tiny: a typed 300 pushes image 2 out of the canvas, S2/S6 could not select it').toEqual(expect.arrayContaining(['--text', '150']));
  const main = ['S1@40*3', 'S1@90*3', 'S1@150*3', 'S2@90*3', 'S2O@90*3', 'S6@90*3', 'S7@90*3', 'S7b@90*3', 'S8@90*3', 'S3@33*2'];
  for (const f of ['tiny', 'big', 'huge', 'bigpage', 'owner']) expect(entryFor(f).plan.split(','), f).toEqual(expect.arrayContaining(main));
  for (const f of ['big', 'huge', 'bigpage', 'owner']) expect(entryFor(f).plan.split(','), f).toEqual(expect.arrayContaining(['S4@20*2', 'S4@60*2']));
  expect(entryFor('tiny').plan, 'tiny has two images: no 4-image burst').not.toContain('S4');
  for (const f of ['comp2', 'compbig']) expect(entryFor(f).plan.split(',')).toEqual(['S1@90*2', 'S2@90*2']);
  expect(g.fixtures.reduce((t, f) => t + runs(entryFor(f).plan), 0)).toBeGreaterThanOrEqual(80);
  const by = id => g.checks.find(c => c.id === id);
  for (const c of g.checks) { expect(c.threshold, `${c.id} is report-only`).toBeNull(); expect(c.target, `${c.id} names its target`).not.toBeUndefined(); }
  expect(by('late-class-changes')).toMatchObject({ metric: 'T3.lateMutations', target: 0 });
  expect(by('late-visible')).toMatchObject({ metric: 'T3.lateVisible', target: 0 });
  expect(by('wrong-value-dwell')).toMatchObject({ metric: 'T3.dwellMs.max', target: 0 });
  expect(by('overlay-jumps')).toMatchObject({ metric: 'T3.overlayJumps', target: 0 });
  expect(by('final-canvas')).toMatchObject({ metric: 'T3.finalCanvasOk', target: true });
  expect(by('final-file')).toMatchObject({ metric: 'T3.finalFileOk', target: true });
});

it('V2 is the writer probe: compbig, S1 x6 plain and x6 under CPU throttle x4 (the throttle widens the lane window past a scan\'s arrival), a fresh import per run, the verdict reported', () => {
  const g = GATES.gates.V2;
  expect(g).toMatchObject({ slice: 'P-1', metrics: 'scenario', fixtures: ['compbig'], v2probe: true });
  expect(g.run2.plan).toBe('S1@90*6,S13@90*6');
  expect(g.run2.args).toEqual(expect.arrayContaining(['--fresh', '1']));
  expect(g.checks.find(c => c.id === 'marks-recorded')).toMatchObject({ metric: 'V2.allRunsHaveMarks', op: '==', threshold: true });
  expect(g.checks.find(c => c.id === 'verdict').threshold).toBeNull();
  expect(GATES.gates['G-0'].pending.find(p => p.id === 'v2-writer-probe').note).toContain('gate.mjs V2');
});

it('the plan grammar takes lower-case scenario names (S7b, S13H) in both run2.mjs and gate.mjs', async () => {
  for (const file of ['run2.mjs', 'gate.mjs']) {
    const text = await fs.readFile(path.resolve(import.meta.dirname, '../probe', file), 'utf8');
    expect(text, file).toContain('[A-Z][A-Za-z0-9]*');
    expect(text, file).not.toContain('[A-Z][A-Z0-9]*');
  }
  expect(planItems('S7b@90*3,S13H@33*1')).toEqual([{ scn: 'S7b', param: 90, reps: 3 }, { scn: 'S13H', param: 33, reps: 1 }]);
});

it('a check can name the scenarios it judges: the cells of the others are left alone (the CPU throttle proof only concerns S13 and S13H)', () => {
  const gate = { fixtures: ['big'], checks: [{ id: 'throttle', label: 'both targets throttled', level: 'cell', scn: ['S13', 'S13H'], metric: 'throttle.bothTargets', op: '==', threshold: true, kind: 'structural' }] };
  const cell = (id, scn, over = {}) => ({ cell: id, scn, runsPlanned: 1, runsOk: 1, loadOk: true, ...over });
  const vec = bothTargets => ({ fixtures: { big: { cells: [cell('S1@90', 'S1'), cell('S13@90', 'S13', { throttle: { rate: 4, bothTargets } }), cell('S7@90', 'S7')], fit: {} } } });
  const ok = evaluateGate(gate, vec(true));
  expect(ok.rows.filter(r => r.check === 'throttle').map(r => [r.cell, r.status])).toEqual([['S13@90', 'pass']]);
  expect(ok.exitCode).toBe(0);
  expect(evaluateGate(gate, vec(false)).rows.find(r => r.check === 'throttle').status).toBe('fail');
});

it('the scenarios gate is the harness smoke of the P-1b scenarios: each once on tiny, big and comp2, with the throttle proof and the class log checked', () => {
  const g = GATES.gates.scenarios;
  expect(g).toMatchObject({ slice: 'P-1', metrics: 'scenario', fixtures: ['tiny', 'big', 'comp2'] });
  for (const f of g.fixtures) {
    const entry = g.run2.find(e => e.fixtures.includes(f));
    expect(entry.plan.split(','), f).toEqual(['S7@90*1', 'S7b@90*1', 'S8@90*1', 'S10@90*1', 'S12@5300*1', 'S13@90*1', 'S13H@33*1']);
    expect(entry.args, f).toEqual(expect.arrayContaining(['--fresh', '1', '--overlay', '1', '--rows', '1', '--replaycapture', '1']));
  }
  expect(g.run2.find(e => e.fixtures.includes('tiny')).args, 'tiny: its two images share a flex row, a typed 300 pushes image 2 out of the canvas').toEqual(expect.arrayContaining(['--text', '150']));
  expect(g.checks.find(c => c.id === 'throttle-both-targets')).toMatchObject({ scn: ['S13', 'S13H'], metric: 'throttle.bothTargets', op: '==', threshold: true });
  expect(g.checks.find(c => c.id === 'class-log')).toMatchObject({ metric: 'T3.missing', op: '==', threshold: 0 });
});
