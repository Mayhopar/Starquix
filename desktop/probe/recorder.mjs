// Probe recorder. `recorderInit` is serialized by Playwright (page.addInitScript + frame.evaluate), so it must
// stay self-contained. One copy runs in the EDITOR document (role 'editor') and one in every iframe (role 'frame' = the user's site).
// Clock: E() = performance.timeOrigin + performance.now() (epoch ms, sub-ms). The runner calibrates each document against Node's clock.
// Data leaves through the exposed binding window.__probePush (chunks every 400 ms + on pagehide), so a reloaded document loses at most 400 ms.
export function recorderInit() {
  if (window.__PR) return;
  const E = () => performance.timeOrigin + performance.now();
  const top = window.top === window;
  const PR = window.__PR = { role: top ? 'editor' : 'frame', docId: Math.random().toString(36).slice(2, 8), running: false, seq: 0, url: location.href };
  let cfg = null; let buf = null; let rafId = 0; const timers = []; const observers = []; const undo = [];
  const newBuf = () => ({ frames: [], cls: [], cc: [], msg: [], key: [], long: [], loaf: [], evt: [], dom: [], log: [], ev: [], fetch: [] });
  const flush = final => {
    if (!buf) return null;
    const data = buf; buf = newBuf();
    const chunk = { docId: PR.docId, role: PR.role, url: location.href, seq: PR.seq++, final: !!final, data };
    try { window.__probePush?.(chunk); } catch { /* binding missing: the final evaluate still reads PR.last */ }
    return chunk;
  };
  PR.flush = flush;
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); undo.push(() => target.removeEventListener(type, fn, opts)); };
  const observe = (type, fn, extra = {}) => { try { const o = new PerformanceObserver(fn); o.observe({ type, buffered: false, ...extra }); observers.push(o); } catch { /* unsupported entry type */ } };
  const trunc = (s, n) => (typeof s === 'string' ? s.slice(0, n) : s);

  PR.start = c => {
    if (PR.running) return PR.docId;
    PR.running = true; cfg = c; buf = newBuf(); PR.startedAt = E();
    try { sessionStorage.setItem('__probeCfg', JSON.stringify(c)); } catch { /* sandboxed frame: the runner re-starts after navigation */ }
    // ---- shared: long tasks, long animation frames, document lifecycle ----
    observe('longtask', l => { for (const e of l.getEntries()) buf.long.push({ t: performance.timeOrigin + e.startTime, d: Math.round(e.duration) }); });
    observe('long-animation-frame', l => {
      for (const e of l.getEntries()) buf.loaf.push({ t: performance.timeOrigin + e.startTime, d: Math.round(e.duration), block: Math.round(e.blockingDuration || 0),
        renderStart: e.renderStart ? Math.round(e.renderStart - e.startTime) : null, styleLayout: e.styleAndLayoutStart ? Math.round(e.startTime + e.duration - e.styleAndLayoutStart) : null,
        scripts: (e.scripts || []).slice(0, 8).map(s => ({ d: Math.round(s.duration), inv: trunc(s.invoker || '', 80), fn: trunc(s.sourceFunctionName || '', 60), src: trunc((s.sourceURL || '').replace(/^.*\//, ''), 60), pos: s.sourceCharPosition })) });
    });
    on(window, 'pagehide', () => { buf?.ev.push({ t: E(), what: 'pagehide' }); flush(true); }, true);
    on(document, 'visibilitychange', () => buf?.ev.push({ t: E(), what: 'visibility:' + document.visibilityState }), true);
    for (const k of ['log', 'info', 'debug', 'warn', 'error']) {
      const orig = console[k];
      const show = x => (typeof x === 'string' ? x : typeof x === 'number' || typeof x === 'boolean' ? String(x) : x instanceof Error ? `${x.name}: ${x.message}` : `[${Object.prototype.toString.call(x).slice(8, -1)}]`);
      console[k] = function (...a) { try { if (buf && buf.log.length < 3000) buf.log.push({ t: E(), k, s: trunc(a.map(show).join(' '), 220) }); } catch { /* never break the page */ } return orig.apply(this, a); };
      undo.push(() => { console[k] = orig; });
    }
    if (PR.role === 'frame') {
      // ---- the user's site: per-frame geometry of every probe image + class mutations + DOM replacement + parent→frame messages ----
      const N = c.nImages || 10; const sel = i => `img[alt="Probe image ${i}"]`;
      { // every fetch the page itself makes (the canvas refresh from source is one): start + duration + status
        const origFetch = window.fetch;
        window.fetch = function (input) {
          const t0 = E(); const url = typeof input === 'string' ? input : input && input.url; const p = origFetch.apply(this, arguments);
          p.then(r => { if (buf) buf.fetch.push({ t: t0, dt: Math.round((E() - t0) * 10) / 10, url: trunc(String(url), 100), status: r.status, ct: trunc(r.headers.get('content-type') || '', 30) }); }, () => { if (buf) buf.fetch.push({ t: t0, dt: Math.round((E() - t0) * 10) / 10, url: trunc(String(url), 100), err: 1 }); });
          return p;
        };
        undo.push(() => { window.fetch = origFetch; });
      }
      const tick = ts => {
        if (!PR.running) return;
        const row = [performance.timeOrigin + ts, E()];
        for (let i = 1; i <= N; i++) {
          const el = document.querySelector(sel(i));
          if (el) { const r = el.getBoundingClientRect(); row.push(Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100); } else row.push(-1, -1);
        }
        for (const sp of c.styleProbes || []) { const el = document.querySelector(sp.sel); row.push(el ? getComputedStyle(el)[sp.prop] : null); }
        if (c.overlay) for (let i = 1; i <= N; i++) { const el = document.querySelector(sel(i)); if (el) { const r = el.getBoundingClientRect(); row.push(Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10); } else row.push(-1, -1); }
        buf.frames.push(row);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      // `cc` = the class attribute of ANY element (the T3 late-change log, t3.mjs): each record carries the value AFTER its own mutation, chained through the
      // batch (a record's value is the next record's oldValue for the same element, the last one's is the DOM value now); `cls` below keeps the probe images only.
      const ids = new WeakMap(); let idSeq = 0; const idOf = el => { let v = ids.get(el); if (!v) ids.set(el, v = ++idSeq); return v; };
      const mo = new MutationObserver(list => {
        const t = E(); let add = 0; let rem = 0; const tgt = new Set();
        const later = new Map(); const chained = [];
        for (let i = list.length - 1; i >= 0; i--) {
          const m = list[i]; if (m.type !== 'attributes' || m.attributeName !== 'class') continue;
          const el = m.target; const val = later.has(el) ? later.get(el) : el.getAttribute('class'); later.set(el, m.oldValue);
          const alt = el.nodeName === 'IMG' ? /^Probe image (\d+)$/.exec(el.getAttribute('alt') || '') : null;
          chained.push({ t, id: idOf(el), n: alt ? +alt[1] : null, eid: el.id || '', tag: el.nodeName, old: trunc(m.oldValue, 600), val: trunc(val, 600) });
        }
        if (buf.cc.length < 20000) for (let i = chained.length - 1; i >= 0; i--) buf.cc.push(chained[i]);
        for (const m of list) {
          if (m.type === 'attributes' && m.target.nodeName === 'IMG') {
            const mm = /^Probe image (\d+)$/.exec(m.target.getAttribute('alt') || '');
            if (mm) buf.cls.push({ t, n: +mm[1], attr: m.attributeName, old: trunc(m.oldValue, 160), val: trunc(m.target.getAttribute(m.attributeName), 160) });
          } else if (m.type === 'childList') { add += m.addedNodes.length; rem += m.removedNodes.length; if (tgt.size < 3) tgt.add(m.target.nodeName); }
        }
        if (add || rem) buf.dom.push({ t, add, rem, tgt: [...tgt] });
      });
      mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'src', 'data-sq-source-version'], attributeOldValue: true });
      undo.push(() => mo.disconnect());
      on(window, 'message', e => {
        const d = e.data; if (!d || typeof d !== 'object' || !d.type) return;
        buf.msg.push({ t: E(), type: d.type, key: trunc(d.payload?.key, 80), cls: trunc(d.payload?.classes, 120), up: e.source === window.parent });
      }, true);
    } else {
      // ---- the editor: keystrokes (with the W input's value), displayed W value per frame, all window messages, event timing ----
      window.__sqProbeMark = (what, data) => { if (buf && !(what === 'v2:write' && !(data && data.w && data.w.length))) buf.ev.push({ t: E(), what, ...(data || {}) }); }; // app/src/utils/probeMark.ts (no-op marks in the editor); a v2:write with no class write is noise
      window.__sqProbeStacks = !!c.stacks;
      undo.push(() => { delete window.__sqProbeMark; delete window.__sqProbeStacks; });
      const rec = e => buf.key.push({ t: E(), ts: performance.timeOrigin + e.timeStamp, type: e.type, key: e.key, rep: !!e.repeat,
        val: e.target && typeof e.target.value === 'string' ? e.target.value : undefined });
      for (const ty of ['keydown', 'keyup', 'input']) on(document, ty, rec, true);
      on(window, 'message', e => {
        const d = e.data; if (!d || typeof d !== 'object' || !d.type) return;
        const row = { t: E(), type: d.type, self: e.source === window };
        if (/CLASSES|INSTANCE_OVERRIDE|SCANNED|SELECT/.test(d.type)) { row.key = trunc(d.payload?.key, 80); row.cls = trunc(d.payload?.classes, 120); row.n = Array.isArray(d.payload?.elements) ? d.payload.elements.length : undefined; }
        buf.msg.push(row);
      }, true);
      observe('event', l => { for (const e of l.getEntries()) buf.evt.push({ t: performance.timeOrigin + e.startTime, name: e.name, d: Math.round(e.duration), proc: Math.round(e.processingStart - e.startTime), end: Math.round(e.processingEnd - e.startTime) }); }, { durationThreshold: 16 });
      let wInput = null;
      const tick = ts => {
        if (!PR.running) return;
        if (!wInput || !wInput.isConnected) { const bar = document.querySelector('[data-testid="design-bar"]'); const sp = bar && [...bar.querySelectorAll('span')].find(x => x.textContent === 'W' && x.nextElementSibling && x.nextElementSibling.tagName === 'INPUT'); wInput = sp ? sp.nextElementSibling : null; }
        const row = [performance.timeOrigin + ts, E(), wInput ? wInput.value : null];
        for (const w of c.editorWatch || []) { const el = document.querySelector(w.sel); row.push(el ? String(el[w.prop]) : null); }
        if (c.overlay) row.push([...document.querySelectorAll('div[class*="border-stroke-component"][class*="z-[1000]"]')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x * 10) / 10, Math.round(r.y * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }));
        buf.frames.push(row);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }
    timers.push(setInterval(flush, 400));
    buf.ev.push({ t: E(), what: 'start', role: PR.role, docId: PR.docId });
    return PR.docId;
  };
  PR.stop = () => {
    if (!PR.running) return;
    flush(false); PR.running = false; cancelAnimationFrame(rafId);
    for (const t of timers) clearInterval(t);
    for (const o of observers) o.disconnect();
    for (const u of undo) u();
    try { sessionStorage.removeItem('__probeCfg'); } catch { /* ignore */ }
    flush(true);
  };
  try { const raw = sessionStorage.getItem('__probeCfg'); if (raw) PR.start(JSON.parse(raw)); } catch { /* no storage */ }
}
