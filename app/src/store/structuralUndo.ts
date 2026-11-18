/**
 * task-133 Task 8: structural undo for the local (files-truth) runtime.
 *
 * Local-mode structural ops (⌘K insert, draw, delete, move) write REAL files
 * with no doc commands and no takeSnapshot — snapshot undo can't see them.
 * Each op instead pushes a StructuralUndoRecord onto the SAME UndoContext
 * stack, carrying the forward ops (replayed on ⇧⌘Z) and the inverse ops
 * (replayed on ⌘Z) through viteStructuralWriter — the one write channel.
 *
 * Inverse construction (byte-fidelity contract, see restoreSourceAtLocation
 * in sq-source-plugin.js):
 * - insert  → [remove at insertedLine, import-remove (only when the import
 *              was newly added)]
 * - remove  → [restore removedSource verbatim at removedLine:removedColumn]
 * - move    → [remove at insertedLine, restore removedSource verbatim]
 *
 * Line numbers in a record are valid until the next write shifts them —
 * v0 accepts this (single-user sequential edits; class writes replace within
 * existing lines, but TEXT writes can change line counts — known staleness
 * source). A stale replay fails server-side (span resolution) → toast, entry
 * dropped, stack not corrupted. Session-scoped; git is the cross-session
 * history (task-132 law).
 */
import type * as Y from 'yjs';
import type { SourceLocation } from '@/core/state/index';
import { contentOps } from '@/core/collections/content-ops';
import {
  deleteLocalPageFile,
  restoreLocalPageFile,
  applyLocalPageDeleteToDoc,
  applyLocalPageRestoreToDoc,
} from './localPages';
import { moveLocalPageFile } from '@/utils/localPageSync';
import type {
  StructuralInsertPosition,
  StructuralInsertResult,
  StructuralRemoveResult,
  StructuralMoveResult,
  StructuralImportResult,
  StructuralRestoreResult,
  StructuralRestoreRegionResult,
} from '@/services/ViteStructuralWriter';

export type StructuralOp =
  | { kind: 'insert'; loc: SourceLocation; markup: string; position: StructuralInsertPosition }
  /** Fix 1 (task-148): page-level append — no anchor location, the plugin
   *  resolves the page file's outermost template element itself. */
  | { kind: 'append-page'; pageFile: string; markup: string }
  /** allowRootRemoval (data-loss guard): carried on the record so a REDO of a
   *  legitimately-allowed removal replays with the same permission the forward
   *  op had. An INVERSE remove (undoing our own insert) always sets it — it
   *  restores the file to a state we know it was in moments ago. */
  | { kind: 'remove'; loc: SourceLocation; allowRootRemoval?: boolean }
  | {
      kind: 'move';
      from: SourceLocation;
      to: SourceLocation;
      position: StructuralInsertPosition;
      allowRootRemoval?: boolean;
    }
  | {
      kind: 'import';
      pageFile: string;
      name: string;
      importPath: string;
      remove: boolean;
      /** remove only: collapse the then-empty fence pair — set when the FORWARD add CREATED the frontmatter. */
      removeFences?: boolean;
    }
  | { kind: 'restore'; loc: SourceLocation; text: string }
  /** Live-smoke Critical: byte-exact inverse of an insert/move SPLICE —
   *  replaces [loc.line, loc.line+lineCount) with segment (the pre-splice
   *  bytes; '' = the splice only inserted new lines). Unlike 'remove' this
   *  rejoins a mid-line-split target line. */
  | { kind: 'restore-region'; loc: SourceLocation; lineCount: number; segment: string }
  /** task-148 page delete/restore — the only ops that touch BOTH a file and
   *  the doc, and the only ones that do NOT go through viteStructuralWriter:
   *  a whole src/pages file is not a span inside a page, so they drive the
   *  host /__sq/local/page-{delete,restore} endpoints and mirror the result
   *  into Yjs (DELETE_PAGE / ADD_PAGE with the seeding id). Both need the
   *  replay doc — without it they refuse BEFORE touching the file. */
  | { kind: 'page-delete'; folder: string; pageId: string; route: string; file: string }
  | { kind: 'page-restore'; folder: string; pageId: string; route: string; file: string; content: string }
  /** task-240 pagination: a page FILE rename inside src/pages (the route is
   *  unchanged — `blog.astro` ⇄ `blog/[...page].astro`), no doc row involved. */
  | { kind: 'page-move'; folder: string; from: string; to: string }
  /**
   * Content editor — one post BODY, whole. Every post-body edit already rewrites
   * the whole body through contentOps.updatePost (the one write path, design
   * §3), so the inverse is simply the previous body: byte-exact, and immune to
   * the splice asymmetry that makes a mid-line insert's inverse dangerous
   * (task-133). Whole-file ops are already an accepted shape here — see
   * 'page-restore'.
   *
   * Frontmatter is deliberately absent: updatePost's local branch merges an
   * empty frontmatter key-by-key, so every original frontmatter line survives
   * byte-for-byte and only the body is replaced.
   */
  | { kind: 'content-body'; collection: string; slug: string; body: string };

/** One undoable structural gesture: forward = redo ops, inverse = undo ops (in replay order). */
export interface StructuralUndoStep {
  forward: StructuralOp[];
  inverse: StructuralOp[];
  sourceFiles?: import('@/services/durableEdits/types').DurableFileChange[];
  /** The gesture was an intentional master edit (a Fill-kind conversion of an
   *  element another file renders): its replay may cross surfaces the same way. */
  masterWrite?: boolean;
}
export interface StructuralUndoRecord {
  structuralOp: StructuralUndoStep & { sourceSteps?: StructuralUndoStep[] };
  /** The page the edit was made on (stamped at push): ⌘Z / ⌘⇧Z replay it
   *  there from any page — never "belongs to another surface" (owner 2026-11-10). */
  origin?: import('@/utils/localWriteScope').LocalWriteOrigin;
}

export type PushStructuralUndo = (record: StructuralUndoRecord) => void;

/** Several gestures as ONE undo entry (task-240: ⌘K BlogSlot insert + its
 *  bind): redo replays them in order, undo unwinds them in reverse. */
export function mergeStructuralRecords(records: StructuralUndoRecord[]): StructuralUndoRecord {
  const steps = records.flatMap(record => record.structuralOp.sourceSteps ?? [record.structuralOp]);
  const allMapped = steps.length > 0 && steps.every(step => step.sourceFiles?.length);
  const files = new Map<string, import('@/services/durableEdits/types').DurableFileChange>();
  if (allMapped) for (const step of steps) for (const file of step.sourceFiles!) {
    const previous = files.get(file.file);
    if (previous && previous.afterSource !== file.beforeSource) throw new Error('Combined source undo has a noncontiguous baseline');
    files.set(file.file, previous ? { ...file, beforeSource: previous.beforeSource,
      identityMaps: [...previous.identityMaps ?? [], ...file.identityMaps ?? []] } : structuredClone(file));
  }
  const origin = records.find(record => record.origin)?.origin;
  return {
    structuralOp: {
      forward: records.flatMap((r) => r.structuralOp.forward),
      inverse: [...records].reverse().flatMap((r) => r.structuralOp.inverse),
      ...(allMapped ? { sourceFiles: [...files.values()] }
        : steps.some(step => step.sourceFiles?.length) ? { sourceSteps: structuredClone(steps) } : {}),
      ...(steps.some(step => step.masterWrite) ? { masterWrite: true } : {}),
    },
    ...(origin ? { origin } : {}),
  };
}

/** Discriminates structural entries from UndoSnapshot entries on the shared stack. */
export function isStructuralUndoEntry(entry: object): entry is StructuralUndoRecord {
  return 'structuralOp' in entry;
}

/** The writer surface replay needs — viteStructuralWriter satisfies it. */
export interface StructuralReplayWriter {
  writeInsert(
    loc: SourceLocation,
    markup: string,
    position: StructuralInsertPosition
  ): Promise<StructuralInsertResult | false>;
  writeAppendPage(pageFile: string, markup: string): Promise<StructuralInsertResult | false>;
  writeRemove(
    loc: SourceLocation,
    allowRootRemoval?: boolean
  ): Promise<StructuralRemoveResult | false>;
  writeMove(
    loc: SourceLocation,
    target: SourceLocation,
    position: StructuralInsertPosition,
    allowRootRemoval?: boolean
  ): Promise<StructuralMoveResult | false>;
  writeImport(
    pageFile: string,
    name: string,
    importPath: string,
    remove?: boolean,
    removeFences?: boolean
  ): Promise<StructuralImportResult | false>;
  writeRestore(loc: SourceLocation, text: string): Promise<StructuralRestoreResult | false>;
  writeRestoreRegion(
    loc: SourceLocation,
    lineCount: number,
    segment: string
  ): Promise<StructuralRestoreRegionResult | false>;
}

/**
 * Live-smoke Critical: the byte-exact inverse of an insert/move SPLICE, built
 * from the write reply's region fields. Returns null for legacy replies
 * without them (callers fall back to remove-at-insertedLine — the old,
 * mid-line-asymmetric inverse, kept only as wire-compat insurance).
 */
export function insertRegionInverseOp(res: {
  file: string;
  replacedLine?: number;
  replacedLineCount?: number;
  originalSegment?: string;
}): StructuralOp | null {
  if (res.replacedLine == null || res.replacedLineCount == null || res.originalSegment === undefined) {
    return null;
  }
  return {
    kind: 'restore-region',
    loc: { file: res.file, line: res.replacedLine, column: 1 },
    lineCount: res.replacedLineCount,
    segment: res.originalSegment,
  };
}

/**
 * 'failed'  = the FIRST op failed → the file was not changed by this replay.
 * 'partial' = a later op failed → the file needs a manual look (rare; ops are
 *             ordered so the fallible span-resolution runs first).
 */
export type StructuralReplayOutcome = 'ok' | 'failed' | 'partial';

/** Extra context a replay may need. Page ops mirror into Yjs, so they require
 *  the editor doc; every other op ignores this. */
export interface StructuralReplayDeps {
  doc?: Y.Doc;
}

async function execOp(
  op: StructuralOp,
  writer: StructuralReplayWriter,
  deps: StructuralReplayDeps,
): Promise<boolean> {
  let res: { success: boolean } | false;
  switch (op.kind) {
    // Page ops: host endpoint FIRST, doc mirror only on success — the same
    // files-are-truth ordering the live delete uses. No doc → refuse before
    // the write, so a file is never removed without the row following.
    case 'page-delete': {
      if (!deps.doc) return false;
      const { route, file } = await deleteLocalPageFile(op.folder, op.pageId);
      applyLocalPageDeleteToDoc(deps.doc, op.pageId, route, file || op.file);
      return true;
    }
    case 'page-restore': {
      if (!deps.doc) return false;
      const { route, file } = await restoreLocalPageFile(op.folder, op.route, op.content, op.file);
      applyLocalPageRestoreToDoc(deps.doc, route, file || op.file);
      return true;
    }
    case 'page-move':
      await moveLocalPageFile(op.folder, op.from, op.to);
      return true;
    case 'insert':
      res = await writer.writeInsert(op.loc, op.markup, op.position);
      break;
    case 'append-page':
      res = await writer.writeAppendPage(op.pageFile, op.markup);
      break;
    case 'remove':
      res = await writer.writeRemove(op.loc, op.allowRootRemoval === true);
      break;
    case 'move':
      res = await writer.writeMove(op.from, op.to, op.position, op.allowRootRemoval === true);
      break;
    case 'import':
      // Pass removeFences only when set — keeps the common 4-arg call shape.
      res = op.removeFences === true
        ? await writer.writeImport(op.pageFile, op.name, op.importPath, op.remove, true)
        : await writer.writeImport(op.pageFile, op.name, op.importPath, op.remove);
      break;
    case 'restore':
      res = await writer.writeRestore(op.loc, op.text);
      break;
    case 'restore-region':
      res = await writer.writeRestoreRegion(op.loc, op.lineCount, op.segment);
      break;
    case 'content-body':
      // Not a span inside a page, so it does not go through the structural
      // writer — same reason the page ops don't (see above).
      await contentOps.updatePost(op.collection, op.slug, {}, op.body);
      return true;
  }
  return !!res && res.success === true;
}

/** Replay ops sequentially; stops at the first failure (throw / false / !success). */
export async function replayStructuralOps(
  ops: StructuralOp[],
  writer: StructuralReplayWriter,
  deps: StructuralReplayDeps = {},
): Promise<StructuralReplayOutcome> {
  for (let i = 0; i < ops.length; i++) {
    let ok = false;
    try {
      ok = await execOp(ops[i], writer, deps);
    } catch {
      ok = false;
    }
    if (!ok) return i === 0 ? 'failed' : 'partial';
  }
  return 'ok';
}
