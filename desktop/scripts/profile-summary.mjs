// Medians across profile runs: node scripts/profile-summary.mjs perf/run-*
import fs from 'node:fs';
const runs = process.argv.slice(2).map(d => JSON.parse(fs.readFileSync(`${d}/report.json`, 'utf8')).steps);
const med = xs => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const num = s => Number.parseInt(s, 10);
const CPU = ['main', 'editor', 'preview', 'gpu', 'astro']; // ps CPU ms (profile.mjs): steadier than wall ms under machine load
console.log(`runs: ${runs.length}\n| step | wall ms | boot | after running | worst input→paint ms | IPC calls | editor busy | preview busy | cpu ms ${CPU.join('/')} |\n|---|---|---|---|---|---|---|---|---|`);
const at = (s, phase) => { const p = s.phases?.find(x => x.startsWith(phase + '@')); return p ? Number(p.split('@')[1]) : NaN; };
for (const name of [...new Set(runs.flatMap(r => r.map(s => s.name)))]) {
  const xs = runs.map(r => r.find(s => s.name === name)).filter(s => s && !s.error);
  console.log(`| ${name} | ${med(xs.map(s => s.wallMs))} | ${med(xs.map(s => at(s, 'running') - at(s, 'starting')))} | ${med(xs.map(s => s.wallMs - at(s, 'running')))} | ${med(xs.map(s => num(s.inp)))} | ${med(xs.map(s => s.ipcCalls))} | ${med(xs.map(s => s.processes.editor?.busyMs))} | ${med(xs.map(s => s.processes.preview?.busyMs))} | ${CPU.map(k => med(xs.map(s => s.cpu ? s.cpu[k] ?? 0 : NaN))).join('/')} |`);
}
