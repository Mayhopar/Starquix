/**
 * Runtime-probe marks (desktop/probe). The probe recorder defines globalThis.__sqProbeMark in the editor document only while a capture runs;
 * every pm() call site is a one-liner and a strict no-op otherwise: nothing is evaluated, a failing hook never changes what the app does.
 * Pass a function for any data that costs more than reading a field, so the cost is paid only while a capture runs.
 * The mark names are a contract with desktop/probe/analyze.mjs, metrics.mjs and v2probe.mjs (desktop/test/probe-harness.test.mjs checks that every one still has a call site).
 */
type Mark = (what: string, data?: Record<string, unknown>) => void;
type MarkData = Record<string, unknown> | (() => Record<string, unknown>);

export const pm = (k: string, d?: MarkData): void => {
  const mark = (globalThis as unknown as { __sqProbeMark?: Mark }).__sqProbeMark;
  if (!mark) return;
  try { mark(k, typeof d === 'function' ? d() : d); } catch { /* a probe never changes the app */ }
};

/** Caller frames of localFetch for the `lf` mark, only when the recorder asked for stacks (probe cfg.stacks). */
export const probeStack = (): string[] | undefined => {
  if (!(globalThis as unknown as { __sqProbeStacks?: boolean }).__sqProbeStacks) return undefined;
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 16;
  const stack = new Error().stack ?? '';
  Error.stackTraceLimit = limit;
  // lines: Error, probeStack, the lazy data function, pm, localFetch, then its callers
  return stack.split('\n').slice(5, 13).map(l => l.trim().replace(/https?:\/\/[^/]*\/(src\/)?/g, '').replace(/\?t=\d+/, '').slice(0, 100));
};

type YChangeLike = { action: string; oldValue?: unknown };
type YEventLike = { path: ReadonlyArray<string | number>; target: { get(key: string): unknown }; changes: { keys: Map<string, YChangeLike> } };
const clip = (v: unknown): string | undefined => (typeof v === 'string' ? v.slice(-60) : undefined);
const classesOf = (entry: unknown): string | undefined => clip((entry as { get?(key: string): unknown } | undefined)?.get?.('classes'));

/** The `v2:write` mark: what one Y transaction did to `sourceClasses` (the V2 writer probe). Per entry event the old and new class value (entry-level) or an entry
 *  added to / removed from the map, plus the transaction origin cut to its type and operation tail. Structural types only: this leaf imports no yjs. Evaluate it
 *  inside pm's lazy data: `pm('v2:write', () => probeClassWrites(events, transaction))`. */
export const probeClassWrites = (events: readonly YEventLike[] | undefined, transaction?: { origin?: unknown; local?: boolean }) => {
  const origin = String(transaction?.origin);
  const w: Array<{ key: string; act: string; old?: string; now?: string }> = [];
  for (const ev of events ?? []) {
    if (ev.path.length === 0) {
      for (const [key, change] of ev.changes.keys) w.push({ key, act: `entry-${change.action}`, ...(change.action === 'delete' ? {} : { now: classesOf(ev.target.get(key)) }) });
    } else if (ev.path.length === 1) {
      const change = ev.changes.keys.get('classes');
      w.push({ key: String(ev.path[0]), act: change?.action ?? 'other', ...(change ? { old: clip(change.oldValue) } : {}), now: classesOf(ev.target) });
    }
  }
  return { origin: origin.length > 30 ? `${origin.slice(0, 24)}…${origin.slice(-6)}` : origin, local: transaction?.local, w };
};
