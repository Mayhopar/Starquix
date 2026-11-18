import * as Y from 'yjs';
import { localFetch } from '@/utils/sqLocalBase';
import { commitMutationSnapshot, type MutationSnapshot } from '@/store/documentMutation';
import type { AcceptedEdit, DurableFileChange, MaterializationCommand } from './types';
import { acceptProjectEdit } from './acceptance';
import { getMaterializationStatus, subscribeMaterializationStatus, retryMaterialization } from './materializer';
import { flushDurableSourceWritesThrough } from './sourceMaterialization';
import { projectedSourceFiles, readProjectedSourceState, withProjectedSource } from './projectedSource';
import { withVariablesImport } from './featureAcceptance';
import { projectIdFromPath } from '@/utils/localMode';

export interface PageFilePlan {
  files: DurableFileChange[];
  route: string;
  file: string;
  content?: string;
  oldRoute?: string;
  oldFile?: string;
  from?: string;
  to?: string;
}

export function projectIdForFolder(folder: string, doc?: Y.Doc): string {
  const id = projectIdFromPath(folder);
  const docId = doc?.getMap('meta').get('projectId');
  if (!id || (doc && docId !== id)) throw new Error('File gesture belongs to a different project');
  return id;
}

export async function preparePageFilePlan(folder: string, intent: Record<string, unknown>): Promise<PageFilePlan> {
  projectIdForFolder(folder);
  const response = await localFetch('/__sq/local/page-plan', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...intent, path: folder,
      projectedPages: Object.fromEntries(projectedSourceFiles(projectIdForFolder(folder))
        .filter(file => file.file.startsWith('src/pages/') && !file.encoding).map(file => [file.file, file.afterSource])),
    }) });
  const result = await response.json();
  if (!response.ok || !Array.isArray(result.files)) throw new Error(result.error ?? 'Page preparation failed');
  if (intent.action === 'delete-post') for (const file of result.files) {
    file.beforeSource = await readProjectedSourceState(projectIdForFolder(folder), file.file);
    result.content = file.beforeSource;
  }
  return result;
}

export interface AcceptedFileEdit extends AcceptedEdit { projectId: string; files?: DurableFileChange[] }
export type AcceptedSourceCompletion = { status: 'materialized' } | { status: 'retained'; error: unknown };

/** A source conflict cannot retroactively reject the accepted edit. Repeating
 * this call retries the same durable revision/operation, never fresh intent. */
export async function materializeAcceptedFiles(accepted: AcceptedFileEdit): Promise<AcceptedSourceCompletion> {
  let unsubscribe = () => {};
  const issue = new Promise<AcceptedSourceCompletion>(resolve => {
    unsubscribe = subscribeMaterializationStatus(() => {
      const status = getMaterializationStatus(accepted.projectId);
      if (status.issue && status.issue.revision <= accepted.revision) resolve({ status: 'retained', error: status.issue.error });
    });
  });
  try {
    return await Promise.race([issue, flushDurableSourceWritesThrough(accepted.projectId, accepted.revision)
      .then(() => ({ status: 'materialized' as const }), error => ({ status: 'retained' as const, error }))]);
  } finally { unsubscribe(); }
}

export async function finishAcceptedFiles(accepted: AcceptedFileEdit): Promise<AcceptedSourceCompletion> {
  return materializeAcceptedFiles(accepted);
}

export function retryAcceptedFiles(accepted: AcceptedFileEdit): Promise<AcceptedSourceCompletion> {
  retryMaterialization(accepted.projectId);
  return finishAcceptedFiles(accepted);
}

/** Resolves at durable acceptance. Inverse publication belongs before any
 * optional materialization wait; callers can finish/retry this exact edit. */
export async function acceptFileChanges(folder: string, input: DurableFileChange[] | (() => Promise<DurableFileChange[]>), doc?: Y.Doc,
  mutate: (staged: Y.Doc) => void = () => {}, snapshot?: MutationSnapshot,
  options: { operationId?: string; commands?: MaterializationCommand[]; background?: boolean } = {}): Promise<AcceptedFileEdit> {
  const projectId = projectIdForFolder(folder, doc);
  const frozen = typeof input === 'function' ? input : structuredClone(input);
  const target = doc ?? new Y.Doc();
  if (!doc) target.getMap('meta').set('projectId', projectId);
  try {
    const commands: MaterializationCommand[] = structuredClone(options.commands ?? []);
    const accepted = await acceptProjectEdit(target, { projectId, operationId: options.operationId ?? crypto.randomUUID(), commands, background: options.background,
      prepare: precedingRevision => withProjectedSource(projectId, precedingRevision, async () => {
        const files = await withVariablesImport(projectId, folder, structuredClone(typeof frozen === 'function' ? await frozen() : frozen));
        for (const file of files) {
          if (await readProjectedSourceState(projectId, file.file, file.encoding) !== file.beforeSource) throw new Error(`Source changed before acceptance: ${file.file}`);
        }
        if (files.length) commands.push({ kind: 'file-batch', payload: { files } });
        snapshot?.attachFiles?.(files);
      }),
      // A source-only gesture (no doc) keeps the snapshot's own document — never the empty acceptance one.
      mutate: staged => { if (doc) snapshot?.stage(staged); mutate(staged); },
    });
    const files = commands.flatMap(command => command.kind === 'file-batch' ? command.payload.files : []);
    // …and pushes no ⌘Z when it changed no file (an entry that restores nothing would lie).
    if (doc || files.length) commitMutationSnapshot(snapshot);
    return { ...accepted, projectId, files };
  } finally { if (!doc) target.destroy(); }
}
