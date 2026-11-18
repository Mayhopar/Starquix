import { awaitAccepted } from './acceptance';
import { prepareSourceCommand, reconcileSourceCommand, dispatchSourceCommand, rebaseSourceCommand, SourcePreparationRefused } from './commandReceipts';
import { getDurableProjectState, listUnmaterialized } from './store';
import { registerMaterializer, materializerRegistry, type MaterializerAdapter, type MaterializerContext } from './registry';
import { MaterializationFailure, materializeThrough, requestMaterialization, retryMaterialization, startMaterializer } from './materializer';
import { notifyFileWritten, setClassWriteBaseline } from '@/services/classWriteBaseline';
import { syncChangedFiles } from '@/services/filesTruthSync';
import type { MaterializationCommand, SourceCommandOutcome } from './types';
import { pm } from '@/utils/probeMark';

type SourceCommand = Extract<MaterializationCommand, { kind: 'class-write' | 'source-batch' | 'structural-write' | 'file-batch' | 'layout-append' | 'receipt-replay' | 'variables-css' | 'post-write' | 'folder-manifest' }>;
// These hold scheduling signals only. Restart discovers every pending command and
// its deadline from IndexedDB; no retry, payload, partial result or receipt lives here.
const expedited = new Map<string, number>();
const wakeups = new Map<string, Set<() => void>>();

async function waitForIdle(command: SourceCommand, context: MaterializerContext): Promise<void> {
  if (command.kind !== 'class-write' && command.kind !== 'source-batch' && command.kind !== 'layout-append') return;
  if (!command.payload.deferUntil) return;
  pm('mat:idle-wait', () => ({ rev: context.revision, deferIn: command.payload.deferUntil! - Date.now(), expedited: (expedited.get(context.projectId) ?? 0) >= context.revision }));
  while ((expedited.get(context.projectId) ?? 0) < context.revision) {
    const rows = await listUnmaterialized(context.projectId, context.revision - 1);
    const deadline = rows.flatMap(row => row.commands).reduce((latest, candidate) =>
      candidate.kind === 'class-write' || candidate.kind === 'source-batch' || candidate.kind === 'layout-append'
        ? Math.max(latest, candidate.payload.deferUntil ?? 0) : latest, command.payload.deferUntil);
    if (deadline <= Date.now() || (expedited.get(context.projectId) ?? 0) >= context.revision) return;
    await new Promise<void>(resolve => {
      const listeners = wakeups.get(context.projectId) ?? new Set();
      wakeups.set(context.projectId, listeners);
      const finish = () => { clearTimeout(timer); listeners.delete(finish); resolve(); };
      const timer = setTimeout(finish, deadline - Date.now());
      listeners.add(finish);
    });
  }
}

export class PartialSourceMaterialization extends MaterializationFailure {
  constructor(readonly projectId: string, readonly commandId: string, readonly skipped: Extract<SourceCommandOutcome, {status: 'partial'}>['skipped']) {
    super('deterministic', 'Some changes could not be written to source. The original command and skipped selectors remain durable.');
  }
}

function result(outcome: SourceCommandOutcome, context: MaterializerContext, commandId: string) {
  if (outcome.status === 'partial') return { status: 'partial' as const,
    error: new PartialSourceMaterialization(context.projectId, commandId, outcome.skipped) };
  return outcome;
}

function publishClass(command: SourceCommand) {
  if (command.kind !== 'class-write') return;
  const { sourceLocation: loc, newClasses } = command.payload;
  const key = `${loc.file}:${loc.line}:${loc.column}`;
  try { setClassWriteBaseline(key, newClasses); notifyFileWritten(key, newClasses); }
  catch (error) { console.error('[class receipt observer]', error); }
}

/** A refusal is deterministic (only the user's Discard moves past it); anything else is transport. */
const refusal = (error: unknown, otherwise: 'transient' | null) => error instanceof SourcePreparationRefused
  ? new MaterializationFailure('deterministic', error.message, error.file)
  : otherwise ? new MaterializationFailure(otherwise, error instanceof Error ? error.message : String(error)) : error;

const adapter: MaterializerAdapter<SourceCommand> = {
  async reconcile(command, commandId, context) {
    await waitForIdle(command, context);
    pm('mat:idle-done', { rev: context.revision });
    // No source request was sent when preparation fails: the durable row is
    // retained, and a subsequent pass can retry preparation without replaying.
    try { await prepareSourceCommand(context.projectId, commandId, command); }
    catch (error) { throw refusal(error, 'transient'); }
    let outcome = result(await reconcileSourceCommand(context.projectId, commandId), context, commandId);
    // The file moved between preparation and the write (an agent wrote it):
    // the edit re-applies onto the bytes on disk, newest wins (ledger B).
    if (outcome.status === 'unknown') {
      const moved = await rebaseSourceCommand(context.projectId, commandId)
        .catch(error => { throw refusal(error, null); });
      if (moved === 'rebased') outcome = result(await reconcileSourceCommand(context.projectId, commandId), context, commandId);
    }
    if (outcome.status === 'written') publishClass(command);
    return outcome;
  },
  async dispatch(command, commandId, context) {
    const outcome = result(await dispatchSourceCommand(context.projectId, commandId), context, commandId);
    if (outcome.status === 'partial') throw outcome.error;
    if (outcome.status !== 'written') throw new MaterializationFailure(outcome.status === 'not-written' ? 'transient' : 'unknown',
      outcome.status === 'unknown' ? outcome.error : 'Prepared source has not been written');
    publishClass(command);
    return outcome.receipt;
  },
};

export function registerSourceMaterializers(): void {
  if (materializerRegistry.get('class-write') !== adapter) registerMaterializer('class-write', adapter);
  if (materializerRegistry.get('source-batch') !== adapter) registerMaterializer('source-batch', adapter);
  if (materializerRegistry.get('structural-write') !== adapter) registerMaterializer('structural-write', adapter);
  if (materializerRegistry.get('file-batch') !== adapter) registerMaterializer('file-batch', adapter);
  if (materializerRegistry.get('layout-append') !== adapter) registerMaterializer('layout-append', adapter);
  if (materializerRegistry.get('receipt-replay') !== adapter) registerMaterializer('receipt-replay', adapter);
  if (materializerRegistry.get('variables-css') !== adapter) registerMaterializer('variables-css', adapter);
  if (materializerRegistry.get('post-write') !== adapter) registerMaterializer('post-write', adapter);
  if (materializerRegistry.get('folder-manifest') !== adapter) registerMaterializer('folder-manifest', adapter);
}

export async function flushDurableSourceWrites(projectId: string, options?: { agent?: boolean }): Promise<void> {
  const revision = await awaitAccepted(projectId, options);
  retryMaterialization(projectId);
  await flushDurableSourceWritesThrough(projectId, revision);
}

/** Complete one accepted gesture without joining a later acceptance tail. */
export async function flushDurableSourceWritesThrough(projectId: string, revision: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason;
  expedited.set(projectId, Math.max(expedited.get(projectId) ?? 0, revision));
  for (const wake of wakeups.get(projectId) ?? []) wake();
  registerSourceMaterializers(); requestMaterialization(projectId);
  const stop = startMaterializer(projectId);
  try { await materializeThrough(projectId, revision, signal); } finally { stop(); }
}

/** Starquix's own direct file writes (font link, image rebind, component file
 * ops) bypass the journal. Land accepted edits first, or a deferred class/text
 * write meets bytes it was not prepared on (audit 2026-10-18). Committed edits
 * only — joining the acceptance lane would wait on in-flight reads (a booting
 * preview); a gesture still accepting re-applies itself if this write moves its
 * file. A retained issue keeps its own recovery: the direct write proceeds. */
export async function settleSourceWrites(projectId: string | null): Promise<void> {
  if (!projectId) return;
  try { await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision); }
  catch { /* the direct write still proceeds */ }
}

/** Every accepted edit on disk and the instance journal mirrored into the rows. */
export async function awaitJournaledFiles(projectId: string, options?: { agent?: boolean }): Promise<void> {
  await flushDurableSourceWrites(projectId, options);
  await syncChangedFiles();
}

/** Export/deploy read the project rows: awaitJournaledFiles, then re-read the
 * disk — a write the journal never reported (an Astro restart's lost tail, an
 * outside editor) must still ship. ponytail: a full-folder read; hot paths
 * (MCP's per-call flush) use awaitJournaledFiles. */
export async function awaitProjectFiles(projectId: string, options?: { agent?: boolean }): Promise<void> {
  await awaitJournaledFiles(projectId, options);
  const { isDesktop, desktopDriver } = await import('@/services/desktopDriver');
  if (isDesktop()) await desktopDriver.remirror(projectId);
}
