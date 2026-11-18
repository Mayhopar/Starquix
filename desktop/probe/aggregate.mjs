// Aggregate run JSONs (re-analysing the raw timelines) into markdown tables.   node probe/aggregate.mjs <dir> [<dir>…]
import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeRun } from './analyze.mjs';

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const r0 = x => (x == null || Number.isNaN(x) ? '-' : Math.round(x));
const med = a => r0(q(a.filter(x => x != null), 0.5));
const mx = a => { const v = a.filter(x => x != null); return v.length ? r0(Math.max(...v)) : '-'; };

const runs = [];
for (const dir of process.argv.slice(2)) {
  for (const f of (await fs.readdir(dir)).filter(f => f.endsWith('.json')).sort()) {
    try { const r = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); if (!r.scn || !r.ok) continue; r.analysis = analyzeRun(r); r.file = f; runs.push(r); } catch (e) { console.error('skip', f, e.message); }
  }
}
const groups = new Map();
for (const r of runs) { const k = `${r.label} ${r.scn}@${r.param}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }

const out = [];
out.push('| run group | n | key→paint ms p50 / p95 / max (pooled) | breakdown p50: accept + hop + paint | intermediate painted (≥2 frames) | late changes after final (runs hit/total) | disk first / final write after last input (ms) | replay gap p50/max (ms) | IPC calls (per input) | long tasks ed/frame (max ms) | frame gaps >34 ms | load avg |');
out.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const [k, g] of groups) {
  const A = g.map(r => r.analysis);
  const lat = A.flatMap(a => a.keyToPaint.filter(x => x.painted != null).map(x => x.painted));
  const inter = A.reduce((s, a) => s + a.intermediate.n, 0); const interPainted = A.reduce((s, a) => s + a.intermediate.painted, 0); const inter2 = A.reduce((s, a) => s + a.intermediate.visible2fr, 0);
  const late = g.filter((r, i) => Object.values(A[i].perImage).some(p => p.changesAfterFinal.length) || (A[i].switch?.img1ChangesAfterClick?.length)).length;
  const bd = ['accept', 'hop', 'paintAfterApply'].map(f => med(A.map(a => a.breakdownStats[f].p50)));
  const dw = A.flatMap(a => a.keyToPaint.filter(x => !x.last && x.dwell != null).map(x => x.dwell));
  const loads = g.map(r => r.loadStart?.[0]).filter(Boolean);
  const ipcPer = A.map(a => (a.replay?.inputs ? a.ipc.total / a.replay.inputs : null));
  out.push(`| ${k} | ${g.length} | ${r0(q(lat, 0.5))} / ${r0(q(lat, 0.95))} / ${r0(Math.max(0, ...lat))} | ${bd[0]} + ${bd[1]} + ${bd[2]} | ${interPainted}/${inter} (${inter2}; dwell p50 ${r0(q(dw, 0.5))} ms) | ${late}/${g.length} | ${med(A.map(a => a.replay?.firstWriteAfterLastInput))} / ${med(A.map(a => a.replay?.finalWriteAfterLastInput))} | ${med(A.map(a => a.replay?.gaps?.p50))} / ${mx(A.map(a => a.replay?.gaps?.max))} | ${med(A.map(a => a.ipc.total))} (${r0(q(ipcPer.filter(x => x != null), 0.5))}) | ${mx(A.map(a => a.longTasks.editor.n))}/${mx(A.map(a => a.longTasks.frame.n))} (${mx(A.map(a => Math.max(a.longTasks.editor.max, a.longTasks.frame.max)))}) | ${mx(A.map(a => a.frameGap.over34))} | ${loads.length ? `${r0(Math.min(...loads))}–${r0(Math.max(...loads))}` : '-'} |`);
}
console.log(out.join('\n'));
console.log('\nper-run late changes:');
for (const r of runs) {
  const a = r.analysis;
  const lates = Object.entries(a.perImage).filter(([, p]) => p.changesAfterFinal.length).map(([n, p]) => `img${n}: ${JSON.stringify(p.changesAfterFinal.slice(0, 4).map(c => [c.afterOwnLastKey, c.w, c.frames]))}`);
  const sw = a.switch?.img1ChangesAfterClick?.length ? `after-click ${JSON.stringify(a.switch.img1ChangesAfterClick.slice(0, 4).map(c => [c.afterClick, c.w, c.frames]))}` : '';
  if (lates.length || sw) console.log(`- ${r.file}: ${lates.join(' ')} ${sw}`);
}

console.log('\nCPU ms during the capture window (median over runs; ps, 10 ms resolution): editor / preview-or-gpu / astro / main');
for (const [k, g] of groups) {
  const c = lab => med(g.map(r => r.cpu?.[lab]));
  console.log(`- ${k}: editor ${c('editor')} · gpu ${c('gpu')} · astro ${c('astro')} · main ${c('main')} · window ${med(g.map(r => (r.analysis.captureStopAt - r.analysis.captureStartAt)))} ms`);
}
