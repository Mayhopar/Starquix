// Run JSONs (probe/run2.mjs) -> the metric vector the gates read. Pure: no IO. Everything here is derived from the raw editor marks
// (app/src/utils/probeMark.ts: acc:*, sc:*, ps:*, lf) and the fields analyze.mjs computes; vocabulary: desktop/test/probe-harness.test.mjs.
import { wOf } from './analyze.mjs';
import { v2Verdict } from './v2probe.mjs';

/** Same quantile the R11/R12 tables were built with. */
export const quantile = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const sum = a => a.reduce((x, y) => x + y, 0);
const max = a => (a.length ? Math.max(...a) : null);
const stats = a => ({ n: a.length, p50: round(quantile(a, 0.5)), p95: round(quantile(a, 0.95)), max: round(max(a)) });
const median = a => round(quantile(a, 0.5));

/** Least squares (normal equations, small k), as aged-agg.mjs: { beta, r2 } or null for a singular system. */
export function lsq(X, y) {
  const k = X[0].length; const A = Array.from({ length: k }, () => new Array(k + 1).fill(0));
  X.forEach((row, n) => { for (let i = 0; i < k; i++) { for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j]; A[i][k] += row[i] * y[n]; } });
  for (let i = 0; i < k; i++) { let p = i; for (let r = i + 1; r < k; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r; [A[i], A[p]] = [A[p], A[i]]; if (Math.abs(A[i][i]) < 1e-12) return null;
    for (let r = 0; r < k; r++) if (r !== i) { const m = A[r][i] / A[i][i]; for (let c = i; c <= k; c++) A[r][c] -= m * A[i][c]; } }
  const beta = A.map((row, i) => row[k] / row[i]); const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0); const ssRes = y.reduce((s, v, n) => s + (v - X[n].reduce((t, x, i) => t + x * beta[i], 0)) ** 2, 0);
  return { beta, r2: ssTot ? 1 - ssRes / ssTot : null };
}

/** The editor's probe marks of a run on the runner's clock, oldest first. */
const marksOf = run => run.docs.filter(d => d.role === 'editor').flatMap(d => d.data.ev ?? []).filter(e => e.what && !/^(start|pagehide|visibility)/.test(e.what))
  .map(e => ({ ...e, t: e.t + run.calib.editor.offset })).sort((a, b) => a.t - b.t);

/** Per accepted edit (marks between its acc:lane and acc:published): journal scans, receipt gets, whole-file reads (GET file...probe=1); and for the whole
 *  capture the layout-plan POSTs and the card-source triggers (GET pages: each re-reads every page's source, 1 + P calls). */
export function laneCounts(run) {
  const ev = marksOf(run); const of = k => ev.filter(e => e.what === k);
  const lane = of('acc:lane'); const done = of('acc:published');
  const edits = Array.from({ length: Math.min(lane.length, done.length) }, (_, i) => {
    const win = ev.filter(e => e.t >= lane[i].t && e.t <= done[i].t); const n = k => win.filter(e => e.what === k);
    return { scans: n('sc:start').length, receiptGets: sum(n('ps:mat').map(e => e.rc ?? 0)) + sum(n('sc:end').map(e => e.rc ?? 0)),
      fileReads: n('lf').filter(e => e.m === 'GET' && /^file[?&]/.test(String(e.r)) && String(e.r).includes('probe=1')).length };
  });
  const lf = of('lf');
  return { edits, layoutPlanPosts: lf.filter(e => e.m === 'POST' && String(e.r).startsWith('layout-plan')).length, cardSourceTriggers: lf.filter(e => e.m === 'GET' && e.r === 'pages').length };
}

const service = a => (a.acceptSeries ?? []).map(x => x[0] - (x[8] ?? 0)); // lane service = total - queue wait
const typedImages = a => Object.entries(a.perImage ?? {});
const filePx = (run, n) => wOf(run.finalPage?.imgs?.[n]);

function typedMetrics(runs) { // S1: type 300 at 90 ms per key
  const A = runs.map(r => r.analysis); const lanes = runs.map(laneCounts); const edits = lanes.flatMap(l => l.edits);
  const per = f => { const v = edits.map(f); return { p50: median(v), max: round(max(v)) }; };
  const k2p = A.flatMap(a => (a.keyToPaint ?? []).filter(k => k.painted != null).map(k => k.painted));
  const nEdits = sum(A.map(a => a.acceptSeries?.length ?? 0)); const triggers = lanes.map(l => l.cardSourceTriggers); const keys = sum(A.map(a => a.keys ?? 0));
  const ipc = sum(A.map(a => a.ipc?.total ?? 0)); const perKey = A.map(a => a.ipc?.perKeystroke).filter(v => v != null);
  return { runs: runs.length, edits: nEdits, keys, keysPainted: k2p.length, keysUnpainted: keys - k2p.length,
    service: stats(A.flatMap(service)), accept: stats(A.flatMap(a => (a.acceptSeries ?? []).map(x => x[0]))), keyToPaint: stats(k2p),
    partialsPainted: sum(A.map(a => a.intermediate?.painted ?? 0)), partialsOf: sum(A.map(a => a.intermediate?.n ?? 0)),
    lateChangeRuns: A.filter(a => typedImages(a).some(([, p]) => p.changesAfterFinal?.length) || a.switch?.img1ChangesAfterClick?.length).length,
    finalCanvasOk: A.every(a => typedImages(a).every(([, p]) => p.finalOk)),
    finalFileOk: runs.every(r => typedImages(r.analysis).every(([n, p]) => filePx(r, n) === p.expectFinal)),
    rowsAdded: sum(runs.map(r => r.rowsAdded ?? 0)),
    scansPerEdit: per(e => e.scans), receiptGetsPerEdit: per(e => e.receiptGets), fileReadsPerEdit: per(e => e.fileReads),
    layoutPlanPostsPerEdit: nEdits ? round(sum(lanes.map(l => l.layoutPlanPosts)) / nEdits, 3) : null,
    cardSourceTriggers: { max: max(triggers) }, ipcPerTrigger: sum(triggers) ? round(ipc / sum(triggers)) : null, ipcPerKeystroke: median(perKey),
    longTasks: { editor: { n: max(A.map(a => a.longTasks?.editor?.n ?? 0)), max: max(A.map(a => a.longTasks?.editor?.max ?? 0)) }, frame: { n: max(A.map(a => a.longTasks?.frame?.n ?? 0)), max: max(A.map(a => a.longTasks?.frame?.max ?? 0)) } } };
}

function holdMetrics(runs) { // S3: hold ArrowUp 2 s at 33 ms repeat
  const holds = runs.map(r => r.analysis.hold).filter(Boolean); const A = runs.map(r => r.analysis);
  const lost = runs.filter(r => r.analysis.hold).map(r => { const h = r.analysis.hold; const px = filePx(r, 1); return Math.max(h.lostIncrements ?? 0, typeof px === 'number' ? h.finalExpected - px : 0); }); // the worse of the canvas and the persisted file
  return { runs: runs.length, presses: max(holds.map(h => h.presses)), lostIncrements: max(lost),
    keyToPaint: { p50: median(holds.map(h => h.key2paint?.p50).filter(v => v != null)), p95: max(holds.map(h => h.key2paint?.p95).filter(v => v != null)), max: max(holds.map(h => h.key2paint?.max).filter(v => v != null)) },
    settledAfterLastPress: max(holds.map(h => h.settledAfterLastPress).filter(v => v != null)), service: stats(A.flatMap(service)),
    queue: stats(A.flatMap(a => (a.acceptSeries ?? []).map(x => x[8] ?? 0))), cardSourceTriggers: { max: max(runs.map(laneCounts).map(l => l.cardSourceTriggers)) },
    longTasks: { editor: { n: max(A.map(a => a.longTasks?.editor?.n ?? 0)), max: max(A.map(a => a.longTasks?.editor?.max ?? 0)) } }, frameGapOver34: max(A.map(a => a.frameGap?.over34 ?? 0)) };
}

/** The runs of one journal-depth cell (same cell, same fixture): { cell, jStart, runsPlanned, runsOk, loadOk, load, S1, S3 }. */
export function cellMetrics(runs, { planned } = {}) {
  const good = runs.filter(r => r.ok && r.analysis);
  const s1 = good.filter(r => r.scn === 'S1'); const s3 = good.filter(r => r.scn === 'S3');
  const loads = key => runs.map(r => r[key]?.[0]).filter(v => v != null);
  return { cell: runs[0]?.cell ?? null, jStart: runs[0]?.journalBefore?.accepted ?? null, runsPlanned: planned ?? runs.length, runsOk: good.length,
    loadOk: runs.every(r => !r.loadGate?.gaveUp), load: { start: max(loads('loadStart')), end: max(loads('loadEnd')) },
    S1: s1.length ? typedMetrics(s1) : null, S3: s3.length ? holdMetrics(s3) : null };
}

const fitService = runs => {
  const X = []; const y = [];
  for (const r of runs) if (r.ok && r.analysis?.acceptSeries) { const j0 = r.journalBefore?.accepted ?? 0; r.analysis.acceptSeries.forEach((s, i) => { X.push([1, j0 + i]); y.push(s[0] - (s[8] ?? 0)); }); }
  const fit = X.length > 3 ? lsq(X, y) : null; // service = a + b * (journal rows when the edit started): b is ms per row (aged-agg.mjs fit 1)
  return fit ? { n: y.length, a: round(fit.beta[0], 2), b: round(fit.beta[1], 4), r2: round(fit.r2, 4) } : null;
};

/** All runs of one fixture: its cells in journal-depth order and the lane-service fit over every edit. */
export function fixtureMetrics(runs, { planned, pages = null } = {}) {
  const byCell = new Map();
  for (const r of runs) { const k = r.cell ?? null; if (!byCell.has(k)) byCell.set(k, []); byCell.get(k).push(r); }
  const cells = [...byCell].sort((a, b) => (a[0] ?? -1) - (b[0] ?? -1)).map(([, rs]) => cellMetrics(rs, { planned }));
  return { pages, cells, fit: { service: fitService(runs), serviceS1: fitService(runs.filter(r => r.scn === 'S1')) } };
}

// ---------------------------------------------------------------- scenario cells (G-T3, V2): one cell per scenario@cadence of a fixture
/** The T3 vector of the runs of one cell (design 4.3 G-T3): late class changes at class level and visible level, wrong-value dwell, overlay jumps, painted == typed == disk.
 *  null = no run of the cell has a class log. */
export function t3Metrics(runs) {
  const good = runs.filter(r => r.ok && r.analysis);
  const withT3 = good.filter(r => r.analysis.t3);
  if (!withT3.length) return null;
  const tot = r => r.analysis.t3.totals; const total = f => sum(withT3.map(r => f(tot(r))));
  const jumps = withT3.flatMap(r => Object.values(r.analysis.overlay ?? {}).map(o => o.lateSteps).filter(v => typeof v === 'number'));
  const imgs = r => Object.entries(r.analysis.perImage ?? {});
  return { runs: withT3.length, missing: good.length - withT3.length, runsLate: withT3.filter(r => tot(r).lateMutations > 0).length,
    lateMutations: total(t => t.lateMutations), lateValueChanges: total(t => t.lateValueChanges), lateWrongStates: total(t => t.lateWrongStates), lateVisible: total(t => t.lateVisible), collateral: total(t => t.collateral),
    dwellMs: { sum: round(total(t => t.dwellMs)), max: round(max(withT3.map(r => tot(r).maxDwellMs))) }, overlayJumps: jumps.length ? sum(jumps) : null, neverReached: total(t => t.neverReached),
    finalCanvasOk: good.every(r => imgs(r).every(([, p]) => p.finalOk !== false)), finalFileOk: good.every(r => imgs(r).every(([n, p]) => p.expectFinal == null || filePx(r, n) === p.expectFinal)),
    sources: [...new Set(withT3.map(r => r.analysis.t3.source))] };
}

const scnOrder = scn => [parseInt(scn.slice(1), 10) || 0, scn];
const bySce = (a, b) => scnOrder(a.scn)[0] - scnOrder(b.scn)[0] || (a.scn < b.scn ? -1 : a.scn > b.scn ? 1 : 0) || a.param - b.param;

/** All runs of one fixture of a scenario gate (G-T3, V2) grouped into cells named `<scenario>@<param>`; `planned` = { 'S1@90': 3, ... } (a planned cell with no run is still a cell). */
export function scenarioFixtureMetrics(runs, { planned = {}, pages = null } = {}) {
  const groups = new Map();
  for (const id of Object.keys(planned)) { const [scn, param] = id.split('@'); groups.set(id, { scn, param: +param, runs: [] }); }
  for (const r of runs) { const id = `${r.scn}@${r.param}`; if (!groups.has(id)) groups.set(id, { scn: r.scn, param: r.param, runs: [] }); groups.get(id).runs.push(r); }
  const cells = [...groups].map(([id, g]) => ({ id, ...g })).sort(bySce).map(g => {
    const good = g.runs.filter(r => r.ok && r.analysis); const loads = key => g.runs.map(r => r[key]?.[0]).filter(v => v != null);
    const cell = { cell: g.id, scn: g.scn, param: g.param, runsPlanned: planned[g.id] ?? g.runs.length, runsOk: good.length, loadOk: g.runs.every(r => !r.loadGate?.gaveUp), load: { start: max(loads('loadStart')), end: max(loads('loadEnd')) },
      T3: t3Metrics(g.runs) };
    const typedRuns = good.filter(r => (r.analysis.keys ?? 0) > 0 && !r.analysis.hold); const holdRuns = good.filter(r => r.analysis.hold);
    if (typedRuns.length) cell.typed = typedMetrics(typedRuns);
    if (holdRuns.length) cell.hold = holdMetrics(holdRuns);
    const undos = good.filter(r => r.analysis.undo);
    if (undos.length) cell.undo = { endIsPreEdit: undos.every(r => Object.values(r.analysis.undo.endIsPreEdit).every(v => v === true)), nonUndoValue: sum(undos.map(r => r.analysis.undo.nonUndoValue)) };
    const withRows = good.filter(r => r.analysis.rows);
    if (withRows.length) { const kinds = {}; for (const r of withRows) for (const [k, n] of Object.entries(r.analysis.rows.kinds)) kinds[k] = (kinds[k] ?? 0) + n; cell.rows = { n: sum(withRows.map(r => r.analysis.rows.n)), kinds }; }
    const th = good.map(r => r.analysis.throttle).filter(Boolean);
    if (th.length) cell.throttle = { rate: th[0].rate, bothTargets: th.every(t => t.targets?.length >= 2 && t.targets.every(x => x.ok)) };
    const v2 = good.map(r => r.analysis.v2).filter(v => v?.edits);
    if (v2.length) cell.V2 = { ...v2Verdict(v2), allRunsHaveMarks: v2.length === good.length };
    return cell;
  });
  return { pages, cells, fit: {} };
}
