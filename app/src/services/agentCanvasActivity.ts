/**
 * Agent edits on the canvas (docs/plans/2026-11-10-agent-canvas-flash-design.md).
 * The bridge reports what each source refresh changed (SOURCE_CHANGED keys);
 * this decides whether the AGENT made it: an agent write — an outside file
 * write (terminal agent, other app) or a mutating MCP call — in the last
 * AGENT_ACTIVE_MS, or one landing within AGENT_REPORT_HOLD_MS after the report
 * (the watcher and the refresh race; log-proven both ways ~0.3–0.5 s).
 * The agent's keys feed the chat's existing effect (ring + dissolve + Layers
 * touched) and clear AGENT_ACTIVE_MS after the last agent write — the same
 * clock as the terminal bar's "Agent · file" light.
 */
import { useSyncExternalStore } from 'react';
import { AGENT_ACTIVE_MS } from './agentPresence';

export const AGENT_REPORT_HOLD_MS = 1500;

let projectId: string | null = null;
let lastWrite = 0;
let keys: string[] = [];
let held: { keys: string[]; until: number }[] = [];
let expiry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const addedListeners = new Set<(projectId: string, keys: string[]) => void>();

function switchTo(id: string): void {
  if (projectId === id) return;
  projectId = id; lastWrite = 0; held = [];
  if (keys.length) { keys = []; notify(); }
}
function notify(): void { for (const l of listeners) l(); }
function armExpiry(): void {
  if (expiry) clearTimeout(expiry);
  expiry = setTimeout(() => { expiry = null; if (keys.length) { keys = []; notify(); } }, Math.max(0, lastWrite + AGENT_ACTIVE_MS - Date.now()));
}
function add(id: string, next: string[]): void {
  const fresh = next.filter((k, i) => !keys.includes(k) && next.indexOf(k) === i);
  if (!fresh.length) return;
  keys = [...keys, ...fresh];
  armExpiry();
  notify();
  for (const l of addedListeners) l(id, fresh);
}

/** An agent wrote in this project (outside file write or a mutating MCP call).
 *  `direct` = keys the agent named itself: an MCP edit is often already in the
 *  DOM before its file round-trips, so the refresh finds nothing (log-proven). */
export function noteAgentWrite(id: string, direct: string[] = []): void {
  switchTo(id);
  const now = Date.now();
  lastWrite = now;
  const due = held.filter(h => h.until >= now);
  held = [];
  for (const h of due) add(id, h.keys);
  add(id, direct);
  if (keys.length) armExpiry();
}

/** The bridge's SOURCE_CHANGED keys for the open project. */
export function noteSourceChanged(id: string, changed: string[]): void {
  if (!changed.length || (projectId !== null && id !== projectId)) return;
  const now = Date.now();
  if (projectId === id && now - lastWrite <= AGENT_ACTIVE_MS && lastWrite > 0) { add(id, changed); return; }
  held = [...held.filter(h => h.until >= now), { keys: changed, until: now + AGENT_REPORT_HOLD_MS }];
  if (projectId === null) projectId = id;
}

export function getAgentCanvasKeys(id: string | null): string[] { return id !== null && id === projectId ? keys : EMPTY; }
const EMPTY: string[] = [];

export function subscribeAgentCanvasKeys(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Hear each batch of NEW agent keys (Layers touched marks). */
export function onAgentKeysAdded(listener: (projectId: string, keys: string[]) => void): () => void {
  addedListeners.add(listener);
  return () => { addedListeners.delete(listener); };
}

export function useAgentCanvasKeys(id: string | null): string[] {
  return useSyncExternalStore(subscribeAgentCanvasKeys, () => getAgentCanvasKeys(id), () => getAgentCanvasKeys(id));
}

/** Tests only. */
export function resetAgentCanvasActivity(): void {
  projectId = null; lastWrite = 0; keys = []; held = [];
  if (expiry) { clearTimeout(expiry); expiry = null; }
}
