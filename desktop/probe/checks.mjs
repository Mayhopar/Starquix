// gates.json + the metric vector (metrics.mjs) -> one row per check, a verdict and an exit code. Pure: no IO.
//   status: pass | fail | nodata (no value: counts as a miss) | report (no threshold: reported only) | skip (fixture unavailable) | load (a time check on a machine
//   that never settled to the load gate) | todo (a part of the gate that is not built yet). Verdict: fail (exit 1) if any fail/nodata, else incomplete (exit 4) if
//   any skip/load, else pass (exit 0). A gate that omits a fixture or runs on a busy machine never reads as green.
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const perFixture = (v, fixture) => (v !== null && typeof v === 'object' ? v[fixture] : v); // a number applies to every fixture, a map to the named ones
const absent = v => v == null || (typeof v === 'number' && Number.isNaN(v));
const OPS = { '<=': (v, t) => v <= t, '>=': (v, t) => v >= t, '==': (v, t) => v === t };

function judge(check, fixture, cell, value, loadOk) {
  const within = check.op === 'within';
  const target = within ? perFixture(check.ref, fixture) : perFixture(check.threshold, fixture);
  const row = { check: check.id, label: check.label, fixture, cell, value: value ?? null, op: check.op, threshold: target ?? null, tol: within ? check.tol : undefined,
    baseline: perFixture(check.baseline, fixture) ?? null, kind: check.kind, ...(check.target != null ? { target: check.target } : {}) }; // target = what the check will gate once its slice lands (report-only until then)
  if (target == null) return { ...row, status: 'report' };
  if (absent(value)) return { ...row, status: 'nodata' };
  if (check.kind === 'time' && !loadOk) return { ...row, status: 'load' };
  const ok = within ? Math.abs(value - target) <= check.tol * Math.abs(target) : OPS[check.op](value, target);
  return { ...row, status: ok ? 'pass' : 'fail' };
}

const pickCells = (cells, which = 'all') => {
  if (which === 'all' || !cells.length) return cells;
  const depth = c => c.cell ?? -1; const pick = (which === 'deepest' ? Math.max : Math.min)(...cells.map(depth));
  return cells.filter(c => depth(c) === pick);
};

export function evaluateGate(gate, vector) {
  const rows = [];
  const push = r => rows.push({ gate: gate.name, ...r });
  for (const fixture of gate.fixtures) {
    const fx = vector.fixtures?.[fixture];
    if (fx?.skipped) { push({ check: '*', fixture, cell: null, status: 'skip', note: fx.skipped }); continue; }
    if (!fx) { push({ check: '*', fixture, cell: null, status: 'nodata', note: 'no data for this fixture' }); continue; }
    const cells = fx.cells ?? [];
    // every gate: all planned runs of every cell completed
    if (!cells.length) push({ check: 'runs-ok', label: 'planned runs completed', fixture, cell: null, status: 'nodata', value: 0, op: '==', threshold: null });
    for (const c of cells) push({ check: 'runs-ok', label: 'planned runs completed', fixture, cell: c.cell, value: c.runsOk, op: '==', threshold: c.runsPlanned, status: c.runsOk === c.runsPlanned ? 'pass' : 'fail' });
    for (const check of gate.checks) {
      if (check.level === 'fixture') push(judge(check, fixture, null, get(fx, check.metric), cells.every(c => c.loadOk)));
      else for (const c of pickCells(cells, check.cells).filter(c => !check.scn || check.scn.includes(c.scn))) push(judge(check, fixture, c.cell, get(c, check.metric), c.loadOk)); // `scn`: only the cells of these scenarios
    }
  }
  if (vector.isolation) push({ check: 'isolation', label: 'no run reached the owner\'s relay (:47821) or dev editor (:3061)', fixture: '*', cell: null, value: vector.isolation.leaks, op: '==', threshold: 0, status: vector.isolation.leaks === 0 ? 'pass' : 'fail' });
  for (const part of gate.pending ?? []) push({ check: part.id, label: part.note, fixture: '*', cell: null, status: 'todo' });
  const miss = rows.some(r => r.status === 'fail' || r.status === 'nodata'); const incomplete = rows.some(r => r.status === 'skip' || r.status === 'load');
  return { rows, verdict: miss ? 'fail' : incomplete ? 'incomplete' : 'pass', exitCode: miss ? 1 : incomplete ? 4 : 0 };
}

const LABEL = { pass: 'PASS', fail: 'FAIL', nodata: 'NODATA', report: 'info', skip: 'SKIP', load: 'LOAD', todo: 'TODO' };
const fmt = v => (v == null ? '-' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v));

/** A fixed-width table, one line per row. */
export function renderTable(rows) {
  const rule = r => (r.op === 'within' ? (r.threshold == null ? '' : `~ ${fmt(r.threshold)} +-${Math.round(r.tol * 100)}%`) : r.threshold == null ? (r.target == null ? '' : `target ${r.op} ${fmt(r.target)}`) : `${r.op} ${fmt(r.threshold)}`);
  const note = r => r.note ?? (r.status === 'todo' ? r.label : null); // skip / todo rows carry a sentence instead of a value
  // a numeric cell is a journal depth (J100), a string cell a scenario cell (S1@90)
  const body = rows.map(r => [LABEL[r.status], r.check, r.fixture, r.cell == null ? '' : typeof r.cell === 'number' ? `J${r.cell}` : r.cell, note(r) ? '' : fmt(r.value), note(r) ? '' : rule(r), note(r) ?? (r.baseline == null ? '' : `baseline ${fmt(r.baseline)}`)]);
  const table = [['status', 'check', 'fixture', 'cell', 'value', 'rule', 'baseline / note'], ...body];
  const widths = table[0].map((_, i) => Math.max(...table.map(r => String(r[i]).length)));
  return table.map(r => r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd()).join('\n');
}
