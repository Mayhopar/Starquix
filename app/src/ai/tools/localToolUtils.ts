// Shared plumbing for the files-truth AI/MCP tool owners (commandTools,
// localBlogTools, localSourceTools): one rule each for "is this project
// files-truth", "where is it", "which scanned element is this key" and "is the
// target page on the canvas".
import { findLocalProjectEntry, isLocalProjectId } from '@/utils/localMode';
import { selectCurrentPageId, selectProjectId } from '@/store/selectors';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ToolCallResult, ToolExecutionContext } from './commandTools';

export const fail = (message: string): ToolCallResult => ({ success: false, message });

export function isLocalCtx(ctx: Pick<ToolExecutionContext, 'doc'>): boolean {
  return isLocalProjectId(selectProjectId(ctx.doc) ?? '');
}

/** The project's `wc://<id>` path, or null when it is not a known files-truth project. */
export function localProjectPathOf(ctx: Pick<ToolExecutionContext, 'doc'>): string | null {
  return findLocalProjectEntry(selectProjectId(ctx.doc) ?? '')?.path ?? null;
}

/** A scanned element by its key OR its source key (tools receive either). */
export function findScannedByKey(list: readonly ScannedElement[], key: string): ScannedElement | undefined {
  return list.find((e) => e.key === key || e.sourceKey === key);
}

/** task-133 Task 9: guard shared by every local structural AI branch — writes
 *  can only target the page the iframe is showing (its file is the resolved
 *  write target). Returns a refusal result, or null when the page is current. */
export function requireCurrentLocalPage(ctx: ToolExecutionContext, toolName: string, pageId: string | null): ToolCallResult | null {
  const currentId = selectCurrentPageId(ctx.doc);
  if (pageId !== null && pageId !== currentId) {
    return fail(`${toolName} failed: local projects can only edit the CURRENT page ("${currentId ?? 'none'}"). Call select_page("${pageId}") first, then retry.`);
  }
  return null;
}
