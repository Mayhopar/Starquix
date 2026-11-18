// Aggregate round-2 aged-journal runs (run2.mjs CELL plans) into markdown: per-cell tables + a least-squares fit accept ~ a + b*Jmat + c*U.
//   node probe/aged-agg.mjs <dir> [<dir>…]
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeRun } from './analyze.mjs';
import { lsq } from './metrics.mjs';

const q = (a, p) => { const v = a.filter(x => x != null && !Number.isNaN(x)); if (!v.length) return null; const s = [...v].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const f1 = x => (x == null || Number.isNaN(x) ? '-' : (Math.round(x * 10) / 10).toString());
const f0 = x => (x == null || Number.isNaN(x) ? '-' : Math.round(x).toString());

const runs = [];
for (const dir of process.argv.slice(2)) {
  for (const f of (await fs.readdir(dir)).filter(f => f.endsWith('.json') && !/cells\.json$/.test(f)).sort()) {
    try { const r = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); if (!r.scn || !r.ok) continue; r.analysis = analyzeRun(r); r.file = f; runs.push(r); } catch (e) { console.error('skip', f, e.message); }
  }
}
const byLabel = new Map(); for (const r of runs) { if (!byLabel.has(r.label)) byLabel.set(r.label, []); byLabel.get(r.label).push(r); }
for (const [lab, rs] of byLabel) {
  console.log(`\n### ${lab}\n`);
  console.log('| J at start (accepted) | run | edits | accept total p50 / p95 / max | checkpoint | prepare | stage | features | identities | store | publish | lane queue p50 / p95 | key→paint p50 / p95 | id: rows-load / receipts / unmat / run | rows loaded / receipt gets | page bytes | usage MB | load | drain ms |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) {
    const a = r.analysis; const p = a.acceptPhases; const fi = a.fine; if (!p) { console.log(`| ${r.journalBefore?.accepted} | ${r.scn}@${r.param} r${r.rep} | no marks |`); continue; }
    const k = a.keyToPaintStats;
    console.log(`| ${r.journalBefore?.accepted} | ${r.scn}@${r.param} r${r.rep} | ${p.edits} | ${f1(p.total.p50)} / ${f1(p.total.p95)} / ${f1(p.total.max)} | ${f1(p.checkpoint.p50)} | ${f1(p.prepare.p50)} | ${f1(p.stage.p50)} | ${f1(p.features.p50)} | ${f1(p.identities.p50)} | ${f1(p.store.p50)} | ${f1(p.publish.p50)} | ${f1(p.queue.p50)} / ${f1(p.queue.p95)} | ${f0(k.p50)} / ${f0(k.p95)} | ${fi ? `${f1(fi.psRows?.p50)} / ${f1(fi.psMat?.p50)} / ${f1(fi.psUnmat?.p50)} / ${f1(fi.psRun?.p50)}` : '-'} | ${fi ? `${f0(fi.rowsLoaded?.p50)} / ${f0(fi.receiptGets?.p50)}` : '-'} | ${f0(fi?.fileBytes?.p50)} | ${r.drain?.usageMB ?? '-'} | ${r.loadStart?.[0]}→${r.loadEnd?.[0]} | ${r.drain?.ms} |`);
  }
  // fit on lane SERVICE time (total - queue wait; a held-key backlog inflates the queue, not the lane):
  //   (1) service = a + b*Jtot, Jtot = rows accepted when the edit started (J at run start + rows of this run before it)
  //   (2) service = a + b*J0 + c*U, J0 = rows at run start (all materialized), U = rows of this run accepted before the edit (pending, unmaterialized)
  const X1 = [], X2 = [], y = [], X1s = [], ys = [];
  for (const r of rs) {
    const a = r.analysis; const series = a.acceptSeries; if (!series?.length) continue; const j0 = r.journalBefore?.accepted ?? 0;
    series.forEach((s, i) => { const svc = s[0] - (s[8] ?? 0); X1.push([1, j0 + i]); X2.push([1, j0, i]); y.push(svc); if (r.scn === 'S1') { X1s.push([1, j0 + i]); ys.push(svc); } });
  }
  const f1fit = X1.length > 3 ? lsq(X1, y) : null; const f2fit = X2.length > 4 ? lsq(X2, y) : null; const fS1 = X1s.length > 3 ? lsq(X1s, ys) : null;
  console.log(`\nlane SERVICE fit over ${y.length} edits: (1) a + b*Jtot: ${f1fit ? `a ${f1(f1fit.beta[0])} ms, b ${f1fit.beta[1].toFixed(3)} ms/row, R2 ${f1(f1fit.r2 * 100)}%` : 'n/a'}; (2) a + b*J0 + c*U: ${f2fit ? `a ${f1(f2fit.beta[0])}, b ${f2fit.beta[1].toFixed(3)} ms/materialized row, c ${f2fit.beta[2].toFixed(3)} ms/pending row, R2 ${f1(f2fit.r2 * 100)}%` : 'n/a'}; S1 only (${ys.length} edits): ${fS1 ? `a ${f1(fS1.beta[0])}, b ${fS1.beta[1].toFixed(3)} ms/row, R2 ${f1(fS1.r2 * 100)}%` : 'n/a'}`);
  // replay (materializer) side per run: rows, first→final write span, per-row reconcile / dispatch / record p50, canvas fetch dt
  console.log('\n| J at start | run | replay writes | first write after last input (ms) | span first→last (ms) | gap p50 (ms) | reconcile p50 | dispatch p50 | record p50 | canvas fetches (n, dt p50 / max) | morphs | IPC total | late changes after final (n; at ms, px, frames) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rs) {
    const a = r.analysis; const rp = a.replay; const mt = a.materialize; const fe = a.frameFetch?.list ?? [];
    console.log(`| ${r.journalBefore?.accepted} | ${r.scn}@${r.param} r${r.rep} | ${rp?.writes} | ${f0(rp?.firstWriteAfterLastInput)} | ${f0(rp?.span)} | ${f0(rp?.gaps?.p50)} | ${f1(mt?.prepareReconcile?.p50)} | ${f1(mt?.dispatch?.p50)} | ${f1(mt?.record?.p50)} | ${fe.length}, ${f0(q(fe.map(x => x.dt), 0.5))} / ${f0(Math.max(0, ...fe.map(x => x.dt)))} | ${a.refreshes.length} | ${a.ipc.total} | ${(() => { const l = Object.values(a.perImage).flatMap(p => p.changesAfterFinal); return l.length ? `${l.length}; ${l.slice(0, 4).map(c => `${f0(c.afterOwnLastKey)} ms ${f0(c.w)} px ${c.frames}f`).join(', ')}` : '0'; })()} |`);
  }
  // per-cell medians of J-dependent parts
  console.log('\n| J | S1 accept p50 (9 edits) | S1 identities p50 | S3 accept p50 / p95 / max (61 edits) | S3 queue p95 | S3 key→paint p50 / p95 | S3 lost increments | S3 settle after last press (ms) | S3 canvas final / expected |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  const cells = [...new Set(rs.map(r => r.cell ?? r.journalBefore?.accepted))];
  for (const c of cells) {
    const cr = rs.filter(r => (r.cell ?? r.journalBefore?.accepted) === c); const s1 = cr.filter(r => r.scn === 'S1'); const s3 = cr.filter(r => r.scn === 'S3');
    const s1acc = s1.flatMap(r => (r.analysis.acceptSeries ?? []).map(x => x[0])); const s1id = s1.flatMap(r => (r.analysis.acceptSeries ?? []).map(x => x[5]));
    const s3acc = s3.flatMap(r => (r.analysis.acceptSeries ?? []).map(x => x[0])); const s3q = s3.flatMap(r => (r.analysis.acceptSeries ?? []).map(x => x[8]));
    const h = s3[0]?.analysis.hold;
    console.log(`| ${c} | ${f1(q(s1acc, 0.5))} (n ${s1acc.length}) | ${f1(q(s1id, 0.5))} | ${f1(q(s3acc, 0.5))} / ${f1(q(s3acc, 0.95))} / ${f1(Math.max(0, ...s3acc))} (n ${s3acc.length}) | ${f1(q(s3q, 0.95))} | ${h ? `${f0(h.key2paint.p50)} / ${f0(h.key2paint.p95)}` : '-'} | ${h ? `${h.lostIncrements} of ${h.presses}` : '-'} | ${h ? f0(h.settledAfterLastPress) : '-'} | ${h ? `${h.finalPainted} / ${h.finalExpected}` : '-'} |`);
  }
}
