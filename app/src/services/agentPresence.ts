/**
 * Agent multiplayer presence (owner 2026-11-08, ledger G in
 * docs/plans/2026-11-08-agent-multiplayer-design.md): is someone other than
 * the user — an agent in the terminal, an MCP call, another app — working in
 * this project right now, and on what. Every outside writer is "the agent"
 * (G8). Activity fades AGENT_ACTIVE_MS after the last sign of it.
 */
import { useSyncExternalStore } from 'react';

export interface AgentActivity { projectId: string; /** project-relative file */ file?: string; /** what it did, e.g. an MCP tool */ action?: string; at: number }

export const AGENT_ACTIVE_MS = 4000;
let current: AgentActivity | null = null;
let expiry: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function noteAgentActivity(activity: Omit<AgentActivity, 'at'>): void {
  current = { ...activity, at: Date.now() };
  if (expiry) clearTimeout(expiry);
  expiry = setTimeout(() => { current = null; expiry = null; notify(); }, AGENT_ACTIVE_MS);
  notify();
}

export function getAgentActivity(): AgentActivity | null { return current; }

export function subscribeAgentActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The agent's live activity in the open project (one is open at a time), or null. */
export function useAgentActivity(): AgentActivity | null {
  return useSyncExternalStore(subscribeAgentActivity, getAgentActivity, getAgentActivity);
}

/** Files this editor itself just wrote (journal dispatches) — their echo from
 *  the project watcher is not the agent's work (G5). */
const ownWrites = new Map<string, { content: string; at: number }[]>();
const OWN_WRITE_MS = 15_000;

export function noteOwnWrite(projectId: string, file: string, content: string | null): void {
  if (content === null) return;
  const key = `${projectId}:${file}`, now = Date.now();
  ownWrites.set(key, [...(ownWrites.get(key) ?? []).filter(entry => now - entry.at < OWN_WRITE_MS), { content, at: now }]);
}

export function isOwnWrite(projectId: string, file: string, content: string): boolean {
  const now = Date.now();
  return (ownWrites.get(`${projectId}:${file}`) ?? []).some(entry => now - entry.at < OWN_WRITE_MS && entry.content === content);
}
