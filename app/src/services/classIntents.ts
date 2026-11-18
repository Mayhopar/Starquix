/**
 * Class intents (instant-edit P0b) — the parent's half of the canvas "hold".
 *
 * Every durable class write is an INTENT: a call-order number (seq) assigned when it enters the acceptance
 * lane, plus which keys it writes to a source file (holdKeys). The canvas bridge applies only the newest seq
 * per key, drops intent-less writes to a held key (the parent's replay paths), refuses the morph's class
 * patches for a held element while the file still carries an older value, and releases the hold only when the
 * row that wrote the value is materialized AND a refresh from the file shows it. This module keeps the
 * parent's bookkeeping: seq reservation, the op registry the observer reads, and the per-key entries the
 * settle effect turns into CLASS_INTENT_SETTLED messages.
 *
 * Pure TypeScript on purpose: no yjs, no db (lint-durable-mutations: this is not a document mutation site).
 * Every registry is keyed by projectId and cleared when the ClassStore provider tears down, like the
 * class-write baselines: element keys are project-relative and scaffold copies share them.
 */

import type { ClassIntentSettledPayload } from '@/bridge/types';

/** What the bridge announces in IFRAME_READY.classIntentV: 1 = understands class intents. */
export const CLASS_INTENT_VERSION = 1;

// A random id per module evaluation: a dev HMR re-evaluation restarts the counter, and a bridge whose
// high-water mark came from the old module must not drop the new numbers.
const EPOCH = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;

export function reserveIntentSeq(): { epoch: string; seq: number } {
  return { epoch: EPOCH, seq: ++counter };
}

interface Op { seq: { epoch: string; seq: number }; holdKeys: ReadonlySet<string> | null; rev: number | null; painted: Set<string> }
const ops = new Map<string, Map<string, Op>>();

/** Idempotent: a writer that paints before it calls acceptProjectEdit registers first; the lane's call keeps that record. */
export function registerIntentOp(projectId: string, operationId: string, seq: { epoch: string; seq: number }): void {
  let map = ops.get(projectId);
  if (!map) ops.set(projectId, map = new Map());
  if (!map.has(operationId)) map.set(operationId, { seq, holdKeys: null, rev: null, painted: new Set() });
}

/** The writer painted this key on the canvas at call time (before acceptance): the observer only binds the revision. */
export function notePaintedKey(projectId: string, operationId: string, key: string): void {
  ops.get(projectId)?.get(operationId)?.painted.add(key);
}

/** Called by the lane just before the accepted update is applied to the live doc, so the doc observer
 * (which runs synchronously inside that apply) reads the revision and the held keys of its own op. */
export function noteIntentAccepted(projectId: string, operationId: string, rev: number, holdKeys: ReadonlySet<string> | undefined): void {
  const op = ops.get(projectId)?.get(operationId);
  if (op) { op.rev = rev; op.holdKeys = holdKeys ?? null; }
}

export function releaseIntentOp(projectId: string, operationId: string): void {
  const map = ops.get(projectId);
  if (!map) return;
  map.delete(operationId);
  if (!map.size) ops.delete(projectId);
}

/** The op an observed durable transaction came from, or undefined (a sync/user transaction, an old op). */
export function intentOfOrigin(projectId: string | null | undefined, origin: unknown): { op: string; epoch: string; seq: number; rev: number | null; holdKeys: ReadonlySet<string> | null; painted: ReadonlySet<string> } | undefined {
  if (!projectId || typeof origin !== 'string' || !origin.startsWith('durable-edit:')) return undefined;
  const op = origin.slice('durable-edit:'.length);
  const found = ops.get(projectId)?.get(op);
  return found ? { op, epoch: found.seq.epoch, seq: found.seq.seq, rev: found.rev, holdKeys: found.holdKeys, painted: found.painted } : undefined;
}

// ── Per-key entries: what the canvas has been told to hold, until the file carries it ─────────────────────
export interface IntentEntry {
  key: string; epoch: string; seq: number;
  /** The value to re-post to a new document; null for a restore (the file is the truth there). */
  classes: string | null; sourceLocation?: unknown;
  /** The accepted revision whose materialization carries this value; Infinity = painted, not accepted yet. */
  rev: number;
  settledAt?: number;
  /** The accepted-but-unlanded entry this paint replaced: a rejected paint reinstates it. */
  previous?: IntentEntry;
}
const entries = new Map<string, Map<string, IntentEntry>>();
const SETTLED_KEEP_MS = 30_000;

/** The newest intent per key wins; a write that holds nothing drops the key's entry. */
export function noteClassIntent(projectId: string, entry: IntentEntry, hold: boolean): void {
  let map = entries.get(projectId);
  if (!hold) { map?.delete(entry.key); return; }
  if (!map) entries.set(projectId, map = new Map());
  const known = map.get(entry.key);
  if (known && known.epoch === entry.epoch && known.seq > entry.seq) return;
  // Binding the revision of an already painted entry keeps what it replaced; a NEW paint keeps the accepted one under it.
  // One level deep: only a rejected paint's direct predecessor is ever reinstated.
  if (known && known.seq !== entry.seq && Number.isFinite(known.rev)) entry = { ...entry, previous: { ...known, previous: undefined } };
  else if (known && known.seq === entry.seq) entry = { ...entry, previous: known.previous };
  map.set(entry.key, entry);
}

/** The painted write was rejected. `current` = it is still the newest intent of the key (nothing newer was painted
 * since, so the canvas must go back); `previous` = an accepted write that has not landed yet, which holds again. */
export function dropClassIntent(projectId: string, key: string, seq: number): { current: boolean; previous?: IntentEntry } {
  const map = entries.get(projectId);
  const known = map?.get(key);
  if (!map || !known || known.seq !== seq) return { current: false };
  map.delete(key);
  if (!map.size) entries.delete(projectId);
  return { current: true, previous: known.previous };
}

/** Entries whose row is materialized (`rev <= materializedRevision`). Stays readable for every frame for
 * SETTLED_KEEP_MS, so each of the six canvases can post it once; then it is dropped. */
export function settledIntents(projectId: string, materializedRevision: number, now: number): IntentEntry[] {
  const map = entries.get(projectId);
  if (!map) return [];
  const settled: IntentEntry[] = [];
  for (const [key, entry] of map) {
    if (entry.rev > materializedRevision) continue;
    entry.settledAt ??= now;
    if (now - entry.settledAt > SETTLED_KEEP_MS) { map.delete(key); continue; }
    settled.push(entry);
  }
  if (!map.size) entries.delete(projectId);
  return settled;
}

/** What one canvas should be told now: the entries whose row landed that it has not been told yet (a key+seq once) and,
 * at most every 10 s, the unlanded ones as `alive` (the bridge's backstop never fires on a long backlog). null = nothing. */
export function planSettleMessage(projectId: string, materializedRevision: number, now: number,
  state: { posted: Map<string, number>; lastAlive: number }): Required<ClassIntentSettledPayload> | null {
  const settled = settledIntents(projectId, materializedRevision, now).filter(entry => state.posted.get(entry.key) !== entry.seq).map(({ key, seq, epoch }) => ({ key, seq, epoch }));
  const alive = now - state.lastAlive >= 10_000 ? unlandedIntents(projectId, materializedRevision).map(({ key, seq, epoch }) => ({ key, seq, epoch })) : [];
  if (!settled.length && !alive.length) return null;
  for (const item of settled) state.posted.set(item.key, item.seq);
  if (alive.length) state.lastAlive = now;
  return { settled, alive };
}

/** Entries still waiting for their row (the bridge keeps them held; `alive` tells it the parent is there). */
export function unlandedIntents(projectId: string, materializedRevision: number): IntentEntry[] {
  return [...(entries.get(projectId)?.values() ?? [])].filter(entry => entry.rev > materializedRevision);
}

/** Provider teardown / project switch: nothing of project A may outlive it and paint onto B's same-keyed element. */
export function clearIntentProject(projectId: string): void {
  ops.delete(projectId);
  entries.delete(projectId);
}

// ── Per-document capability: which frames understand intents ───────────────────────────────────────────────
const frameVersion = new WeakMap<object, number>();
export function setFrameIntentVersion(frame: object | null | undefined, version: unknown): void {
  if (frame) frameVersion.set(frame, typeof version === 'number' ? version : 0);
}
/** The parent attaches intents only to a document that announced them: an older `.sq/` bridge would apply the
 * paint and then the lane-lagged value with no seq gate. */
export function frameUnderstandsIntents(frame: object | null | undefined): boolean {
  return !!frame && (frameVersion.get(frame) ?? 0) >= CLASS_INTENT_VERSION;
}

export function _resetClassIntentsForTests(): void { ops.clear(); entries.clear(); counter = 0; }
