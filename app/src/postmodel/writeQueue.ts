/**
 * Binding law #2: the ONLY path that writes a post body. Strict FIFO, one job
 * in flight, compile-gated, and bound to one post at construction. Only an
 * accepted rename while suspended/drained can advance its slug. Files-truth
 * disposal refuses future input but retains edits already registered for durable
 * acceptance; the legacy queue still aborts pending transport jobs on disposal.
 */
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { serializePostDoc, type PostDoc, type PostFormat } from './postModel';
import { postCompiles } from './compileGate';
import { contentOps } from '@/core/collections/content-ops';
import { PostSourceConflict, type PostUpdateOptions, type PostWriteBaseline, type PostWriteAttempt } from './frontmatterPatch';
import { isLocalProjectId } from '@/utils/localMode';
import { acceptPreparedPostWrite } from '@/services/durableEdits/featureAcceptance';
import { holdProjectInput } from '@/services/durableEdits/acceptance';
import { materializeThrough } from '@/services/durableEdits/materializer';
import { flushDurableSourceWritesThrough, registerSourceMaterializers } from '@/services/durableEdits/sourceMaterialization';

type WritePost = (
  collection: string,
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
  options?: PostUpdateOptions,
) => Promise<void>;

export type PostDraftOutcome = { status: 'accepted'; revision: number; doc: PostDoc; frontmatter: Record<string, unknown> }
  | { status: 'rejected'; revision: number };

export interface PostWriteQueueOptions {
  projectId?: string | null;
  collection: string;
  slug: string;
  /** The opened file's format; legacy callers retain the strict MDX guard. */
  format?: PostFormat;
  /** Opened post, then advanced only after acknowledged writes. */
  baseline?: PostWriteBaseline;
  /** compile failure or write failure — show the toast, keep the last-good doc */
  onRefused?: (error: string) => void;
  /** a body reached disk — refetch component previews */
  onWritten?: (body: string) => void;
  /** test seam; defaults to contentOps.updatePost */
  writePost?: WritePost;
}

/**
 * task-207 T1: queues with unflushed work, so cross-surface writers (canvas
 * saveMediaEdit) can serialize behind an in-flight flush instead of racing it.
 * A queue registers itself on enqueue and drops out when its tail drains —
 * an idle queue's tail is a resolved promise, so nothing lingers.
 */
const liveQueues = new Set<PostWriteQueue>();

/**
 * Resolves once no PostWriteQueue for {collection, slug} has unflushed work.
 * The ONE serialization point between the post editor's debounced/unmount
 * flushes and canvas writes: awaiting this before reading the post guarantees
 * the read (and the write built from it) sits AFTER every in-flight flush, so
 * a stale queue body can never clobber a newer canvas edit — and vice versa.
 * Loops because a job enqueued mid-await moves the tail; terminates as soon
 * as the matching queues drain (the canvas and the post editor are never
 * interactable at the same time, so jobs stop arriving).
 */
export async function awaitPostWritesSettled(collection: string, slug: string): Promise<void> {
  for (;;) {
    const matching = [...liveQueues].filter((q) => q.matches(collection, slug));
    if (matching.length === 0) return;
    await Promise.all(matching.map((q) => q.flushNow()));
  }
}

export async function flushPendingPostWrites(projectId: string | null = getActiveSaveProjectId()): Promise<void> {
  for (;;) {
    const matching = [...liveQueues].filter(q => q.projectId === projectId && !q.durable);
    if (!matching.length) return;
    await Promise.all(matching.map(q => q.flushNow()));
  }
}
export function hasPendingPostWrites(projectId: string | null = getActiveSaveProjectId()): boolean {
  return [...liveQueues].some(q => q.projectId === projectId && !q.durable);
}

export class PostWriteQueue {
  private tail: Promise<void> = Promise.resolve();
  private disposed = false;
  private suspended = false;
  private writeSlug: string;
  private pending = 0;
  readonly projectId: string | null;
  private error: Error | null = null;
  private compileRefused = false;
  private failedJob: { doc: PostDoc; frontmatter: Record<string, unknown>; operationId: string } | null = null;
  private lastWritten: string | null = null;
  private baseline?: PostWriteBaseline;
  private unresolvedAttempts: PostWriteAttempt[] = [];
  private lastCompiledBody: string | null = null;
  private acceptedRevision = 0;
  private lastQueuedIntent: string | null = null;
  private lastQueuedResult: Promise<void> | null = null;
  private candidateRevision = 0;
  private draftObservers = new Set<(outcome: PostDraftOutcome) => void>();
  readonly durable: boolean;
  /** Typed text the editor is still coalescing (durable posts accept per
   * typing pause). Every barrier (flushNow) pushes it first. */
  private heldInput: (() => void) | null = null;
  private releaseHold: (() => void) | null = null;

  constructor(private readonly opts: PostWriteQueueOptions) {
    this.writeSlug = opts.slug;
    this.projectId = opts.projectId ?? getActiveSaveProjectId();
    this.baseline = opts.baseline ? structuredClone(opts.baseline) : undefined;
    this.durable = !!this.projectId && isLocalProjectId(this.projectId) && !opts.writePost;
  }

  /** Non-zero while an enqueued write is unflushed. Routine saves stay quiet. */
  get size(): number {
    return this.pending;
  }

  /** Body and properties enqueue complete post candidates, so rollback must
   * share one revision even when successive inputs came from different owners. */
  get draftRevision(): number { return this.candidateRevision; }
  subscribeDraftOutcome(observer: (outcome: PostDraftOutcome) => void): () => void {
    this.draftObservers.add(observer);
    return () => { this.draftObservers.delete(observer); };
  }

  /** What the last acknowledged write left on disk. A rename checks the live
   * doc against this — typing runs ahead of the file between flushes. */
  get accepted(): PostWriteBaseline | undefined { return this.baseline && structuredClone(this.baseline); }

  /** Is this queue bound to {collection, slug}? (awaitPostWritesSettled) */
  matches(collection: string, slug: string): boolean {
    return this.opts.collection === collection && this.writeSlug === slug;
  }

  enqueue(doc: PostDoc, frontmatter: Record<string, unknown>, operationId: string = crypto.randomUUID()): Promise<void> {
    // Every owner enqueues a complete candidate built from the live editor doc,
    // so it supersedes held typing; the editor's own timer still fires (de-duped).
    this.heldInput = null; this.releaseHold?.(); this.releaseHold = null;
    // Both model and properties can change while an earlier write is in flight.
    doc = structuredClone(doc);
    frontmatter = structuredClone(frontmatter);
    if (this.durable) return this.enqueueDurable(doc, frontmatter, operationId);
    this.pending++;
    liveQueues.add(this);
    this.tail = this.tail.then(async () => {
      let attempted: PostWriteBaseline | null = null;
      try {
        if (this.disposed || this.suspended) return;
        this.compileRefused = false;
        const body = serializePostDoc(doc);
        // Dedup on the WHOLE write — body-only comparison silently dropped
        // frontmatter-only saves (a title edit serializes an identical body).
        const written = JSON.stringify(frontmatter) + '\n' + body;
        if (written === this.lastWritten && !this.error && this.unresolvedAttempts.length === 0) { this.error = null; this.failedJob = null; return; }
        // A frontmatter-only save re-uses the last verdict — compile() is the
        // heaviest op in the save path and the body didn't change.
        if (body !== this.lastCompiledBody) {
          const gate = await postCompiles(body, this.opts.format ?? 'mdx');
          if (this.disposed || this.suspended) return;
          if (!gate.ok) {
            this.compileRefused = true;
            throw new Error(gate.error);
          }
          this.lastCompiledBody = body;
        }
        const write = this.opts.writePost ?? contentOps.updatePost;
        attempted = { frontmatter, body };
        const options = {
          baseline: this.baseline,
          ...(this.unresolvedAttempts.length ? { unresolvedAttempts: [...this.unresolvedAttempts] } : {}),
        };
        await write(this.opts.collection, this.writeSlug, frontmatter, body, options);
        this.unresolvedAttempts = [];
        this.baseline = { frontmatter: structuredClone(frontmatter), body };
        this.lastWritten = written;
        this.error = null;
        this.failedJob = null;
        // An unrelated success must not erase an older unknown write outcome.
        // A compile correction or exact acknowledged retry can supersede it.
        for (const old of liveQueues) {
          if (old !== this && old.pending === 0 && old.projectId === this.projectId
              && old.matches(this.opts.collection, this.writeSlug)
              && (old.compileRefused || (old.failedJob && serializePostDoc(old.failedJob.doc) === body
                && JSON.stringify(old.failedJob.frontmatter) === JSON.stringify(frontmatter)))) {
            old.error = null; old.failedJob = null; liveQueues.delete(old);
          }
        }
        if (this.disposed) return;
        if (!this.durable) this.opts.onWritten?.(body);
      } catch (e) {
        // Own affected targets independently of candidate reconciliation rights.
        // A reverted/disjoint revision must verify them before releasing work.
        if (e instanceof PostSourceConflict) {
          // A refused candidate never permits overwriting the actual target.
          // Retain its constraints even if no earlier unknown write exists.
          this.unresolvedAttempts = this.unresolvedAttempts.map(previous => ({ ...previous, canReconcileCandidate: false }));
          if (attempted) {
            const constraint = { ...attempted, canReconcileCandidate: false };
            if (!this.unresolvedAttempts.some(previous => JSON.stringify(previous) === JSON.stringify(constraint))) this.unresolvedAttempts.push(constraint);
          }
        } else if (attempted && this.opts.writePost) {
          const outcome = { ...attempted, canReconcileCandidate: true };
          if (!this.unresolvedAttempts.some(previous => JSON.stringify(previous) === JSON.stringify(outcome))) this.unresolvedAttempts.push(outcome);
        }
        this.failedJob = { doc, frontmatter, operationId };
        this.error = e instanceof Error ? e : new Error(String(e));
        this.opts.onRefused?.(this.error.message);
      } finally {
        this.pending--;
        if (this.pending === 0 && !this.error) liveQueues.delete(this);
      }
    });
    const result = this.flushNow();
    void result.catch(() => {}); // scheduled callers may intentionally ignore completion
    return result;
  }

  private enqueueDurable(doc: PostDoc, frontmatter: Record<string, unknown>, operationId: string): Promise<void> {
    if (this.disposed || this.suspended) return Promise.reject(new Error('This post is no longer accepting input.'));
    const body = serializePostDoc(doc);
    const written = JSON.stringify(frontmatter) + '\n' + body;
    if (written === this.lastQueuedIntent && this.lastQueuedResult && !this.error) return this.lastQueuedResult;
    const revision = ++this.candidateRevision;
    const previous = this.tail, slug = this.writeSlug;
    this.pending++; liveQueues.add(this); this.lastQueuedIntent = written;
    const acceptance = acceptPreparedPostWrite(this.projectId!, this.opts.collection, slug, async () => {
      await previous;
      this.compileRefused = false;
      if (body !== this.lastCompiledBody) {
        const gate = await postCompiles(body, this.opts.format ?? 'mdx');
        if (!gate.ok) { this.compileRefused = true; throw new Error(gate.error); }
        this.lastCompiledBody = body;
      }
      return { frontmatter, body, options: { baseline: this.baseline } };
    }, operationId);
    this.tail = acceptance.then(accepted => {
      this.acceptedRevision = accepted.revision;
      this.baseline = { frontmatter: structuredClone(frontmatter), body };
      this.lastWritten = written; this.error = null; this.failedJob = null;
      for (const observer of this.draftObservers) observer({ status: 'accepted', revision, doc, frontmatter });
      registerSourceMaterializers();
      // Receipt arrival only refreshes a still-mounted projection observer.
      void materializeThrough(this.projectId!, accepted.revision).then(() => {
        if (!this.disposed) this.opts.onWritten?.(body);
      }).catch(error => { console.error('[post materialization]', error); });
    }, error => {
      this.failedJob = { doc, frontmatter, operationId };
      this.error = error instanceof Error ? error : new Error(String(error));
      if (this.candidateRevision === revision) for (const observer of this.draftObservers) observer({ status: 'rejected', revision });
      if (!this.disposed) this.opts.onRefused?.(this.error.message);
    }).finally(() => {
      this.pending--;
      if (this.pending === 0 && !this.heldInput && (!this.error || this.disposed)) liveQueues.delete(this);
    });
    const result = this.tail.then(() => { if (this.error) throw this.error; });
    this.lastQueuedResult = result;
    void result.catch(() => {});
    return result;
  }

  /**
   * The post as this editor now observes it (the listing refresh after a write
   * of ours outside this queue — the rename's replay by the previous editor
   * instance, a "+ Add field" patch). Honoured only while this queue has
   * nothing of its own to compare against: no acknowledged write, none in
   * flight, no unresolved attempt — so a lagging listing can never regress an
   * acknowledged baseline. Owner 2026-09-13: every save after "+ Add field"
   * refused as an external edit, so the image popover's Done could not close.
   */
  rebase(baseline: PostWriteBaseline): void {
    if (this.pending !== 0 || this.lastWritten !== null || this.unresolvedAttempts.length) return;
    this.baseline = structuredClone(baseline);
  }

  /** Agent multiplayer (owner 2026-11-08, ledger F): the post as an outside
   * writer left it, merged into the open editor, becomes the baseline — the next
   * save carries only the user's own changes on top of it. The editor calls it
   * only while nothing of its own is in flight (`size === 0`). */
  adopt(baseline: PostWriteBaseline): void {
    this.baseline = structuredClone(baseline);
    this.lastQueuedIntent = null; // the same text against a new baseline is a new write
  }

  /** A grouped collection operation has already accepted this one key. It
   * must advance the editor's baseline without creating a second post edit. */
  acceptCollectionField(field: string, values: Record<string, unknown>): void {
    if (!this.baseline) return;
    const frontmatter = { ...this.baseline.frontmatter };
    if (Object.prototype.hasOwnProperty.call(values, field)) frontmatter[field] = structuredClone(values[field]);
    else delete frontmatter[field];
    this.baseline = { ...this.baseline, frontmatter };
    this.lastWritten = null;
    this.lastQueuedIntent = null;
  }

  /** Terminal: aborts every pending job and refuses future ones. */
  dispose(): void {
    this.disposed = true;
    this.error = null;
    liveQueues.delete(this);
  }

  /**
   * Drop jobs while a rename has the file in flight — resumable, unlike
   * dispose. Dropping (not deferring) is safe because every flush serializes
   * the CURRENT full doc. PostEditor replays the latest mounted revision on
   * the acknowledged renamed path before remounting.
   */
  suspend(): void {
    this.suspended = true;
  }

  /** Same post identity, after its acknowledged rename. No in-flight job may
   * change destination; the caller drains and suspends before moving bytes. */
  followRenamedPost(slug: string): void {
    if (!this.suspended || this.pending !== 0) throw new Error('Wait for post writes before renaming.');
    this.writeSlug = slug;
    this.suspended = false;
  }

  resume(): void {
    this.suspended = false;
  }

  /** The editor holds typed text instead of enqueueing per keystroke; null releases. */
  holdInput(push: (() => void) | null): void {
    this.releaseHold?.(); this.releaseHold = null;
    this.heldInput = push;
    if (push) {
      liveQueues.add(this);
      if (this.projectId) this.releaseHold = holdProjectInput(this.projectId, () => this.pushHeldInput());
    } else if (this.pending === 0 && !this.error) liveQueues.delete(this);
  }

  /** Tail promise — await on unmount/pagehide. */
  private pushHeldInput(): void {
    const held = this.heldInput;
    if (!held) return;
    this.heldInput = null; this.releaseHold?.(); this.releaseHold = null;
    held();
  }

  flushNow(): Promise<void> {
    this.pushHeldInput();
    if (this.pending === 0 && this.error && this.failedJob && !this.compileRefused) {
      return this.enqueue(this.failedJob.doc, this.failedJob.frontmatter, this.failedJob.operationId);
    }
    return this.tail.then(() => { if (this.error) throw this.error; });
  }

  /** Only source consumers (rename/preview) require the captured projection. */
  async materializeNow(): Promise<void> {
    await this.flushNow();
    if (this.durable && this.acceptedRevision) await flushDurableSourceWritesThrough(this.projectId!, this.acceptedRevision);
  }
}
