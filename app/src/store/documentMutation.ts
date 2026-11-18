import type * as Y from 'yjs';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import type { AcceptedEdit, MaterializationCommand, DurableFileChange, DurableReceiptReplay } from '@/services/durableEdits/types';

export interface MutationSnapshot {
  stage(doc: Y.Doc): void; commit(): void;
  attachFiles?(files: DurableFileChange[]): void;
  attachSourceReceipts?(replay: DurableReceiptReplay): void;
}

export function attachCommandReceipts(snapshot: MutationSnapshot | undefined, accepted: AcceptedEdit, commands: MaterializationCommand[]): void {
  const commandIds = commands.flatMap((command, index) => command.kind === 'source-batch' || command.kind === 'layout-append'
    ? [JSON.stringify([accepted.operationId, index])] : []);
  try { if (commandIds.length) snapshot?.attachSourceReceipts?.({ commandIds, direction: 'before' }); }
  catch (error) { console.error('Source inverse observer failed after durable acceptance', error); }
}

export function commitMutationSnapshot(snapshot?: MutationSnapshot): void {
  try { snapshot?.commit(); }
  catch (error) { console.error('Snapshot observer failed after durable acceptance', error); }
}

/** Own one complete document gesture in the existing acceptance lane.
 * Callers capture IDs/payloads before calling; mutate only receives staging. */
export async function acceptDocumentMutation(
  doc: Y.Doc,
  mutate: (staged: Y.Doc) => void,
  snapshot?: MutationSnapshot,
  commands: MaterializationCommand[] = [],
): Promise<AcceptedEdit> {
  const projectId = doc.getMap('meta').get('projectId');
  if (typeof projectId !== 'string' || !projectId) throw new Error('Project storage is not ready');
  const accepted = await acceptProjectEdit(doc, {
    projectId, operationId: crypto.randomUUID(), commands: structuredClone(commands),
    mutate: staged => { snapshot?.stage(staged); mutate(staged); },
  });
  attachCommandReceipts(snapshot, accepted, commands);
  commitMutationSnapshot(snapshot);
  return accepted;
}
