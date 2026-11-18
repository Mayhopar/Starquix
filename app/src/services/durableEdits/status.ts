export interface DurableEditStatus {
  phase: 'idle' | 'accepting' | 'accepted' | 'rejected';
  operationId: string | null;
  acceptedRevision: number;
  /** Set on 'accepted': the edit cannot have changed the layout library or the folder manifest
   * (services/durableEdits/layoutNeutral.ts), so their accepted-revision refresh is skipped. */
  layoutNeutral?: boolean;
}

const idle: DurableEditStatus = Object.freeze({ phase: 'idle', operationId: null, acceptedRevision: 0 });
const statuses = new Map<string, DurableEditStatus>();
const listeners = new Set<() => void>();

export function getDurableEditStatus(projectId: string): DurableEditStatus {
  return statuses.get(projectId) ?? idle;
}

export function subscribeDurableEditStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishDurableEditStatus(projectId: string, status: DurableEditStatus): void {
  statuses.set(projectId, Object.freeze(status));
  for (const listener of listeners) {
    // A UI subscriber cannot turn a durable commit into a rejected edit.
    try { listener(); } catch (error) { console.error('[durable edit status]', error); }
  }
}
