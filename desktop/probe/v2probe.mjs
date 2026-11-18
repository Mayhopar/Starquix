// V2 writer probe: which mechanism makes a component-ROOT (V2) class edit show an OLDER class (design 3.1; R12 3.3: on the 34 KB page the third SYNC of a typed
// `300` carried the first keystroke's class in 2 of 4 runs). Input = the editor's probe marks of a run (app/src/utils/probeMark.ts), in log order:
//   cls:set {key, cls, op}          the class a setClasses call asked for; `op` = the operation tail its transaction origin ends with
//   v2:write {origin, local, w}     every class write the observer saw on the LIVE doc (sourceClasses): { key, act, old, now } per entry
//   v2:csv {b} + v2:sync {key, op, v, e, s, sv, ov}   the value SYNC_CLASSES_TO_IFRAME posted, the branch of currentSourceClassValue that produced it
//                                   (carrier | scan-stale-owner | entry | scan-fallback), the entry's class `e`, the scan class `s`, scan/owner versions
//   v2:seed {key, now, master}      a scan seeding a file-backed override into the entry (seedFileOverride)
//   v2:reg {b, key, old?, now}      registerElement: a new entry, or an external overwrite of an existing one
//   cls:accepted {key, typed, doc}  the class the live doc holds when the acceptance resolves
// A SYMPTOM is an edit whose SYNC or whose live-doc class at apply time differs from the class just typed. Mechanism 1 (stale-scan): the doc is right, the
// SYNC carries the latest scan's class through branch scan-stale-owner. Mechanism 2 (client-id-overwrite): the live doc itself ends on an older class because a
// write by another writer (scan seed, registerElement) raced the staged update and won by client id; the writer is named from the marks before the write.
//   node probe/v2probe.mjs <dir of run JSONs>      prints the verdict and the log excerpt (the report docs/plans/2026-11-17-instant-edit-gates/V2-writer-probe.md quotes)
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const clip = s => (typeof s === 'string' ? s.slice(-40) : s); // cls:set clips to 40 chars, the other marks to 60: compare the shared tail
const same = (a, b) => clip(a) === clip(b);
const shortKey = key => String(key).slice(-14);
const count = (map, k) => { map[k] = (map[k] ?? 0) + 1; };

/** One run of marks (oldest first, node clock) -> its edits, flattened live-doc writes and symptoms. `rel` maps a mark time to the run's time base. */
export function v2Run(marks, rel = t => t) {
  const writes = []; const syncs = []; const accepted = []; const sets = [];
  let seeds = []; let regs = [];
  marks.forEach((m, i) => {
    if (m.what === 'v2:seed') seeds.push(m);
    else if (m.what === 'v2:reg') regs.push(m);
    else if (m.what === 'v2:write') {
      for (const w of m.w ?? []) {
        const durable = String(m.origin).startsWith('durable-edit:');
        const tag = durable ? 'durable' : seeds.some(s => s.key === shortKey(w.key)) ? 'scan-seed' : regs.some(r => r.key === shortKey(w.key)) ? `register:${regs.find(r => r.key === shortKey(w.key)).b}` : `other:${m.origin}`;
        writes.push({ at: rel(m.t), origin: String(m.origin), local: m.local, key: w.key, act: w.act, old: w.old, now: w.now, tag });
      }
      seeds = []; regs = [];
    } else if (m.what === 'v2:sync') syncs.push({ at: rel(m.t), op: m.op, key: m.key, v: m.v, e: m.e, s: m.s, sv: m.sv, ov: m.ov, branch: marks[i - 1]?.what === 'v2:csv' ? marks[i - 1].b : null });
    else if (m.what === 'cls:accepted') accepted.push({ at: rel(m.t), key: m.key, typed: m.typed, doc: m.doc });
    else if (m.what === 'cls:set') sets.push({ op: m.op, key: m.key, typed: m.cls, setAt: rel(m.t) });
  });
  const mechanisms = {}; let foreignTotal = 0;
  const edits = sets.map(set => {
    const hit = writes.find(w => w.tag === 'durable' && w.origin.endsWith(set.op) && shortKey(w.key) === set.key);
    const applied = hit ? { at: hit.at, act: hit.act, old: hit.old, now: hit.now } : null;
    const own = syncs.filter(s => s.op === set.op && s.key === set.key);
    const acc = accepted.find(a => a.key === set.key && same(a.typed, set.typed) && a.at >= set.setAt) ?? null;
    const foreign = writes.filter(w => w.tag !== 'durable' && shortKey(w.key) === set.key && w.at >= set.setAt && (!applied || w.at <= applied.at)).map(w => ({ at: w.at, tag: w.tag, origin: w.origin, old: w.old, now: w.now }));
    const docOverwritten = applied ? !same(applied.now, set.typed) : acc ? !same(acc.doc, set.typed) : false;
    const stale = own.find(s => !same(s.v, set.typed));
    const symptom = docOverwritten || !!stale;
    const mechanism = !symptom ? null : docOverwritten ? 'client-id-overwrite' : stale.branch === 'scan-stale-owner' ? 'stale-scan' : `unclassified:${stale.branch}`;
    if (mechanism) count(mechanisms, mechanism);
    foreignTotal += foreign.length;
    return { ...set, applied, syncs: own, accepted: acc, foreign, docOverwritten, syncStale: !!stale, symptom, mechanism, ...(mechanism === 'client-id-overwrite' ? { writer: foreign[0]?.tag ?? 'unattributed' } : {}) };
  });
  return { edits, writes, symptoms: edits.filter(e => e.symptom).length, mechanisms, foreign: foreignTotal };
}

/** The verdict over the v2Run results of every run of the probe. */
export function v2Verdict(results) {
  const withMarks = results.filter(r => r.edits.length);
  const mechanisms = {}; const writers = {};
  for (const r of withMarks) {
    for (const [k, n] of Object.entries(r.mechanisms)) mechanisms[k] = (mechanisms[k] ?? 0) + n;
    for (const e of r.edits) if (e.writer) count(writers, e.writer);
  }
  const edits = withMarks.reduce((t, r) => t + r.edits.length, 0); const symptoms = withMarks.reduce((t, r) => t + r.symptoms, 0);
  const foreign = withMarks.reduce((t, r) => t + r.foreign, 0);
  const stale = (mechanisms['stale-scan'] ?? 0) > 0; const over = (mechanisms['client-id-overwrite'] ?? 0) > 0; const other = Object.keys(mechanisms).some(k => k.startsWith('unclassified:'));
  const mechanism = !withMarks.length ? 'no-data' : !symptoms ? 'not-reproduced' : stale && over ? 'both' : stale ? 'stale-scan' : over ? 'client-id-overwrite' : other ? 'unclassified' : 'not-reproduced';
  const writerText = Object.entries(writers).map(([w, n]) => `${w} (${n})`).join(', ');
  const verdict = {
    'no-data': 'no data: the runs carried no cls:set marks (was the probe build of the editor running?)',
    'not-reproduced': `not reproduced: ${withMarks.length} runs, ${edits} edits, 0 symptoms (no SYNC and no live-doc class differed from the class just typed); ${foreign} foreign live-doc class writes fell inside lane windows. Neither mechanism is confirmed or ruled out.`,
    'stale-scan': `stale-scan (design 3.1 mechanism 1): ${mechanisms['stale-scan']} of ${edits} edits posted an older class through currentSourceClassValue branch scan-stale-owner while the live doc held the typed class`,
    'client-id-overwrite': `client-id overwrite (design 3.1 mechanism 2): ${mechanisms['client-id-overwrite']} of ${edits} edits found the live doc on an older class right after the apply; writer: ${writerText}`,
    both: `both mechanisms seen: stale-scan ${mechanisms['stale-scan']}, client-id overwrite ${mechanisms['client-id-overwrite']} (writers: ${writerText})`,
    unclassified: `symptoms without a known mechanism: ${JSON.stringify(mechanisms)}`,
  }[mechanism];
  return { runs: results.length, runsWithMarks: withMarks.length, edits, symptoms, runsWithSymptom: withMarks.filter(r => r.symptoms).length, mechanisms, writers, foreign, mechanism, verdict };
}

const line = (first, m) => { const { t, what, ...rest } = m; return `+${(t - first).toFixed(1).padStart(8)} ms  ${what.padEnd(12)} ${JSON.stringify(rest)}`; };

/** Markdown: the verdict, one table row per edit, and the marks around the first symptom (or the first edits of the first run). */
export function v2Report(runs) {
  const verdict = v2Verdict(runs.map(r => r.result));
  const out = [`**Verdict: ${verdict.mechanism}.** ${verdict.verdict}`, '', `${verdict.runs} runs, ${verdict.edits} edits, ${verdict.symptoms} with a symptom in ${verdict.runsWithSymptom} runs; mechanisms ${JSON.stringify(verdict.mechanisms)}.`, '',
    '| run | edit | typed | live doc after the apply | SYNC posted | branch | symptom |', '|---|---|---|---|---|---|---|'];
  for (const r of runs) r.result.edits.forEach((e, i) => out.push(`| ${r.name} | ${i + 1} | \`${e.typed}\` | ${e.applied ? `\`${e.applied.now}\` (${e.applied.act})` : '-'} | ${e.syncs.map(s => `\`${s.v}\``).join(', ') || '-'} | ${e.syncs.map(s => s.branch ?? '-').join(', ') || '-'} | ${e.mechanism ?? ''} |`));
  const hit = runs.find(r => r.result.symptoms) ?? runs[0];
  if (hit) {
    const bad = hit.result.edits.find(e => e.symptom) ?? hit.result.edits[0];
    const marks = hit.marks.filter(m => /^(cls:|v2:|acc:enter|acc:published|msg:)/.test(m.what));
    const from = bad ? Math.max(0, marks.findIndex(m => m.what === 'cls:set' && m.op === bad.op) - 1) : 0;
    const slice = marks.slice(from, from + 40);
    out.push('', `Excerpt of ${hit.name}${bad?.symptom ? ` around the symptom (edit with op ${bad.op})` : ''}:`, '', '```', ...slice.map(m => line(slice[0].t, m)), '```');
  }
  return out.join('\n');
}

/** The editor's marks of one raw run (run2.mjs JSON) on the runner's clock, plus the scans the canvas reported (`msg:ELEMENTS_SCANNED`: where a scan landed against a lane window is the
 *  evidence for both mechanisms), in time order. The sort is stable: marks of one task (v2:csv, then the v2:sync it explains) keep their log order. */
export const marksOfRun = run => {
  const off = run.calib?.editor?.offset ?? 0; const editor = (run.docs ?? []).filter(d => d.role === 'editor');
  const marks = editor.flatMap(d => d.data.ev ?? []).filter(e => e.what).map(e => ({ ...e, t: e.t + off }));
  const scans = editor.flatMap(d => d.data.msg ?? []).filter(m => m.type === 'ELEMENTS_SCANNED' && !m.self).map(m => ({ t: m.t + off, what: 'msg:ELEMENTS_SCANNED', n: m.n }));
  return [...marks, ...scans].sort((a, b) => a.t - b.t);
};

/** The report of raw runs: [[name, run], ...]; times are ms since the run's first cls:set mark. */
export function v2ReportOfRuns(named) {
  return v2Report(named.map(([name, run]) => {
    const marks = marksOfRun(run); const t0 = marks.find(m => m.what === 'cls:set')?.t ?? 0;
    return { name, marks, result: v2Run(marks, t => Math.round((t - t0) * 10) / 10) };
  }));
}

// ---- CLI: node probe/v2probe.mjs <dir of run JSONs> ----
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { // a path with a space is %20 in import.meta.url
  const dir = process.argv[2];
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json') && !/-(cells|isolation)\.json$/.test(f)).sort();
  const named = [];
  for (const f of files) { const run = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); if (run.docs) named.push([f.replace(/\.json$/, ''), run]); }
  console.log(v2ReportOfRuns(named));
}
