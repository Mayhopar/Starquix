// Run analysis: raw timelines (editor + frame + node + disk + ipc) → the metrics the report needs.
//   import { analyzeRun, summaryLine } from './analyze.mjs'      |      node probe/analyze.mjs <dir of run JSONs>   (one line per run)
// Every `at` in the output is ms since the FIRST keystroke dispatch (T0) unless the field name says otherwise (…AfterLastKey, …AfterClick).
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canon, classTimelines } from './t3.mjs';
import { v2Run } from './v2probe.mjs';

const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const r1 = x => (x == null || Number.isNaN(x) ? null : Math.round(x * 10) / 10);
const sum = a => a.reduce((x, y) => x + y, 0);
/** "w-[300px]" / "w-75" / "w-full" → px number or the token. */
export const wOf = cls => { const m = /(?:^|\s)w-(\[(\d+(?:\.\d+)?)px\]|(\d+(?:\.\d+)?)|full|fit|\S+)(?=\s|$)/.exec(cls ?? ''); if (!m) return null; if (m[2]) return +m[2]; if (m[3]) return +m[3] * 4; return m[1]; };
const SPAM = /^(CONTENT_HEIGHT|RECTS_UPDATED|RECT_UPDATED|ELEMENT_RECT_RESPONSE|AI_ACTIVE_RECTS)$/;

export function analyzeRun(run) {
  const eOff = run.calib.editor.offset; const fOff = run.calib.frame.offset;
  const log = run.nodeLog; const at = what => log.filter(l => l.what === what);
  const tStart = at('capture-start')[0].t; const tStop = at('capture-stop')[0].t;
  const edDocs = run.docs.filter(d => d.role === 'editor');
  const frDocs = run.docs.filter(d => d.role === 'frame' && d.data.frames?.length);
  const frDoc = [...frDocs].sort((a, b) => b.data.frames.length - a.data.frames.length)[0];
  const edAll = k => edDocs.flatMap(d => d.data[k] ?? []); const frAll = k => frDocs.flatMap(d => d.data[k] ?? []);
  const A = { frameDocs: frDocs.map(d => ({ docId: d.docId, frames: d.data.frames.length })), editorDocs: edDocs.length };
  const N = run.nImages;
  // ---- typed keys (node dispatch time) ----
  const typed = at('typed').filter(t => t.t >= tStart); const preTyped = at('typed').filter(t => t.t < tStart);
  const keys = typed.flatMap(t => t.keys.map(k => ({ n: t.n, ...k })));
  const hold = at('hold')[0];
  const clicks0 = at('click').filter(c => c.t >= tStart);
  const T0 = keys[0]?.t0 ?? hold?.ts?.[0] ?? clicks0[0]?.t0 ?? tStart; const tLastKey = keys.at(-1)?.t1 ?? hold?.ts?.at(-1) ?? clicks0.at(-1)?.t1 ?? tStart;
  const rel = t => r1(t - T0);
  A.keys = keys.length; A.captureStartAt = rel(tStart); A.lastKeyAt = rel(tLastKey); A.captureStopAt = rel(tStop);
  // ---- canvas frames → per-image compressed width sequences (node clock) ----
  const rows = (frDoc?.data.frames ?? []).map(r => ({ t: r[1] + fOff, w: Array.from({ length: N }, (_, i) => r[2 + i * 2]), h: Array.from({ length: N }, (_, i) => r[3 + i * 2]), sp: r.slice(2 + 2 * N) }));
  A.canvasFrames = rows.length;
  const dts = rows.slice(1).map((r, i) => r.t - rows[i].t);
  A.frameGap = { p50: r1(q(dts, 0.5)), p95: r1(q(dts, 0.95)), max: r1(Math.max(0, ...dts)), over34: dts.filter(x => x > 34).length, over100: dts.filter(x => x > 100).length };
  const seq = {};
  for (let i = 0; i < N; i++) {
    const ch = []; let prev = null;
    for (const r of rows) { const w = r.w[i]; if (prev === null || Math.abs(w - prev.w) > 0.05) { prev = { t: r.t, w, frames: 1, h: r.h[i] }; ch.push(prev); } else prev.frames++; }
    ch.forEach((c, j) => { c.dwell = ch[j + 1] ? ch[j + 1].t - c.t : (rows.at(-1)?.t ?? c.t) - c.t; });
    seq[i + 1] = ch;
  }
  const typedImgs = [...new Set(keys.map(k => k.n))];
  A.seq = Object.fromEntries(Object.entries(seq).filter(([n, v]) => v.length > 1 && (typedImgs.includes(+n) || v.length < 12)).map(([n, v]) => [n, v.slice(0, 80).map(c => ({ at: rel(c.t), w: r1(c.w), frames: c.frames, dwell: r1(c.dwell) }))]));
  A.collateral = Object.fromEntries(Object.entries(seq).filter(([n, v]) => v.length > 1 && !typedImgs.includes(+n)).map(([n, v]) => [n, v.length - 1]));
  // ---- key → canvas paint (first frame showing the expected width) ----
  A.keyToPaint = keys.map((k, i) => {
    const list = seq[k.n] ?? []; const nextKeyOfSameImg = keys.slice(i + 1).find(x => x.n === k.n);
    const hit = list.find(c => c.t >= k.t0 - 2 && Math.abs(c.w - k.expect) <= 0.6);
    return { n: k.n, expect: k.expect, painted: hit ? r1(hit.t - k.t0) : null, frames: hit ? hit.frames : 0, dwell: hit ? r1(hit.dwell) : null, last: !nextKeyOfSameImg };
  });
  const lat = A.keyToPaint.filter(x => x.painted != null).map(x => x.painted);
  A.keyToPaintStats = { painted: lat.length, of: keys.length, p50: r1(q(lat, 0.5)), p95: r1(q(lat, 0.95)), max: r1(Math.max(0, ...lat)) };
  const inter = A.keyToPaint.filter(x => !x.last);
  A.intermediate = { n: inter.length, painted: inter.filter(x => x.painted != null).length, visible2fr: inter.filter(x => x.painted != null && x.frames >= 2).length };
  // ---- per typed image: final value, settle time, later changes ----
  A.perImage = {};
  const finalMark = at('burst-end')[0]?.final ?? {};
  for (const n of typedImgs) {
    const ks = keys.filter(k => k.n === n); const lastK = ks.at(-1); const list = seq[n] ?? [];
    const firstReach = list.find(c => c.t >= lastK.t0 - 2 && Math.abs(c.w - lastK.expect) <= 0.6);
    const later = firstReach ? list.slice(list.indexOf(firstReach) + 1) : [];
    const expectFinal = Object.prototype.hasOwnProperty.call(finalMark, n) ? finalMark[n] : lastK.expect; // a null final (S7, S7b) = the end state is not the typed number
    A.perImage[n] = { expectFinal, finalAtEnd: r1(rows.at(-1)?.w[n - 1]), finalOk: expectFinal == null ? null : Math.abs((rows.at(-1)?.w[n - 1] ?? -1) - expectFinal) <= 0.6,
      reachedFinalAfterLastKey: firstReach ? r1(firstReach.t - lastK.t0) : null, ownLastKeyAt: rel(lastK.t1),
      changesAfterFinal: later.map(c => ({ afterOwnLastKey: r1(c.t - lastK.t1), w: r1(c.w), frames: c.frames })),
      settledAfterOwnLastKey: list.length ? r1(list.at(-1).t - lastK.t1) : null, settledAfterGlobalLastKey: list.length ? r1(list.at(-1).t - tLastKey) : null };
  }
  // ---- S3: key repeat on ArrowUp: press i should show base+i+1 ----
  if (hold) {
    const base = +preTyped.at(-1)?.text; const list = seq[1] ?? []; const presses = hold.ts.length;
    const per = hold.ts.map((t, i) => { const exp = base + i + 1; const hit = list.find(c => c.t >= t - 2 && Math.abs(c.w - exp) <= 0.6); return { i, expect: exp, painted: hit ? r1(hit.t - t) : null }; });
    const lat2 = per.filter(x => x.painted != null).map(x => x.painted);
    const finalPainted = rows.at(-1)?.w[0]; const distinct = list.filter(c => c.t >= hold.ts[0] - 2).length;
    const lastPress = hold.ts.at(-1); const lastChange = list.at(-1);
    A.hold = { presses, interval: hold.interval, base, finalExpected: base + presses, finalPainted: r1(finalPainted), lostIncrements: base + presses - finalPainted, distinctWidthsPainted: distinct,
      pressesPainted: lat2.length, key2paint: { p50: r1(q(lat2, 0.5)), p95: r1(q(lat2, 0.95)), max: r1(Math.max(0, ...lat2)) },
      settledAfterLastPress: r1(lastChange.t - lastPress), firstPressAt: rel(hold.ts[0]), lastPressAt: rel(lastPress),
      framesWithGapOver34: dts.filter(x => x > 34).length,
      widthsAfterLastPress: list.filter(c => c.t > lastPress).map(c => ({ afterLastPress: r1(c.t - lastPress), w: r1(c.w), frames: c.frames })).slice(0, 40) };
    A.keyToPaint = per.map(x => ({ n: 1, expect: x.expect, painted: x.painted, frames: 0, dwell: null, last: x.i === presses - 1 }));
    const l3 = A.keyToPaint.filter(x => x.painted != null).map(x => x.painted);
    A.keyToPaintStats = { painted: l3.length, of: presses, p50: r1(q(l3, 0.5)), p95: r1(q(l3, 0.95)), max: r1(Math.max(0, ...l3)) };
  }
  // ---- S5/S6: image-fill Fit clicks → canvas computed style (+ the control's busy/disabled window). Clicks toggle the value, so the k-th canvas
  // transition is the k-th click's paint (order pairing: robust when clicks outrun the canvas).
  const clicks = at('click').filter(c => c.t >= tStart);
  if (clicks.length) {
    const probe = run.cfg?.styleProbes?.[0]; const T = clicks[0].t0;
    const trans = []; { let prev = rows[0]?.sp?.[0]; for (const r of rows) { const v = r.sp?.[0]; if (v !== prev) { trans.push({ t: r.t, v }); prev = v; } } }
    const per = clicks.map((c, i) => { const tr = trans[i]; return { i, label: c.label, expect: c.expect, painted: tr && tr.v === c.expect ? r1(tr.t - c.t0) : null, got: tr?.v ?? null }; });
    const lat2 = per.filter(x => x.painted != null).map(x => x.painted);
    const watch = edDocs.flatMap(d => d.data.frames ?? []).map(r => ({ t: r[1] + eOff, dis: r[3] }));
    const busy = []; let cur = null; for (const w of watch) { if (w.dis === 'true' && !cur) cur = { start: w.t }; if (w.dis !== 'true' && cur) { busy.push({ at: r1(cur.start - T), dur: r1(w.t - cur.start) }); cur = null; } }
    A.s5 = { probe, clicks: per, painted: lat2.length, of: per.length, transitions: trans.length, lost: Math.max(0, per.length - trans.length), key2paint: { p50: r1(q(lat2, 0.5)), p95: r1(q(lat2, 0.95)), max: r1(Math.max(0, ...lat2)) }, busyWindows: busy.slice(0, 20), canvasSeq: trans.slice(0, 40).map(x => ({ at: r1(x.t - T), v: x.v })), finalCanvas: rows.at(-1)?.sp?.[0], lastClickAt: rel(clicks.at(-1).t1), clickGaps: clicks.slice(1).map((c, i) => r1(c.t0 - clicks[i].t0)) };
    if (!keys.length) {
      A.keyToPaint = per.map(x => ({ n: 'fx', expect: x.expect, painted: x.painted, frames: 0, dwell: null, last: x.i === per.length - 1 }));
      const l4 = per.filter(x => x.painted != null).map(x => x.painted);
      A.keyToPaintStats = { painted: l4.length, of: per.length, p50: r1(q(l4, 0.5)), p95: r1(q(l4, 0.95)), max: r1(Math.max(0, ...l4)) };
    }
  }
  // ---- S2: does image 1 move again after the owner moved on? ----
  const i1 = run.img1 ?? 1, i2 = run.img2 ?? 2;
  const sw = at('select').find(s => s.n === i2 && s.clickAt);
  if (sw && typedImgs.includes(i1) && /^S[26]O?$/.test(run.scn)) {
    const lastK1 = keys.filter(k => k.n === i1).at(-1); const list = seq[i1] ?? [];
    A.switch = { clickAfterLastKey1: r1(sw.clickAt - lastK1.t1), clickAt: rel(sw.clickAt), ok: sw.ok, selectMs: sw.ms, img1WidthAtClick: r1((rows.filter(r => r.t <= sw.clickAt).at(-1) ?? rows[0]).w[i1 - 1]),
      img1ChangesAfterClick: list.filter(c => c.t > sw.clickAt).map(c => ({ afterClick: r1(c.t - sw.clickAt), afterLastKey1: r1(c.t - lastK1.t1), w: r1(c.w), frames: c.frames })) };
  }
  // ---- disk ----
  const disk = run.disk ?? [];
  A.disk = disk.map(v => ({ at: rel(v.mtime), seenAt: rel(v.t), w: Object.fromEntries(Object.entries(v.imgs).filter(([n]) => typedImgs.includes(+n)).map(([n, c]) => [n, wOf(c)])) }));
  A.diskVersions = disk.length; A.diskFirstWriteAt = disk.length > 1 ? rel(disk[1].mtime) : null; A.diskFinalAt = disk.length > 1 ? rel(disk.at(-1).mtime) : null;
  A.diskFinalAfterLastKey = disk.length > 1 ? r1(disk.at(-1).mtime - tLastKey) : null;
  if (disk.length) { const last = disk.at(-1); A.diskFinalOk = Object.fromEntries(typedImgs.map(n => [n, A.perImage[n].expectFinal == null ? null : wOf(last.imgs[n]) === A.perImage[n].expectFinal])); }
  // ---- per-key pipeline breakdown: key → editor accept (SYNC out) → iframe apply (class mutation) → painted frame ----
  {
    const syncs = edAll('msg').filter(m => m.self && m.type === 'SYNC_CLASSES_TO_IFRAME').map(m => ({ t: m.t + eOff, v: wOf(m.cls) }));
    const applies = frAll('cls').filter(c => c.attr === 'class').map(c => ({ t: c.t + fOff, n: c.n, v: wOf(c.val) }));
    const bk = keys.map(k => {
      const sy = syncs.find(x => x.t >= k.t0 - 1 && x.v === k.expect); const ap = applies.find(x => x.t >= k.t0 - 1 && x.n === k.n && x.v === k.expect);
      const hit = (seq[k.n] ?? []).find(c => c.t >= k.t0 - 2 && Math.abs(c.w - k.expect) <= 0.6);
      return { n: k.n, expect: k.expect, accept: sy ? r1(sy.t - k.t0) : null, hop: sy && ap ? r1(ap.t - sy.t) : null, paintAfterApply: ap && hit ? r1(hit.t - ap.t) : null, total: hit ? r1(hit.t - k.t0) : null };
    });
    const st = f => { const v = bk.map(f).filter(x => x != null); return { n: v.length, p50: r1(q(v, 0.5)), p95: r1(q(v, 0.95)), max: r1(Math.max(0, ...v)) }; };
    A.breakdown = bk.length <= 40 ? bk : undefined;
    A.breakdownStats = { accept: st(x => x.accept), hop: st(x => x.hop), paintAfterApply: st(x => x.paintAfterApply), total: st(x => x.total) };
  }
  // ---- the deferred write: every intermediate value replayed IN ORDER as its own file write ----
  {
    const writes = disk.slice(1); const gaps = writes.slice(1).map((v, i) => v.mtime - writes[i].mtime);
    const inputs = keys.length + (hold?.ts.length ?? 0) + clicks0.length;
    A.replay = { writes: writes.length, inputs, firstWriteAfterLastInput: writes.length ? r1(writes[0].mtime - tLastKey) : null, finalWriteAfterLastInput: writes.length ? r1(writes.at(-1).mtime - tLastKey) : null,
      span: writes.length ? r1(writes.at(-1).mtime - writes[0].mtime) : null, gaps: { min: r1(Math.min(...gaps)), p50: r1(q(gaps, 0.5)), p95: r1(q(gaps, 0.95)), max: r1(Math.max(...gaps)) } };
  }
  // ---- editor probe marks (app/src/utils/probeMark.ts): accept-lane phases, materializer rows, who calls localFetch ----
  {
    const ev = edAll('ev').filter(e => e.what && !/^(start|pagehide|visibility)/.test(e.what)).map(e => ({ ...e, t: e.t + eOff })).sort((a, b) => a.t - b.t);
    const of = k => ev.filter(e => e.what === k);
    if (ev.length) {
      const [en, ln, ck, pr, sg, ft, id, st, pb] = ['acc:enter', 'acc:lane', 'acc:checkpoint', 'acc:prepared', 'acc:staged', 'acc:features', 'acc:identities', 'acc:stored', 'acc:published'].map(of);
      const m = Math.min(en.length, ln.length, ck.length, pr.length, sg.length, ft.length, id.length, st.length, pb.length);
      const rowsA = Array.from({ length: m }, (_, i) => ({ at: rel(en[i].t), queue: r1(ln[i].t - en[i].t), checkpoint: r1(ck[i].t - ln[i].t), prepare: r1(pr[i].t - ck[i].t), stage: r1(sg[i].t - pr[i].t), features: r1(ft[i].t - sg[i].t), identities: r1(id[i].t - ft[i].t), store: r1(st[i].t - id[i].t), publish: r1(pb[i].t - st[i].t), total: r1(pb[i].t - en[i].t), bytes: sg[i].bytes }));
      const stat = f => { const v = rowsA.map(f).filter(x => x != null); return { p50: r1(q(v, 0.5)), p95: r1(q(v, 0.95)), max: r1(Math.max(0, ...v)) }; };
      A.acceptPhases = { edits: m, enters: en.length, published: pb.length, queue: stat(x => x.queue), checkpoint: stat(x => x.checkpoint), prepare: stat(x => x.prepare), stage: stat(x => x.stage), features: stat(x => x.features), identities: stat(x => x.identities), store: stat(x => x.store), publish: stat(x => x.publish), total: stat(x => x.total), docBytes: stat(x => x.bytes), perEdit: rowsA.length <= 14 ? rowsA : undefined };
      A.acceptSeries = rowsA.map(r => [r.total, r.checkpoint, r.prepare, r.stage, r.features, r.identities, r.store, r.publish, r.queue, r.at]);
      { // finer J/S attribution INSIDE the lane window of each edit (marks sc:* ps:* pci:* from the probe2 bundle)
        const within = (k, i) => ev.filter(e => e.what === k && e.t >= ln[i].t && e.t <= pb[i].t); const first = (k, i) => within(k, i)[0]; const dt = (a, b) => (a && b ? r1(b.t - a.t) : null);
        const fine = Array.from({ length: m }, (_, i) => { const psS = first('ps:start', i), psR = first('ps:rows', i), psM = first('ps:mat', i), psU = first('ps:unmat', i), psE = first('ps:run-end', i), scS = first('sc:start', i), scR = first('sc:rows', i), scE = first('sc:end', i), pc = first('pci:cmd', i), pr = first('pci:read', i), pv = first('pci:resolved', i), pu = first('pci:updated', i);
          return { psRows: dt(psS, psR), psMat: dt(psR, psM), psUnmat: dt(psM, psU), psRun: dt(psU, psE), pciRead: dt(pc, pr), scRows: dt(scS, scR), scRcpt: dt(scR, scE), resolve: dt(pr, pv), update: dt(pv, pu), n: psR?.n ?? null, mat: psR?.mat ?? null, rc: psM?.rc ?? null, scN: scR?.n ?? null, scRc: scE?.rc ?? null, bytes: pr?.bytes ?? null, scCnt: within('sc:start', i).length, psCnt: within('ps:start', i).length, scSum: within('sc:end', i).reduce((t, e, j) => { const s0 = within('sc:start', i)[j]; return t + (s0 ? e.t - s0.t : 0); }, 0) }; });
        if (fine.some(f => f.psRows != null || f.scRows != null)) {
          const fs2 = f => { const v = fine.map(f).filter(x => x != null); return v.length ? { p50: r1(q(v, 0.5)), p95: r1(q(v, 0.95)), max: r1(Math.max(...v)) } : null; };
          A.fine = { psRows: fs2(x => x.psRows), psMat: fs2(x => x.psMat), psUnmat: fs2(x => x.psUnmat), psRun: fs2(x => x.psRun), pciRead: fs2(x => x.pciRead), scRows: fs2(x => x.scRows), scRcpt: fs2(x => x.scRcpt), resolve: fs2(x => x.resolve), update: fs2(x => x.update), rowsLoaded: fs2(x => x.n), matRows: fs2(x => x.mat), receiptGets: fs2(x => x.rc), scReceiptGets: fs2(x => x.scRc), fileBytes: fs2(x => x.bytes), scScansPerEdit: fs2(x => x.scCnt), psScansPerEdit: fs2(x => x.psCnt), scTotalMs: fs2(x => x.scSum) };
          A.fineSeries = fine.map(f => [f.psRows, f.psMat, f.psUnmat, f.psRun, f.pciRead, f.scRows, f.scRcpt, f.resolve, f.update, f.n, f.mat, f.rc, f.scN, f.scRc]);
        }
      }
      const [mr, iw, idn, rc, dp, rr] = ['mat:row', 'mat:idle-wait', 'mat:idle-done', 'mat:reconciled', 'mat:dispatched', 'mat:recorded'].map(of);
      const rowsM = mr.map((r, i) => { const iwI = iw.find(e => e.rev === r.rev); const idI = idn.find(e => e.rev === r.rev); const rcI = rc.find(e => e.rev === r.rev); const dpI = dp.find(e => e.rev === r.rev); const rrI = rr.find(e => e.rev === r.rev);
        return { rev: r.rev, startAfterLastInput: r1(r.t - tLastKey), idle: iwI && idI ? r1(idI.t - iwI.t) : null, deferIn: iwI?.deferIn != null ? Math.round(iwI.deferIn) : null, prepareReconcile: idI && rcI ? r1(rcI.t - idI.t) : null, dispatch: rcI && dpI ? r1(dpI.t - rcI.t) : null, record: dpI && rrI ? r1(rrI.t - dpI.t) : null, total: rrI ? r1(rrI.t - r.t) : null, nextGap: mr[i + 1] && rrI ? r1(mr[i + 1].t - rrI.t) : null }; });
      const sm = f => { const v = rowsM.map(f).filter(x => x != null); return { p50: r1(q(v, 0.5)), p95: r1(q(v, 0.95)), max: r1(Math.max(0, ...v)) }; };
      A.materialize = { rows: rowsM.length, passes: of('mat:pass').map(e => ({ at: rel(e.t), rows: e.rows })).slice(0, 12), prepareReconcile: sm(x => x.prepareReconcile), dispatch: sm(x => x.dispatch), record: sm(x => x.record), total: sm(x => x.total), nextGap: sm(x => x.nextGap), firstIdleWait: rowsM[0]?.idle ?? null, perRow: rowsM.length <= 12 ? rowsM : undefined };
      const lf = of('lf'); const byR = {};
      for (const e of lf) { const k = `${e.m} ${e.r}`.replace(/file=[^&]*/, 'file=*'); const v = byR[k] ??= { n: 0, stacks: {} }; v.n++; if (e.st?.length) { const top = e.st.slice(0, 4).join(' <- '); v.stacks[top] = (v.stacks[top] ?? 0) + 1; } }
      A.localFetch = { total: lf.length, byRoute: Object.fromEntries(Object.entries(byR).sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, v]) => [k, { n: v.n, callers: Object.entries(v.stacks).sort((a, b) => b[1] - a[1]).slice(0, 3) }])) };
      A.marksCls = of('cls:set').length;
    }
  }
  // ---- canvas refresh path: Vite HMR frames (runner clock) + every fetch the page made (frame clock) ----
  {
    const ws = (run.ws ?? []).filter(w => w.t >= tStart - 100 && w.t <= tStop + 100);
    const cntW = {}; for (const w of ws) { const k = `${w.type}${w.event ? ':' + w.event : ''}${w.updates?.length ? '(' + w.updates[0].split(':')[0] + ')' : ''}`; cntW[k] = (cntW[k] ?? 0) + 1; }
    A.hmr = { frames: ws.length, byKind: cntW, nonCss: ws.filter(w => !(w.updates?.length && w.updates.every(u => u.startsWith('css-update')))).map(w => ({ at: rel(w.t), type: w.type, event: w.event, path: w.path, updates: w.updates })).slice(0, 30) };
    const fe = frAll('fetch').filter(f => !/\.(png|jpg|css|svg|woff2?)(\?|$)/.test(f.url)).map(f => ({ at: rel(f.t + fOff), dt: f.dt, url: f.url.replace(/^https?:\/\/[^/]+/, ''), status: f.status, ct: f.ct }));
    A.frameFetch = { total: fe.length, list: fe.slice(0, 40) };
  }
  // ---- long tasks / LoAF / input timing ----
  const longE = edAll('long'); const longF = frAll('long');
  A.longTasks = { editor: { n: longE.length, sum: sum(longE.map(x => x.d)), max: Math.max(0, ...longE.map(x => x.d)) }, frame: { n: longF.length, sum: sum(longF.map(x => x.d)), max: Math.max(0, ...longF.map(x => x.d)) } };
  const lo = (docs, off, who) => docs.flatMap(d => d.data.loaf ?? []).map(x => ({ who, at: rel(x.t + off), d: x.d, block: x.block, scripts: (x.scripts ?? []).slice(0, 3).map(s => `${s.d}ms ${s.fn || s.inv}@${s.src}`) }));
  A.loaf = [...lo(edDocs, eOff, 'editor'), ...lo(frDocs, fOff, 'frame')].sort((a, b) => b.d - a.d).slice(0, 14);
  const keyEvt = edAll('evt').filter(e => /^(keydown|keyup|keypress|input|beforeinput)$/.test(e.name));
  A.inputTiming = { n: keyEvt.length, p50: q(keyEvt.map(e => e.d), 0.5), p95: q(keyEvt.map(e => e.d), 0.95), max: Math.max(0, ...keyEvt.map(e => e.d)), worstProcessing: Math.max(0, ...keyEvt.map(e => e.proc)) };
  const kd = edAll('key').filter(k => k.type === 'keydown' && /^[\d]$/.test(k.key));
  A.inputDelay = { n: kd.length, p50: r1(q(kd.map(k => k.t - k.ts), 0.5)), max: r1(Math.max(0, ...kd.map(k => k.t - k.ts))) };
  // ---- messages ----
  const cnt = (list, f) => list.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  A.editorMsgs = cnt(edAll('msg'), m => `${m.self ? 'self:' : 'frame:'}${m.type}`);
  A.frameMsgsIn = cnt(frAll('msg').filter(m => m.up), m => m.type);
  const edMsgs = edAll('msg');
  A.syncClassesOut = edMsgs.filter(m => m.self && m.type === 'SYNC_CLASSES_TO_IFRAME').map(m => ({ at: rel(m.t + eOff), cls: m.cls })).slice(0, 60);
  A.updateClassesIn = frAll('msg').filter(m => /UPDATE_CLASSES|SYNC_CLASSES/.test(m.type)).map(m => ({ at: rel(m.t + fOff), key: (m.key ?? '').slice(-18), cls: m.cls })).slice(0, 60);
  const clsMut = frAll('cls').filter(c => c.attr === 'class').map(c => ({ at: rel(c.t + fOff), n: c.n, to: (c.val ?? '').replace(/\s*rounded\s*/, ' ').trim().slice(0, 40) }));
  A.classMutations = { total: clsMut.length, list: clsMut.slice(0, 80) };
  A.refreshes = frAll('cls').filter(c => c.attr === 'data-sq-source-version' && c.n === (typedImgs[0] ?? 1)).map(c => ({ at: rel(c.t + fOff), stamp: (c.val ?? '').slice(0, 24) })).slice(0, 30);
  A.editorTimeline = edMsgs.filter(m => !SPAM.test(m.type) && !m.self).map(m => ({ at: rel(m.t + eOff), type: m.type, n: m.n })).slice(0, 80);
  A.domBatches = frAll('dom').map(d => ({ at: rel(d.t + fOff), add: d.add, rem: d.rem, tgt: d.tgt })).filter(d => d.add + d.rem >= 8).slice(0, 30);
  // ---- logs (frame console: HMR / morph), IPC ----
  A.frameLog = frAll('log').filter(l => /vite|hot|reload|morph|refresh|update/i.test(l.s)).map(l => ({ at: rel(l.t + fOff), s: l.s.slice(0, 110) })).slice(0, 40);
  const win = run.ipc.filter(c => c.at >= tStart - 300 && c.at <= tStop + 800);
  const routeOf = c => (c.route || c.name).replace(/^(\w+) /, '').replace(/^local /, '').replace(/\?.*$/, '').replace(/^\/__sq\/local\//, '');
  const by = {}; for (const c of win) { const k = routeOf(c); const v = by[k] ??= { n: 0, ms: 0, first: null, last: null }; v.n++; v.ms += c.ms; v.first ??= rel(c.at); v.last = rel(c.at); }
  A.ipc = { total: win.length, totalMs: sum(win.map(c => c.ms)), perKeystroke: keys.length ? r1(win.filter(c => c.at < T0 + 2000).length / keys.length) : null, byRoute: Object.fromEntries(Object.entries(by).sort((a, b) => b[1].n - a[1].n).slice(0, 14)) };
  A.ipcWrites = win.filter(c => /source-command|\/file\b(?!\?.*probe)/.test(c.route ?? '') && /POST|source-command/.test((c.route ?? '') + c.name)).map(c => ({ at: rel(c.at), ms: c.ms, route: routeOf(c) })).slice(0, 40);
  A.editorWFrames = (() => { const f = edDocs.flatMap(d => d.data.frames ?? []); const out = []; let prev = null; for (const r of f) { if (r[2] !== prev) { out.push({ at: rel(r[1] + eOff), v: r[2] }); prev = r[2]; } } return out.slice(0, 60); })();
  { const ow = at('outside-write'); if (ow.length) A.outside = ow.map(o => ({ i: o.i, at: rel(o.t0), afterLastKey1: o.afterLastKey1 })); }
  A.overlay = overlayAnalysis(run, { eOff, fOff, N, T0, rel, rows, seq, typedImgs, keys, edDocs, perImage: A.perImage });
  A.journal = { before: run.journalBefore ?? null, after: run.drain ?? null, rowsAdded: run.rowsAdded ?? null };
  A.cpu = run.cpu; A.load = [run.loadStart, run.loadEnd];
  // ---- T3: class-attribute mutations of the canvas, any element, class level and visible-frame level (t3.mjs). Source `cc` = every element (recorder.mjs buffer
  // cc, values chained inside a mutation batch); `cls` = the probe images only (runs recorded before `cc` existed: R11/R12 raw runs); null = no class log at all.
  {
    const hasCc = frDocs.some(d => Array.isArray(d.data.cc)); const hasCls = frDocs.some(d => Array.isArray(d.data.cls));
    if (hasCc || hasCls) {
      const records = hasCc ? frDocs.flatMap(d => (Array.isArray(d.data.cc) ? d.data.cc : [])).map(c => ({ ...c, t: c.t + fOff }))
        : frAll('cls').filter(c => c.attr === 'class').map(c => ({ t: c.t + fOff, id: c.n, n: c.n, eid: '', tag: 'IMG', old: c.old, val: c.val }));
      const inputs = [];
      for (const t of typed) { for (const k of t.keys) inputs.push({ n: t.n, t: k.t1 }); for (const e of t.enters ?? []) inputs.push({ n: t.n, t: e.t1 }); }
      if (hold?.ts?.length) inputs.push({ n: hold.n ?? i1, t: hold.ts.at(-1) });
      for (const c of clicks0) inputs.push({ n: c.n ?? (run.scn === 'S5' ? 'fx' : i2), t: c.t1 ?? c.t0 });
      for (const u of at('undo').filter(u => u.t >= tStart)) inputs.push({ n: u.n, t: u.t1 ?? u.t0 });
      for (const u of at('input').filter(u => u.t >= tStart)) inputs.push({ n: u.n, t: u.t1 ?? u.t });
      // what each element's final value must be (a capture can end on a stale class): the `w-[Npx]` token a typed / held element carries, or the target of its last undo
      const expectTok = {};
      for (const [n, p] of Object.entries(A.perImage)) if (typeof p.expectFinal === 'number') expectTok[n] = `w-[${p.expectFinal}px]`;
      if (A.hold && Number.isFinite(A.hold.finalExpected)) expectTok[i1] = `w-[${A.hold.finalExpected}px]`;
      const lastUndo = {}; for (const u of at('undo').filter(u => u.t >= tStart)) if (!lastUndo[u.n] || u.t0 > lastUndo[u.n].t0) lastUndo[u.n] = u;
      const initialFor = n => { const m = at('initial').find(x => x.n === n); const first = records.find(r => r.n === n); return m ? canon(m.cls) : first ? canon(first.old) : null; };
      for (const u of Object.values(lastUndo)) expectTok[u.n] = u.target === 'initial' ? { eq: initialFor(u.n) } : u.target;
      const t3 = classTimelines({ records, inputs, ticks: rows.map(r => r.t), tEnd: tStop, expect: expectTok });
      const compact = el => ({ label: el.label, n: el.n, eid: el.eid, tag: el.tag, edited: el.edited, initial: el.initial, final: el.final, last: el.last, mutations: el.mutations, noop: el.noop,
        lastInputAt: el.lastInputAt == null ? null : rel(el.lastInputAt), reachedAt: el.reachedAt == null ? null : rel(el.reachedAt), neverReached: el.neverReached, collateral: el.collateral, late: el.late,
        timeline: el.states.slice(0, 60).map(st => ({ at: rel(st.t), cls: st.raw.slice(0, 90), ...(st.noop ? { noop: true } : {}) })) });
      A.t3 = { source: hasCc ? 'cc' : 'cls', totals: t3.totals, elements: [...t3.elements].sort((a, b) => Number(b.edited) - Number(a.edited)).slice(0, 40).map(compact) };
      // ---- S7 / S7b: each Cmd-Z judged against its target (the pre-edit class, or a class that has / lacks tokens) until the next undo of the same element
      const undos = at('undo').filter(u => u.t >= tStart);
      if (undos.length) {
        const elOf = n => t3.elements.find(e => e.n === n || (e.eid !== '' && e.eid === String(n)));
        const initialOf = n => { const m = at('initial').find(x => x.n === n); return m ? canon(m.cls) : elOf(n)?.initial ?? null; };
        const presses = undos.map(u => {
          const el = elOf(u.n); const states = (el?.states ?? []).filter(st => !st.noop);
          const bound = undos.filter(v => v.n === u.n && v.t0 > u.t0).map(v => v.t0).sort((x, y) => x - y)[0] ?? tStop;
          const target = u.target === 'initial' ? { eq: initialOf(u.n) } : (u.target ?? {});
          const has = key => key.split(' ');
          const ok = key => (target.eq !== undefined ? key === target.eq : (target.has ?? []).every(tk => has(key).includes(tk)) && !(target.not ?? []).some(tk => has(key).includes(tk)));
          const win = states.filter(st => st.t > u.t0 && st.t <= bound); const hit = win.find(st => ok(st.key));
          const inEffect = [...states].reverse().find(st => st.t <= bound)?.key ?? el?.initial ?? '';
          return { k: u.k, n: u.n, at: rel(u.t0), focus: u.focus, target: u.target, painted: !!hit, paintMs: hit ? r1(hit.t - u.t0) : null, nonUndoValue: win.filter(st => !ok(st.key)).length, endSatisfied: ok(inEffect) };
        });
        A.undo = { presses, endIsPreEdit: Object.fromEntries([...new Set(undos.map(u => u.n))].map(n => [n, elOf(n) ? elOf(n).last === initialOf(n) : null])), nonUndoValue: sum(presses.map(x => x.nonUndoValue)) };
      }
    } else A.t3 = null;
  }
  // ---- journal row kinds the run added (S10: V1 class-write rows are deferred 5 s, V2/V3 file-batch rows are not), CPU throttle record (S13), V2 writer marks
  if (Array.isArray(run.journalRows) && run.journalRows.length) {
    const kinds = {}; const files = {}; const defer = new Set();
    for (const r of run.journalRows) for (const c of r.commands ?? []) {
      kinds[c.kind] = (kinds[c.kind] ?? 0) + 1;
      for (const f of c.files ?? []) { const name = f.replace(/:(?:\d+|null)>(?:\d+|null)$/, ''); files[name] = (files[name] ?? 0) + 1; }
      if (c.deferIn != null) defer.add(c.deferIn);
    }
    A.rows = { n: run.journalRows.length, kinds, files, deferIn: [...defer].sort((x, y) => x - y) };
  }
  if (run.throttle) A.throttle = run.throttle;
  {
    const marks = edAll('ev').filter(e => e.what).map(e => ({ ...e, t: e.t + eOff }));
    if (marks.some(m => m.what === 'cls:set' || m.what.startsWith('v2:'))) { const v = v2Run(marks, rel); A.v2 = v.edits.length <= 12 ? v : { ...v, edits: undefined, writes: undefined, editCount: v.edits.length }; }
  }
  return A;
}


// ---- P5: the selection overlay (editor DOM) vs the image it follows (canvas DOM). Needs cfg.overlay (recorder samples overlay rects + image x,y per frame). ----
function overlayAnalysis(run, { eOff, fOff, N, T0, rel, rows, seq, typedImgs, keys, edDocs, perImage }) {
  if (!run.cfg?.overlay || !run.iframeGeom) return null;
  const g = run.iframeGeom; const k = g.w / g.lw; const P = run.cfg.styleProbes?.length ?? 0; const ovIdx = 3 + (run.cfg.editorWatch?.length ?? 0);
  const fr = (rows ?? []).map(r => ({ ...r, xy: r.sp.slice(P) })); if (!fr.length) return null;
  const edFrames = edDocs.flatMap(d => d.data.frames ?? []).map(r => ({ t: r[1] + eOff, ov: Array.isArray(r[ovIdx]) ? r[ovIdx] : [] })).sort((a, b) => a.t - b.t);
  const out = {}; let p = 0;
  for (const n of typedImgs) {
    const series = []; p = 0;
    for (const ef of edFrames) {
      while (p + 1 < fr.length && fr[p + 1].t <= ef.t) p++;
      const f = fr[p]; if (!f || f.xy[2 * (n - 1)] == null) continue;
      const ix = g.x + f.xy[2 * (n - 1)] * k, iy = g.y + f.xy[2 * (n - 1) + 1] * k, iw = f.w[n - 1] * k, ih = f.h[n - 1] * k;
      let best = null; for (const o of ef.ov) { const d = Math.abs(o[0] - ix) + Math.abs(o[1] - iy); if (d < 14 && (!best || d < best.d)) best = { d, o }; }
      series.push({ t: ef.t, ow: best ? best.o[2] / k : null, oh: best ? best.o[3] / k : null, iw: iw / k, ih: ih / k });
    }
    // stroke offset = median (overlay - image) over the frames BEFORE the first key
    const pre = series.filter(s => s.t < T0 && s.ow != null).map(s => s.ow - s.iw); const off = pre.length ? q(pre, 0.5) : 0;
    const ovSteps = []; let prev = null;
    for (const s of series) { if (s.ow == null) continue; const w = s.ow - off; if (prev === null || Math.abs(w - prev.w) > 0.8) { prev = { t: s.t, w, frames: 1 }; ovSteps.push(prev); } else prev.frames++; }
    const imgSteps = (seq[n] ?? []).map(c => ({ t: c.t, w: c.w, frames: c.frames }));
    const match = imgSteps.map(is => { const hit = ovSteps.find(os => os.t >= is.t - 25 && os.t <= is.t + 1500 && Math.abs(os.w - is.w) <= 2.5); return { imgAt: rel(is.t), w: r1(is.w), imgFrames: is.frames, ovLag: hit ? r1(hit.t - is.t) : null }; });
    const orphan = ovSteps.filter(os => !imgSteps.some(is => os.t >= is.t - 25 && os.t <= is.t + 1500 && Math.abs(os.w - is.w) <= 2.5)).map(os => ({ at: rel(os.t), w: r1(os.w), frames: os.frames }));
    const lags = match.filter(m => m.ovLag != null).map(m => m.ovLag);
    const typedFrom = (keys.find(kk => kk.n === n)?.t0 ?? T0) - 50; const late = match.filter(m => m.imgAt != null && (T0 + m.imgAt) > typedFrom);
    out[n] = { offsetPx: r1(off), samples: series.length, withOverlay: series.filter(s => s.ow != null).length, imgSteps: imgSteps.length, ovSteps: ovSteps.length, matched: lags.length, lag: { p50: r1(q(lags, 0.5)), p95: r1(q(lags, 0.95)), max: r1(Math.max(0, ...lags)) },
      unfollowed: match.filter(m => m.ovLag == null).length, orphanOverlaySteps: orphan.slice(0, 12), steps: match.slice(0, 40), noOverlayFrames: series.filter(s => s.ow == null).length };
    // overlay jumps (T3): selection-box width steps after the box first showed the final width at/after the last key
    const lastKey = keys.filter(kk => kk.n === n).at(-1); const fin = perImage?.[n]?.expectFinal;
    if (lastKey && typeof fin === 'number') {
      const reach = ovSteps.find(os => os.t >= lastKey.t0 - 25 && Math.abs(os.w - fin) <= 2.5); const late = reach ? ovSteps.filter(os => os.t > reach.t) : [];
      out[n].lateSteps = late.length; out[n].lateStepList = late.slice(0, 12).map(os => ({ at: rel(os.t), w: r1(os.w), frames: os.frames }));
    }
  }
  return out;
}

export function summaryLine(run) {
  const a = run.analysis; if (!a) return `${run.scn}@${run.param} r${run.rep}: no analysis`;
  const per = Object.entries(a.perImage).slice(0, 4).map(([n, p]) => `img${n}→${p.expectFinal}${p.finalOk ? '' : '!=' + p.finalAtEnd}${p.changesAfterFinal.length ? ' LATE×' + p.changesAfterFinal.length + ' ' + JSON.stringify(p.changesAfterFinal.slice(0, 2).map(c => [c.afterOwnLastKey, c.w])) : ''}`).join(' | ');
  const k2p = a.keyToPaint.length <= 12 ? a.keyToPaint.map(x => (x.painted == null ? 'skip' : Math.round(x.painted))).join('/') : `p50 ${a.keyToPaintStats.p50} p95 ${a.keyToPaintStats.p95} max ${a.keyToPaintStats.max} (${a.keyToPaintStats.painted}/${a.keyToPaintStats.of})`;
  const sw = a.switch ? ` | img1 after click: ${a.switch.img1ChangesAfterClick.length}${a.switch.img1ChangesAfterClick.length ? ' ' + JSON.stringify(a.switch.img1ChangesAfterClick.slice(0, 3).map(c => [c.afterClick, c.w, c.frames])) : ''}` : '';
  const s5 = a.s5 ? ` | S5 clicks ${a.s5.painted}/${a.s5.of} painted (lost ${a.s5.lost}), click→paint p50/p95/max ${a.s5.key2paint.p50}/${a.s5.key2paint.p95}/${a.s5.key2paint.max}, busy windows ${a.s5.busyWindows.length} ${JSON.stringify(a.s5.busyWindows.slice(0, 3))}, final ${a.s5.finalCanvas}` : '';
  const hold = a.hold ? ` | HOLD ${a.hold.presses} presses → final ${a.hold.finalPainted} (expected ${a.hold.finalExpected}, lost ${a.hold.lostIncrements}), distinct widths ${a.hold.distinctWidthsPainted}, key→paint p50/p95/max ${a.hold.key2paint.p50}/${a.hold.key2paint.p95}/${a.hold.key2paint.max}, settled +${a.hold.settledAfterLastPress}ms after last press` : '';
  const t3 = a.t3 ? ` | T3 late ${a.t3.totals.lateMutations} (wrong ${a.t3.totals.lateWrongStates}, visible ${a.t3.totals.lateVisible}, dwell ${Math.round(a.t3.totals.dwellMs)}ms, collateral ${a.t3.totals.collateral})` : '';
  const un = a.undo ? ` | undo ${a.undo.presses.map(p => `${p.n}:${p.painted ? 'painted+' + p.paintMs : 'unpainted'}/${p.nonUndoValue}`).join(' ')} preEdit ${JSON.stringify(a.undo.endIsPreEdit)}` : '';
  return `${run.scn}@${run.param} r${run.rep} boot ${run.bootMs}ms${hold}${s5} | key→paint [${k2p}] inter ${a.intermediate.painted}/${a.intermediate.n} vis≥2fr ${a.intermediate.visible2fr} | ${per}${sw} | disk ${a.diskVersions}v first +${a.diskFirstWriteAt} final +${a.diskFinalAt} (lastKey +${a.lastKeyAt}) ok ${JSON.stringify(a.diskFinalOk)} | LT e ${a.longTasks.editor.n}/${a.longTasks.editor.max} f ${a.longTasks.frame.n}/${a.longTasks.frame.max} | gap>34 ${a.frameGap.over34} | ipc ${a.ipc.total}${t3}${un}`;
}

// ---- CLI: one line per run JSON in a directory ----
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) { // a path with a space is %20 in import.meta.url
  const dir = process.argv[2]; const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json') && !/^(summary|explore)/.test(f)).sort();
  for (const f of files) { try { const r = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')); if (r.scn) { if (r.ok) r.analysis = analyzeRun(r); console.log(r.label, summaryLine(r)); } } catch (e) { console.log(f, 'ERR', e.message); } }
}
