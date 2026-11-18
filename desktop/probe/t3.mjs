// T3 "no late change", from the canvas class-attribute mutation log (recorder.mjs buffer `cc`): per element the states its class went through, the
// FINAL value (the state it ended on), and every change after that value first arrived at or after the element's last user input.
// Two levels (design 4.2: DV2 found 23 class-level against 9 visible runs): CLASS level counts every string change after the final value (a reordered
// equal class is a mutation: planAttrPatch compares strings; token sets decide only whether a state IS the final value), VISIBLE level counts the wrong
// states a frame tick stood on. Rects are never read, so a user CSS `transition` cannot fake a late change. Pure: no IO, node-clock times in, numbers out.
//   import { classTimelines } from './t3.mjs'
const EPS = 2; // ms: clock calibration slack between an input's timestamp and the paint of its own value
const tokens = cls => (cls ?? '').split(/\s+/).filter(t => t && !/^sq-ai-/.test(t)); // sq-ai-* = the bridge's own flash classes, never a value

/** The token set of a class string as a canonical key (sorted, unique, sq-ai-* left out). */
export const canon = cls => [...new Set(tokens(cls))].sort().join(' ');

const matches = (want, s) => {
  if (typeof want === 'string') return s.raw.split(/\s+/).includes(want);
  const have = s.key.split(' ');
  return want.eq !== undefined ? s.key === want.eq : (want.has ?? []).every(t => have.includes(t)) && !(want.not ?? []).some(t => have.includes(t));
};

const hasTickIn = (ticks, from, to) => { // first tick >= from is before `to`
  let lo = 0, hi = ticks.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ticks[mid] < from) lo = mid + 1; else hi = mid; }
  return lo < ticks.length && ticks[lo] < to;
};

/**
 * @param records  [{ t, id, n, eid, tag, old, val }] one per class-attribute mutation: node-clock time, element id (recorder-assigned), probe image number
 *                 (or null), DOM id (or ''), tag, the class before and after (`val` is the value AFTER this mutation, not the DOM value at callback time)
 * @param inputs   [{ n, t }] user inputs: `n` = probe image number or an element id ('fx'), `t` = node-clock time
 * @param ticks    sorted frame-callback times (the canvas rAF ticks): only their TIMES are used
 * @param tEnd     capture stop time (caps the last dwell)
 * @param expect   { [label]: want } what the element's final value must be: a class token ('w-[300px]': typed number, held key), { eq: 'canonical key' } (an undo to the pre-edit
 *                 class) or { has: [...tokens], not: [...tokens] }. The final value is the LAST state at/after the last input that matches, so a capture that ends on a stale class
 *                 (a truncated hold, an undo the canvas lost) still counts that class as late. Without it, or when no state matches, the final value is the observed last state (`last`).
 */
export function classTimelines({ records, inputs = [], ticks = [], tEnd = Infinity, expect = {} }) {
  const end = Math.max(Number.isFinite(tEnd) ? tEnd : -Infinity, (ticks.at(-1) ?? -Infinity) + 1); // the recorders run a little past the stop mark: frames there count
  const byId = new Map();
  for (const r of [...records].sort((a, b) => a.t - b.t)) { // stable: equal times keep their log order
    if (!byId.has(r.id)) byId.set(r.id, { id: r.id, n: r.n ?? null, eid: r.eid ?? '', tag: r.tag ?? '', recs: [] });
    byId.get(r.id).recs.push(r);
  }
  const elements = [];
  for (const el of byId.values()) {
    const label = el.n != null ? el.n : el.eid ? `#${el.eid}` : `${el.tag.toLowerCase()}@${el.id}`;
    const states = el.recs.map(r => ({ t: r.t, raw: r.val ?? '', key: canon(r.val), prev: canon(r.old), noop: (r.old ?? '') === (r.val ?? '') }));
    const mine = inputs.filter(i => (el.n != null && i.n === el.n) || (el.eid !== '' && String(i.n) === el.eid));
    const tIn = mine.length ? Math.max(...mine.map(i => i.t)) : null;
    let final = states.at(-1).key;
    const want = expect[label]; // label is the probe number or '#id': object keys coerce
    if (want && tIn != null) { const hit = [...states].reverse().find(s => s.t >= tIn - EPS && matches(want, s)); if (hit) final = hit.key; }
    const out = { id: el.id, n: el.n, eid: el.eid, tag: el.tag, label, edited: tIn != null, initial: canon(el.recs[0].old), final, last: states.at(-1).key, mutations: states.filter(s => !s.noop).length,
      noop: states.filter(s => s.noop).length, lastInputAt: tIn, reachedAt: null, neverReached: false, collateral: 0,
      late: { mutations: 0, valueChanges: 0, other: 0, wrongStates: 0, visibleWrong: 0, dwellMs: 0, maxDwellMs: 0, noop: 0 }, states };
    if (tIn == null) out.collateral = out.mutations; // nothing the user did on this element: any class change on it is unexpected
    else {
      const reached = states.findIndex(s => s.t >= tIn - EPS && s.key === final);
      if (reached < 0) out.neverReached = true;
      else {
        out.reachedAt = states[reached].t;
        for (let j = reached + 1; j < states.length; j++) {
          const s = states[j];
          if (s.noop) { out.late.noop++; continue; }
          out.late.mutations++;
          if (s.key !== s.prev) out.late.valueChanges++; else out.late.other++;
          if (s.key === final) continue;
          const next = states[j + 1]?.t ?? end;
          out.late.wrongStates++;
          out.late.dwellMs += Math.max(0, next - s.t);
          out.late.maxDwellMs = Math.max(out.late.maxDwellMs, Math.max(0, next - s.t));
          if (hasTickIn(ticks, s.t, next)) out.late.visibleWrong++;
        }
      }
    }
    elements.push(out);
  }
  const sum = f => elements.reduce((t, e) => t + f(e), 0);
  const edited = elements.filter(e => e.edited);
  return { elements, totals: { elements: elements.length, edited: edited.length, lateOnEdited: sum(e => e.late.mutations), collateral: sum(e => e.collateral), lateMutations: sum(e => e.late.mutations + e.collateral),
    lateValueChanges: sum(e => e.late.valueChanges), lateOther: sum(e => e.late.other), lateWrongStates: sum(e => e.late.wrongStates), lateVisible: sum(e => e.late.visibleWrong),
    dwellMs: sum(e => e.late.dwellMs), maxDwellMs: Math.max(0, ...elements.map(e => e.late.maxDwellMs)), noop: sum(e => e.noop), neverReached: elements.filter(e => e.neverReached).length } };
}
