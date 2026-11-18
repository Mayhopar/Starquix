/**
 * task-133 structural ops: browser-safe client for insert/remove/move of
 * keyed elements + page import management in the real source file
 * (local/server write channel).
 *
 * Design choice: ONE instance handling four result types via the base class's
 * array `resultMessageType` (not four subclasses) — requestIds are unique per
 * request, so the shared pending map can never cross-resolve, and callers get
 * one import. Promises resolve the FULL result payload (opt-in
 * sendViaPostMessageForPayload) because undo records need the extras
 * (insertedLine, removedSource, ...) — existing writers stay boolean.
 */

import type { SourceLocation } from '@/core/state/index';
import { stripStamps } from '@/utils/stampAttr';
import { BaseViteWriter } from './BaseViteWriter';
import { acceptStructuralOperations } from './durableEdits/structuralAcceptance';
import type { LocalWriteOrigin } from '@/utils/localWriteScope';

export type StructuralInsertPosition = 'inside-end' | 'before' | 'after';

export interface StructuralInsertResult extends Record<string, unknown> {
  sourceFiles?: import('./durableEdits/types').DurableFileChange[];
  success: boolean;
  insertedLine: number;
  file: string;
  /** task-133 Task 9 review: top-level roots in the spliced markup (server-side
   *  count). Kept in replies; the undo inverse now uses restore-region below. */
  rootCount?: number;
  /** Live-smoke Critical: the exact region the splice REWROTE — the byte-exact
   *  inverse is ONE writeRestoreRegion(originalSegment) over
   *  [replacedLine, replacedLine+replacedLineCount). originalSegment '' =
   *  the splice only inserted new lines (restore deletes them); non-empty =
   *  the original bytes of a line the splice SPLIT (mid-line / EOF-append).
   *  Optional only for legacy replies — fall back to remove-at-insertedLine. */
  replacedLine?: number;
  replacedLineCount?: number;
  originalSegment?: string;
}

export interface StructuralRemoveResult extends Record<string, unknown> {
  success: boolean;
  removedSource: string;
  removedLine: number;
  /** 1-based column of the removed region's start (undo restores there). */
  removedColumn: number;
  file: string;
}

/** task-133 Task 8: move results carry the ORIGINAL bytes + location so undo
 *  can remove the block from its new spot and restore it verbatim. */
export interface StructuralMoveResult extends StructuralInsertResult {
  removedSource: string;
  removedLine: number;
  removedColumn: number;
}

export interface StructuralRestoreResult extends Record<string, unknown> {
  success: boolean;
  restoredLine: number;
  file: string;
}

export interface StructuralRestoreRegionResult extends Record<string, unknown> {
  success: boolean;
  restoredLine: number;
  file: string;
}

export interface StructuralImportResult extends Record<string, unknown> {
  success: boolean;
  /** true when the add call actually changed the file (undo gates on this) */
  added?: boolean;
  /** true when the remove call actually stripped an import */
  removed?: boolean;
  /** lines the add inserted (1 = existing frontmatter, 3 = created one; 0 when
   *  added=false). A queued same-file insert must offset its target line by
   *  this — a scan-time line resolves the WRONG element post-add. */
  lineDelta?: number;
}

class ViteStructuralWriter extends BaseViteWriter {
  constructor() {
    super({
      resultMessageType: [
        'SQ_WRITE_INSERT_RESULT',
        'SQ_WRITE_APPEND_PAGE_RESULT',
        'SQ_WRITE_REMOVE_RESULT',
        'SQ_WRITE_MOVE_RESULT',
        'SQ_WRITE_IMPORT_RESULT',
        'SQ_WRITE_RESTORE_RESULT',
        'SQ_WRITE_RESTORE_REGION_RESULT',
      ],
      writerName: 'ViteStructuralWriter',
      requestIdPrefix: 'struct_',
    });
  }

  /**
   * Insert markup relative to the element at sourceLocation. Resolves false when writes aren't armed; rejects on write error/timeout.
   *
   * task-160 — `stripStamps` on the way in. Spliced markup can be a COPY of a
   * stamped invocation (a duplicated component, an AI-generated block echoing
   * one back), and writing a `data-sq-id` that already belongs to a different
   * invocation is worse than any sliding ordinal: on the next open BOTH holders
   * are poisoned and both lose their styling. New markup starts unstamped and
   * is stamped on the next open, exactly like everything else the user wrote.
   * The plugin refuses stamped markup too, so a stale client cannot corrupt the
   * project.
   */
  async writeInsert(
    sourceLocation: SourceLocation,
    markup: string,
    position: StructuralInsertPosition,
    origin?: LocalWriteOrigin,
  ): Promise<StructuralInsertResult | false> {
    return (await acceptStructuralOperations([{ kind: 'insert', loc: sourceLocation, markup: stripStamps(markup), position }], { origin }))[0] as StructuralInsertResult;
  }

  /**
   * Fix 1 (task-148): append markup to a page FILE with no DOM anchor —
   * component-only pages (layout + component tags, no `{...Astro.props}`
   * spread) surface no scanned node keyed to the page file, so there is
   * nothing to insert against. The plugin resolves the outermost template
   * element from the file itself and splices inside-end of it (html > body
   * preferred); with no element it appends at the end of the template.
   * The reply is the SAME shape as writeInsert (incl. the region-restore
   * fields), so undo push sites are unchanged.
   */
  async writeAppendPage(
    pageFile: string,
    markup: string,
    origin?: LocalWriteOrigin,
  ): Promise<StructuralInsertResult | false> {
    return (await acceptStructuralOperations([{ kind: 'append-page', pageFile, markup: stripStamps(markup) }], { origin }))[0] as StructuralInsertResult;
  }

  /**
   * Remove the element at sourceLocation. Result carries the removed markup
   * for undo.
   *
   * allowRootRemoval (data-loss guard, real incident 2026-08-02): opt-in past
   * the plugin's refusal to remove a file's ONLY top-level element. Set it
   * ONLY when the target file is the page the user is editing, or when
   * replaying undo/redo of a write we made ourselves. Omitting it is the safe
   * default — the plugin default-denies.
   */
  async writeRemove(
    sourceLocation: SourceLocation,
    allowRootRemoval = false
  ): Promise<StructuralRemoveResult | false> {
    return (await acceptStructuralOperations([{ kind: 'remove', loc: sourceLocation, allowRootRemoval }]))[0] as StructuralRemoveResult;
  }

  /** Move the element at sourceLocation next to (or into) targetLocation.
   *  Both must live in the SAME file (the plugin reads one file); see
   *  writeRemove for allowRootRemoval. */
  async writeMove(
    sourceLocation: SourceLocation,
    targetLocation: SourceLocation,
    position: StructuralInsertPosition,
    allowRootRemoval = false
  ): Promise<StructuralMoveResult | false> {
    return (await acceptStructuralOperations([{ kind: 'move', from: sourceLocation, to: targetLocation, position, allowRootRemoval }]))[0] as StructuralMoveResult;
  }

  /**
   * task-133 Task 8: splice previously-removed bytes back VERBATIM at
   * sourceLocation (the removedLine/removedColumn a remove/move reported).
   * The undo inverse of writeRemove and (with writeRemove first) writeMove.
   */
  async writeRestore(
    sourceLocation: SourceLocation,
    text: string
  ): Promise<StructuralRestoreResult | false> {
    return (await acceptStructuralOperations([{ kind: 'restore', loc: sourceLocation, text }]))[0] as StructuralRestoreResult;
  }

  /**
   * Live-smoke Critical: byte-exact inverse of an insert/move SPLICE —
   * replaces the post-splice line range [sourceLocation.line, +lineCount)
   * with `segment` (the pre-splice bytes; '' deletes the inserted lines).
   * Unlike writeRemove this rejoins a mid-line-split target line.
   */
  async writeRestoreRegion(
    sourceLocation: SourceLocation,
    lineCount: number,
    segment: string,
    origin?: LocalWriteOrigin,
  ): Promise<StructuralRestoreRegionResult | false> {
    return (await acceptStructuralOperations([{ kind: 'restore-region', loc: sourceLocation, lineCount, segment }], { origin }))[0] as StructuralRestoreRegionResult;
  }

  /**
   * Add (or with remove=true, strip) an import in pageFile's frontmatter.
   * line/column are unused by the plugin — sourceLocation only carries the
   * file through the shared write bracket's path guard.
   * removeFences (remove only): also collapse the then-empty `---`/`---`
   * pair — set ONLY when the forward add CREATED the frontmatter (lineDelta 3).
   */
  async writeImport(
    pageFile: string,
    name: string,
    importPath: string,
    remove = false,
    removeFences = false,
    // Only the project variables service opts in for required layout CSS imports.
    masterWrite = false,
  ): Promise<StructuralImportResult | false> {
    return (await acceptStructuralOperations([{ kind: 'import', pageFile, name, importPath, remove, removeFences }], { masterWrite }))[0] as StructuralImportResult;
  }
}

export const viteStructuralWriter = new ViteStructuralWriter();
