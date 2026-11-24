import * as Y from 'yjs';
import { db } from '@/db';
import { acceptStoredEdit, closeLaneReadScope, getDurableProjectState, openLaneReadScope } from './store';
import { isLayoutNeutral } from './layoutNeutral';
import { getDurableEditStatus, publishDurableEditStatus } from './status';
import type { AcceptedEdit, MaterializationCommand } from './types';
import { noteLocalAcceptedSourceRevision } from '@/utils/localPageSync';
import { prepareClassIdentities } from './prepareClassIdentity';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { isLocalProjectId } from '@/utils/localMode';
import { selectVariableCollections } from '@/store/variableSelectors';
import { generateCollectionsCSS } from '@/core/variables/cssGenerator';
import { prepareFeatureProjections } from './featureAcceptance';
import { validateFeatureCommand } from './commandReceipts';
import { pm } from '@/utils/probeMark';
import { noteIntentAccepted, registerIntentOp, releaseIntentOp, reserveIntentSeq } from '@/services/classIntents';

export interface AcceptProjectEditInput {
  operationId: string;
  projectId: string;
  mutate(staged: Y.Doc): void;
  commands: MaterializationCommand[];
  /** Read-only preparation runs in this same lane, after earlier acceptance.
   * May materialize through precedingRevision; must not await this lane's tail. */
  prepare?(precedingRevision: number): Promise<void>;
  /** A system edit (e.g. a fresh doc's default seed), not a user gesture:
   * leaving the project never waits for it. */
  background?: boolean;
  /** Keys whose edit produced a source write (a class-write or a prop-override file-batch). The canvas holds
   * their value until the file carries it (services/classIntents.ts). Filled by the writer's prepare/mutate;
   * a writer that reports nothing holds nothing. */
  holdKeys?: Set<string>;
  /** The call-order number of this edit; default: reserved here, synchronously at call time. */
  intentSeq?: { epoch: string; seq: number };
  /** A newer call with the same key marks an UN-STARTED older slot of that key as skipped: when its turn comes it
   * stages nothing, takes no snapshot, writes no row and resolves with its predecessor's result (the newer edit
   * carries the final value). The in-flight slot is never cancelled and every other key keeps FIFO order. */
  supersedeKey?: string;
}

// This is the sole staging/acceptance queue. Dispatch adapters must use it too.
const projectTails = new Map<string, Promise<AcceptedEdit & { acceptedRevision: number }>>();
/** The latest USER edit per project — what navigation joins. The lane tail also
 * carries background seeds and read-only inspections, which can wait on the
 * preview booting; joining those froze "Back to projects" during boot. */
const userTails = new Map<string, Promise<unknown>>();
/** The newest slot per supersede key, while it has not started. */
const supersedable = new Map<string, { started: boolean; skipped: boolean }>();

export function acceptProjectEdit(doc: Y.Doc, input: AcceptProjectEditInput): Promise<AcceptedEdit> {
  const { projectId, operationId } = input;
  pm('acc:enter', () => ({ op: operationId.slice(-6) }));
  // FIFO call order = lane order = intent order: the canvas bridge applies only the newest seq per key.
  registerIntentOp(projectId, operationId, input.intentSeq ?? reserveIntentSeq());
  const previous = projectTails.get(projectId) ?? Promise.resolve();
  const slot = input.supersedeKey ? { started: false, skipped: false } : null;
  const slotId = input.supersedeKey ? `${projectId}\u0000${input.supersedeKey}` : '';
  if (slot) {
    const older = supersedable.get(slotId);
    if (older && !older.started) older.skipped = true;
    supersedable.set(slotId, slot);
  }
  const accepted = previous.catch(() => undefined).then(async (predecessor) => {
    if (slot) {
      slot.started = true;
      if (slot.skipped) {
        // Resolve with the PREDECESSOR's result, never acceptedRevision 0: a barrier waiting on this tail must
        // not stop waiting for the rows before it. No status, no staging, no snapshot, no row.
        const base = (predecessor as { acceptedRevision?: number } | undefined)?.acceptedRevision ?? (await getDurableProjectState(projectId)).acceptedRevision;
        return { operationId, revision: base, acceptedRevision: base };
      }
    }
    pm('acc:lane', () => ({ op: operationId.slice(-6) }));
    let staged: Y.Doc | undefined;
    let update: Uint8Array;
    let result: AcceptedEdit;
    publishDurableEditStatus(projectId, {
      ...getDurableEditStatus(projectId), phase: 'accepting', operationId,
    });
    try {
      // A retry must never stage fresh bytes under an already accepted ID.
      const checkpoint = await db.durableEditCheckpoints.get(`${projectId}:${operationId}`);
      pm('acc:checkpoint');
      if (checkpoint) {
        const state = await getDurableProjectState(projectId);
        publishDurableEditStatus(projectId, { phase: 'accepted', operationId, acceptedRevision: state.acceptedRevision });
        return { operationId, revision: checkpoint.revision, acceptedRevision: state.acceptedRevision };
      }

      // One journal read per slot: every reader of the accepted rows shares it until the scope closes
      // (before acceptStoredEdit appends this slot's own row).
      openLaneReadScope(projectId);
      if (input.prepare) await input.prepare((await getDurableProjectState(projectId)).acceptedRevision);
      pm('acc:prepared');
      staged = new Y.Doc({ gc: doc.gc });
      Y.applyUpdate(staged, Y.encodeStateAsUpdate(doc));
      const before = Y.encodeStateVector(staged);
      staged.transact(() => input.mutate(staged!));
      update = Y.encodeStateAsUpdate(staged, before);
      pm('acc:staged', () => ({ bytes: update.length }));
      const variablesCss = isLocalProjectId(projectId) && JSON.stringify(selectVariableCollections(doc)) !== JSON.stringify(selectVariableCollections(staged))
        ? generateCollectionsCSS(selectVariableCollections(staged)) : undefined;
      await prepareFeatureProjections(projectId, (await getDurableProjectState(projectId)).acceptedRevision, input.commands, variablesCss);
      pm('acc:features');
      for (const command of input.commands) validateFeatureCommand(projectId, command);
      if (input.commands.some(command => command.kind === 'class-write' || command.kind === 'source-batch')) {
        await prepareClassIdentities(projectId, (await getDurableProjectState(projectId)).acceptedRevision, input.commands);
      }
      if (input.commands.some(command => command.kind === 'class-write' || command.kind === 'source-batch'
        || command.kind === 'layout-append' || command.kind === 'variables-css' || command.kind === 'post-write' || command.kind === 'folder-manifest'
        || (command.kind === 'file-batch' && isLocalProjectId(projectId)))) {
        const active = getActiveSaveProjectId();
        if (active !== null && active !== projectId) throw new Error('Another project is active');
      }
      pm('acc:identities');
      closeLaneReadScope(projectId);
      result = await acceptStoredEdit({
        operationId, projectId, yjsUpdate: update,
        commands: input.commands, acceptedAt: Date.now(),
      });
      pm('acc:stored');
    } catch (error) {
      publishDurableEditStatus(projectId, { ...getDurableEditStatus(projectId), phase: 'rejected', operationId });
      throw error;
    } finally {
      closeLaneReadScope(projectId);
      try { staged?.destroy(); }
      catch (error) { console.error('[durable edit] Staging cleanup failed', { projectId, operationId }, error); }
    }

    // The journal has committed. Observer faults cannot undo acceptance or
    // turn already-published live state into a supposedly rejected edit.
    // The doc observer runs synchronously inside this apply and reads its op's revision and held keys.
    noteIntentAccepted(projectId, operationId, result.revision, input.holdKeys);
    try { Y.applyUpdate(doc, update, `durable-edit:${operationId}`); }
    catch (error) { console.error('[durable edit] Live publication failed after commit', { projectId, operationId }, error); }
    pm('acc:published');
    noteLocalAcceptedSourceRevision(projectId, result.revision, input.commands);
    publishDurableEditStatus(projectId, { phase: 'accepted', operationId, acceptedRevision: result.revision, layoutNeutral: isLayoutNeutral(input.commands) });
    return { ...result, acceptedRevision: result.revision };
  });
  projectTails.set(projectId, accepted);
  if (!input.background) userTails.set(projectId, accepted);
  const clear = () => {
    releaseIntentOp(projectId, operationId);
    if (slot && supersedable.get(slotId) === slot) supersedable.delete(slotId);
    if (projectTails.get(projectId) === accepted) projectTails.delete(projectId);
    if (userTails.get(projectId) === accepted) userTails.delete(projectId);
  };
  void accepted.then(clear, clear);
  return accepted.then(({ operationId: id, revision }) => ({ operationId: id, revision }));
}

/** A user edit is still being accepted (navigation must join it). */
export function hasPendingUserAcceptance(projectId: string): boolean { return userTails.has(projectId); }

/** Settles when the latest USER edit has settled (accepted or rejected). */
export async function awaitUserAccepted(projectId: string): Promise<void> {
  await userTails.get(projectId)?.catch(() => {});
}

/** Capture the current acceptance boundary; later edits do not extend it. */
/** Input an editor is still coalescing (post typing). Every acceptance
 * barrier pushes it first, so a barrier never misses held text. */
interface HeldInput { push: () => void; user: boolean }
const heldInputs = new Map<string, Set<HeldInput>>();
/** `user: true` = text the USER is typing (a number inside its settle window): barriers raised by the user's own actions push it,
 * barriers raised by an AGENT do not (they must never commit a partial value). Post typing stays unscoped: agents read it. */
export function holdProjectInput(projectId: string, push: () => void, options?: { user?: boolean }): () => void {
  let set = heldInputs.get(projectId);
  if (!set) heldInputs.set(projectId, set = new Set());
  const held: HeldInput = { push, user: !!options?.user };
  set.add(held);
  return () => { set.delete(held); if (!set.size && heldInputs.get(projectId) === set) heldInputs.delete(projectId); };
}

/** A barrier the user raised (a quit) pushes every held input, post typing too (#22) — only an agent's skips the user-scoped
 * ones. Fire-and-forget, never waits on the lane. */
export function pushUserHeldInput(projectId: string): void {
  for (const held of [...heldInputs.get(projectId) ?? []]) held.push();
}

export async function awaitAccepted(projectId: string, options?: { agent?: boolean }): Promise<number> {
  for (const held of [...heldInputs.get(projectId) ?? []]) if (!(options?.agent && held.user)) held.push();
  const tail = projectTails.get(projectId);
  if (tail) return (await tail).acceptedRevision;
  return (await getDurableProjectState(projectId)).acceptedRevision;
}

/** Read-only source inspection shares the acceptance lane, so its projection
 * cannot race a new gesture or await an earlier source acknowledgement. */
export function inspectAcceptedProject<T>(projectId: string, read: (revision: number) => Promise<T>): Promise<T> {
  const previous = projectTails.get(projectId) ?? Promise.resolve();
  let value: T;
  const pending = previous.catch(() => {}).then(async () => {
    const { acceptedRevision } = await getDurableProjectState(projectId);
    openLaneReadScope(projectId);
    try { value = await read(acceptedRevision); } finally { closeLaneReadScope(projectId); }
    return { operationId: 'source-inspection', revision: acceptedRevision, acceptedRevision };
  });
  projectTails.set(projectId, pending);
  const clear = () => { if (projectTails.get(projectId) === pending) projectTails.delete(projectId); };
  void pending.then(clear, clear);
  return pending.then(() => value);
}

/** Verify real writes in every durable table before editing controls mount. */
export async function probeDurableEditStorage(): Promise<void> {
  const projectId = `durable-probe:${crypto.randomUUID()}`;
  const operationId = 'probe';
  const id = `${projectId}:${operationId}`;
  await db.transaction('rw', [db.durableEdits, db.durableProjectState, db.durableEditCheckpoints, db.durableCommandReceipts], async () => {
    await db.durableProjectState.add({ projectId, acceptedRevision: 1, materializedRevision: 0 });
    await db.durableEditCheckpoints.add({ id, projectId, operationId, revision: 1 });
    await db.durableEdits.add({
      id, projectId, operationId, revision: 1, yjsUpdate: new Uint8Array([0, 0]),
      commands: [], acceptedAt: Date.now(), materializedAt: null,
    });
    await db.durableCommandReceipts.add({ projectId, commandId: operationId, outcome: null, prepared: {
      projectId, commandId: operationId, commandDigest: 'probe', file: 'src/probe',
      beforeSource: '', afterSource: '', beforeHash: '', afterHash: '', skipped: [],
    } });
    if ((await db.durableProjectState.get(projectId))?.acceptedRevision !== 1
      || (await db.durableEditCheckpoints.get(id))?.revision !== 1
      || (await db.durableEdits.get(id))?.revision !== 1
      || (await db.durableCommandReceipts.get([projectId, operationId]))?.prepared.commandDigest !== 'probe') {
      throw new Error('Durable storage probe could not verify its writes');
    }
    await db.durableEdits.delete(id);
    await db.durableEditCheckpoints.delete(id);
    await db.durableProjectState.delete(projectId);
    await db.durableCommandReceipts.delete([projectId, operationId]);
  });
}
