import { recoverStaleCanvas, sourceActionFailure, type SourceAction } from '@/utils/sourceActionFeedback';
/**
 * task-133 Task 6: delete + move/reorder for SOURCE-KEYED elements in the
 * local (files-truth) runtime. Source-keyed elements (`data-sq-source`
 * `file:line:col` keys) have NO doc nodes — doc commands (REMOVE_ELEMENT,
 * REORDER_PAGE_ELEMENTS, REPARENT_ELEMENT, SET_CHILD_ORDER) can't touch them;
 * the ops here write the REAL file through viteStructuralWriter instead.
 * Mirrors the Task 5 module pattern (localComponentInsert.ts): plain-data
 * module, no doc dispatch, no takeSnapshot (task-133 Task 8 wires undo via
 * inverse structural writes), single toast per failure.
 *
 * SEQUENCING RULE (binding): one structural write per gesture; callers must
 * never issue overlapping writes to the same file (a second write computed
 * against pre-HMR line numbers corrupts it). Multi-element group DELETE
 * satisfies it by sorting members bottom-up (deepest file:line first) and
 * deleting sequentially, so earlier lines never go stale (one undo record —
 * see useKeyboardShortcuts). Group MOVE is still BLOCKED in local mode: a
 * move changes line numbers both above and below the splice, so after the
 * first write every other member's target lines are stale.
 */
import toast from 'react-hot-toast';
import { containsCardTitle } from '@/utils/cardTitleLock';
import { acquireStructuralWrite, releaseStructuralWrite } from '@/store/structuralWriteGuard';
import { parseKey } from '@/store/types';
import { viteStructuralWriter, type StructuralInsertPosition, type StructuralInsertResult, type StructuralMoveResult, type StructuralRemoveResult } from '@/services/ViteStructuralWriter';
import { acceptFileChanges, finishAcceptedFiles } from '@/services/durableEdits/fileAcceptance';
import { prepareSourceGesture } from '@/services/durableEdits/sourceGesture';
import type { StructuralOp } from '@/store/structuralUndo';
// @ts-expect-error shared JavaScript transforms
import { unusedDefaultImports, findFrontmatterFences, resolveElementSpan, widenToExpression, scanTopLevelElements, lineNumberAt, columnNumberAt } from '../../../../preview-template/src/plugins/sq-source-transforms.js';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalPendingSelection, getSelectionEpoch } from '@/utils/localPendingSelection';
import { isContainerNode, type DropPosition } from '@/store/planLayersDrop';
import { insertRegionInverseOp, type PushStructuralUndo } from '@/store/structuralUndo';
import { markLocalScanStaleAfterWrite } from '@/utils/localPageSync';
import { pruneDescendants } from '@/store/multiSelect';
import { isContainerTag } from '@/utils/localStructural';
import type { SourceLocation } from '@/bridge/types';
import { resolveLocalUsageTarget, type UsageTargetNode } from '@/utils/localUsageTarget';
import {
  classifyLocalWriteTarget,
  notifyLocalCrossFileWrite,
  captureLocalElementOrigin,
  type LocalWriteScope,
} from '@/utils/localWriteScope';

/** Same rule as Task 5's component-instance refusal (localComponentInsert). */
const INSTANCE_BLOCKED =
  "Loop copies / component internals can't take structural edits — select a page element";

const NOT_SOURCE_BACKED =
  'This element has no source location — structural edits need a source-backed element';

/**
 * Wrong-file-write guard (live-smoke Critical). currentPageFile flips
 * synchronously with the page id while the iframe + scan lag, so an op fired in
 * that window must never resolve its target from the PREVIOUS page's scan. User
 * gestures never see this reason (owner 2026-11-10: "it must just SWITCH"): a
 * page-level edit waits for the switched-to page (afterLocalPageArrives), an
 * element-level edit lands on the page it was picked on. Only a quiet background
 * upgrade (reemitLocalBlogSlots) skips with it.
 */
export const LOCAL_PAGE_SWITCHING_REASON = 'the canvas moved to another page before this edit landed — nothing was written';

/** `#n` loop-copy / component-instance suffix on a source key. */
const INSTANCE_SUFFIX_RE = /#\d+$/;

/* ------------------------------------------------------------------ *
 * CROSS-FILE structural edits (data-loss guard, real incident 2026-08-02)
 * ------------------------------------------------------------------ */

/**
 * A page renders its components inline, so a scanned element's
 * `sourceLocation.file` is the COMPONENT's file, not the page's. Selecting the
 * rendered header on a page and pressing Delete therefore removed the ROOT of
 * `src/components/Header.astro` — the header vanished from every page and the
 * file was left with nothing but frontmatter. `Back.astro` went to 0 bytes.
 * The project had no git; nothing was recoverable.
 *
 * THE RULE now lives in ONE place: `utils/localWriteScope.ts`. This alias keeps
 * the structural call sites reading naturally; the scope it returns drives both
 * the up-front REFUSAL (a cross-file target is an instance-scope edit of a
 * master — never allowed from a page view) and, for the writes that do go
 * through, the `allowRootRemoval` opt-in the plugin default-denies
 * (assertRootRemovalAllowed, defence in depth: only the plugin can see whether
 * a target is the file's only top-level element, and a stale client must not be
 * able to bypass it).
 *
 * The FIRST version of this guard (c22e3cc3) only WARNED on a cross-file child
 * edit and left the root case to the plugin. That was wrong: a class/text/image
 * edit took the same route with no warning at all, and even the warned deletes
 * rewrote a component every page shares. Refusal + "open the component" is the
 * rule; the component view is the escape hatch.
 *
 * 'unknown' (no current page file — boot, doc-only page, non-local runtime) is
 * treated exactly like 'cross-file': never assume same-file.
 */
export type StructuralTargetScope = LocalWriteScope;
export { classifyLocalWriteTarget as classifyStructuralTarget } from '@/utils/localWriteScope';

/**
 * Refusal for an instance-scope edit of a shared component. The toast is
 * rendered by Editor's useLocalCrossFileToast (it carries an "Open" action, so
 * it needs the UI layer); this module only announces the refusal, exactly like
 * the backstop in BaseViteWriter does.
 */
function refuseCrossFileEdit(file: string): void {
  notifyLocalCrossFileWrite(file);
}

/** A move must resolve both spans in ONE file — the plugin reads only
 *  sourceLocation.file, so a cross-file drop would splice at a line number
 *  that means something else entirely in the source file. */
export const CROSS_FILE_MOVE_BLOCKED =
  "These elements live in different files — a drag can't move one into the other";

/**
 * True for `file:line:col` keys (suffixed or not) — elements with NO doc node.
 * LAYERED on store/types parseKey — the single key parser (keyKind memo:
 * never re-derive key kinds with ad-hoc string checks). parseKey alone would
 * silently TRUNCATE a `#n` suffix (parseInt stops at '#'), so the suffix is
 * detected and stripped FIRST, then parseKey classifies the base key.
 */
export function isSourceKeyedElementKey(key: string): boolean {
  return parseKey(key.replace(INSTANCE_SUFFIX_RE, ''))?.type === 'source';
}

/** Suffix-aware `file:line:col` parse for structural write targets. (Named to
 *  avoid colliding with utils/parseSourceKey.ts, which has different
 *  semantics — legacy/instance key splitting.) */
function parseStructuralTargetKey(
  key: string,
): { file: string; line: number; column: number; suffixed: boolean } | null {
  const suffixed = INSTANCE_SUFFIX_RE.test(key);
  const parsed = parseKey(suffixed ? key.replace(INSTANCE_SUFFIX_RE, '') : key);
  if (parsed?.type !== 'source') return null;
  return { file: parsed.file, line: parsed.line, column: parsed.col, suffixed };
}

/**
 * THE one in-flight guard lives in store/structuralWriteGuard.ts (store layer,
 * so UndoContext can import it without a context→components dependency).
 * Re-exported here so existing call sites keep importing from this module.
 */
export {
  acquireStructuralWrite,
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
  _resetStructuralWriteInFlightForTests,
} from '@/store/structuralWriteGuard';

export interface LocalDeleteArgs {
  /** Selected scanned key (`file:line:col`, possibly `#n`-suffixed). */
  key: string;
  /** SelectionContext's clearSelection — called ONLY after a successful write. */
  clearSelection: () => void;
  /** task-133 Task 8: UndoContext's pushStructuralUndo — pushed ONLY on a successful write. */
  pushUndo?: PushStructuralUndo;
  /**
   * task-148 item 7 — the scan tree, for the usage re-target. Optional: without
   * it the op behaves exactly as it did before, so no caller is forced to
   * thread it and no non-local path changes.
   */
  scannedByKey?: ReadonlyMap<string, UsageTargetNode>;
}


/**
 * After removals in `file`, drop the default imports nothing references any
 * more (delete the `<Layout>` wrapper → its `import Layout` line goes too).
 * Forward and inverse are BOTH one byte-exact restore-region over the
 * frontmatter (the same channel every splice inverse uses), so undo/redo
 * never depend on import order. The inverse MUST replay BEFORE the element
 * restore: the imports sit above the removal point, so putting the
 * frontmatter back first puts the restore line back where it was.
 */
export async function pruneUnusedImports(gesture: ReturnType<typeof prepareSourceGesture>, file: string): Promise<{ forward: StructuralOp[]; inverse: StructuralOp[] }> {
  const change = gesture.files.get(file);
  const none = { forward: [] as StructuralOp[], inverse: [] as StructuralOp[] };
  if (!change?.afterSource) return none;
  const before = change.afterSource;
  const unused = unusedDefaultImports(before) as Array<{ name: string; importPath: string }>;
  if (!unused.length) return none;
  for (const { name, importPath } of unused) {
    await gesture.apply({ kind: 'import', pageFile: file, name, importPath, remove: true });
  }
  const after = change.afterSource;
  if (after === null || after === before) return none;
  const frontmatter = (src: string) => {
    const lines = src.replace(/\r\n/g, '\n').split('\n');
    const fences = findFrontmatterFences(lines) as { openIdx: number; closeIdx: number } | null;
    if (!fences) throw new Error('frontmatter vanished while pruning imports');
    return { line: fences.openIdx + 1, lineCount: fences.closeIdx - fences.openIdx + 1, segment: lines.slice(fences.openIdx, fences.closeIdx + 1).join('\n') + '\n' };
  };
  const b = frontmatter(before), a = frontmatter(after);
  return {
    forward: [{ kind: 'restore-region', loc: { file, line: b.line, column: 1 }, lineCount: b.lineCount, segment: a.segment }],
    inverse: [{ kind: 'restore-region', loc: { file, line: a.line, column: 1 }, lineCount: a.lineCount, segment: b.segment }],
  };
}

/** Shared per-member refusal/retarget policy; preparation never writes.
 *  `pageFile`: the page the element was picked on (the page being left while a
 *  switch is pending — captureLocalElementOrigin; its delete lands there). */
export function planLocalElementDeletion(key: string, scannedByKey: ReadonlyMap<string, UsageTargetNode> | undefined, pageFile: string | null) {
  const plan = planLocalElementTarget(key, scannedByKey, pageFile);
  // The post title can never leave a card (owner 2026-10-09): nothing happens; Layers shows why (lock).
  return plan && !containsCardTitle(plan.target) ? plan : null;
}

/** The write target of one selected layer, or null after its refusal toast. */
function planLocalElementTarget(key: string, scannedByKey: ReadonlyMap<string, UsageTargetNode> | undefined, pageFile: string | null) {
  if (!pageFile) return null; // nothing on screen yet
  const parsed = parseStructuralTargetKey(key);
  if (!parsed) { toast(NOT_SOURCE_BACKED); return null; }
  if (parsed.suffixed) { toast(INSTANCE_BLOCKED); return null; }
  const target = resolveLocalUsageTarget(key, scannedByKey, pageFile) ??
    scannedByKey?.get(key)?.sourceLocation ?? { file: parsed.file, line: parsed.line, column: parsed.column };
  const scope = classifyLocalWriteTarget(target.file, pageFile);
  if (scope === 'cross-file') { refuseCrossFileEdit(target.file); return null; }
  return { target, allowRootRemoval: scope === 'same-file' };
}

/**
 * Delete a source-keyed element by removing it from the real file.
 * `#n`-suffixed selections are refused (deleting the template would nuke every
 * copy — allowed only via an unsuffixed selection, files-truth).
 */
export async function deleteLocalElement(
  { key, clearSelection, pushUndo, scannedByKey }: LocalDeleteArgs,
  _writer = viteStructuralWriter,
): Promise<boolean> {
  // The element's page is the page it was picked on — the one being left while
  // a switch is pending — and the plan is made NOW, against what the user saw.
  const origin = captureLocalElementOrigin();
  const plan = planLocalElementDeletion(key, scannedByKey, origin.pageFile);
  if (!plan) return false;
  // The write projects the plan's coordinates through any edit landed meanwhile.
  await acquireStructuralWrite();
  try {
    const { target, allowRootRemoval } = plan;

    let res!: StructuralRemoveResult;
    let accepted;
    let pruned: { forward: StructuralOp[]; inverse: StructuralOp[] } = { forward: [], inverse: [] };
    const remove = async () => {
      const projectId = getActiveSaveProjectId();
      if (!projectId) throw new Error('Project storage is not ready');
      const gesture = prepareSourceGesture(projectId, [], origin);
      return acceptFileChanges(`wc://${projectId}`, async () => {
        res = await gesture.apply({ kind: 'remove', loc: await gesture.resolve(target), allowRootRemoval }) as unknown as StructuralRemoveResult;
        pruned = await pruneUnusedImports(gesture, res.file);
        return [...gesture.files.values()];
      });
    };
    try { accepted = await remove(); }
    catch (err) {
      if (recoverStaleCanvas(err)) { clearSelection(); return false; }
      console.error('Deleting element failed:', err);
      toast.error(sourceActionFailure('delete-element', err));
      return false;
    }

    // Paint now: the accepted delete leaves the canvas in this frame, with the
    // selection; the write's refresh lands 150–400 ms later as a silent check.
    window.postMessage({ type: 'SYNC_REMOVE_ELEMENT_FROM_DOM', payload: { key } }, '*');

    // Scan freshness is diagnostic; subsequent UI/AI targets resolve through
    // the accepted identity maps immediately.
    markLocalScanStaleAfterWrite();

    // task-133 Task 8: inverse = verbatim restore of the removed bytes at the
    // exact removal point (restoreSourceAtLocation — never re-indented).
    pushUndo?.({
      origin,
      structuralOp: {
        sourceFiles: accepted.files,
        forward: [{ kind: 'remove', loc: target, allowRootRemoval }, ...pruned.forward],
        inverse: [...pruned.inverse, {
          kind: 'restore',
          loc: { file: res.file, line: res.removedLine, column: res.removedColumn ?? 1 },
          text: res.removedSource,
        }],
      },
    });
    clearSelection();
    void finishAcceptedFiles(accepted);
    return true;
  } finally {
    releaseStructuralWrite();
  }
}

export interface LocalMoveArgs {
  /** Dragged element's scanned key. */
  key: string;
  /** Drop-target element's scanned key. */
  targetKey: string;
  position: StructuralInsertPosition;
  /** task-133 Task 8: UndoContext's pushStructuralUndo — pushed ONLY on a successful write. */
  pushUndo?: PushStructuralUndo;
  /** task-148 item 7 — the scan tree, for the usage re-target (see LocalDeleteArgs). */
  scannedByKey?: ReadonlyMap<string, UsageTargetNode>;
}

/**
 * Move a source-keyed element next to (or into) another source-keyed element
 * in the real file. On success the moved element is re-selected after the
 * HMR-triggered rescan via the pending-selection singleton (exact line).
 */
export async function moveLocalElement(
  { key, targetKey, position, pushUndo, scannedByKey }: LocalMoveArgs,
  _writer = viteStructuralWriter,
): Promise<boolean> {
  // The page it was picked on (see deleteLocalElement); then it waits its turn.
  const origin = captureLocalElementOrigin();
  const selectionEpoch = getSelectionEpoch();
  const pageFile = origin.pageFile;
  if (!pageFile) return false; // nothing on screen yet
  await acquireStructuralWrite();
  try {
    if (key === targetKey) return false;
    const from = parseStructuralTargetKey(key);
    const to = parseStructuralTargetKey(targetKey);
    if (!from || !to) {
      toast(NOT_SOURCE_BACKED);
      return false;
    }
    if (from.suffixed || to.suffixed) {
      toast(INSTANCE_BLOCKED);
      return false;
    }
    // task-148 item 7 — re-target BOTH ends independently. Dragging a rendered
    // card moves the `<Card />` tag; dropping INTO one lands inside
    // `<Card>…</Card>`, i.e. as slot content, which is the page's own markup.
    // Either side may retarget or not — a page element dragged next to a card
    // retargets only the anchor.
    const fromLoc =
      resolveLocalUsageTarget(key, scannedByKey, pageFile) ??
      scannedByKey?.get(key)?.sourceLocation ?? { file: from.file, line: from.line, column: from.column };
    const toLoc =
      resolveLocalUsageTarget(targetKey, scannedByKey, pageFile) ??
      scannedByKey?.get(targetKey)?.sourceLocation ?? { file: to.file, line: to.line, column: to.column };

    // The plugin resolves BOTH spans in sourceLocation.file — a cross-file
    // drop would splice at a line that means something else there. Refused
    // client-side for the honest copy; the plugin refuses it too.
    if (fromLoc.file !== toLoc.file) {
      toast(CROSS_FILE_MOVE_BLOCKED);
      return false;
    }
    // Two DIFFERENT elements can retarget to the SAME usage tag (any two nodes
    // rendered by one invocation). Moving a tag relative to itself is a no-op
    // the plugin would resolve as an own-subtree splice — refuse it here, where
    // we still know it came from a retarget.
    if (fromLoc.file === toLoc.file && fromLoc.line === toLoc.line && fromLoc.column === toLoc.column) {
      return false;
    }
    // Same rule as delete: a move INSIDE a shared component, driven from a page
    // view, rewrites that component for every page — refused.
    const scope = classifyLocalWriteTarget(fromLoc.file, pageFile);
    if (scope === 'cross-file') {
      refuseCrossFileEdit(fromLoc.file);
      return false;
    }
    const allowRootRemoval = scope === 'same-file';

    let res!: StructuralMoveResult;
    let accepted;
    try {
      const projectId = getActiveSaveProjectId();
      if (!projectId) throw new Error('Project storage is not ready');
      const gesture = prepareSourceGesture(projectId, [], origin);
      accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
        res = await gesture.apply({ kind: 'move', from: await gesture.resolve(fromLoc), to: await gesture.resolve(toLoc), position, allowRootRemoval }) as unknown as StructuralMoveResult;
        return [...gesture.files.values()];
      });
    } catch (err) {
      // Covers the plugin's server-side guards too (cycle / unbalanced spans).
      if (recoverStaleCanvas(err)) return false;
      console.error('Moving element failed:', err);
      toast.error(sourceActionFailure('move-element', err));
      return false;
    }
    if (!res || !res.success) {
      console.error('Moving element was not confirmed:', res);
      toast.error(sourceActionFailure('move-element'));
      return false;
    }

    // Paint now (same-parent before/after moves; a reparent waits for the
    // refresh). A canvas drop already moved the DOM: then this is a no-op.
    const order = predictedSiblingOrder(key, targetKey, position, scannedByKey);
    if (order) window.postMessage({ type: 'REORDER_ELEMENTS_IN_IFRAME', payload: { elementIds: order } }, '*');

    // The old scan remains usable through the accepted identity maps.
    markLocalScanStaleAfterWrite();

    // task-133 Task 8: an anchor-based inverse move would need the original
    // sibling's POST-move line (fragile arithmetic); instead the move result
    // carries the original bytes + location, so the inverse is remove-at-new-
    // spot + verbatim restore — byte-exact regardless of neighbors.
    pushUndo?.({
      origin,
      structuralOp: {
        sourceFiles: accepted.files,
        forward: [{
          kind: 'move',
          from: fromLoc,
          to: toLoc,
          position,
          allowRootRemoval,
        }],
        inverse: [
          // Live-smoke Critical (same class as insert): the target-side splice
          // can split a single-line target; the byte-exact inverse of the
          // splice is a region restore, THEN the verbatim restore of the
          // moved bytes at their original spot.
          // allowRootRemoval on the legacy fallback: an inverse remove undoes
          // OUR OWN splice back to a state the file held moments ago.
          insertRegionInverseOp(res)
            ?? { kind: 'remove', loc: { file: res.file, line: res.insertedLine, column: 1 }, allowRootRemoval: true },
          {
            kind: 'restore',
            loc: { file: res.file, line: res.removedLine, column: res.removedColumn ?? 1 },
            text: res.removedSource,
          },
        ],
      },
    });
    // The accepted move and its inverse are locally available now. Background
    // confirmation must not turn a successful drag into a rejected UI gesture.
    setLocalPendingSelection(res.file, res.insertedLine, selectionEpoch);
    void finishAcceptedFiles(accepted);
    return true;
  } finally {
    releaseStructuralWrite();
  }
}

export const WRAP_DIFFERENT_PARENTS = 'Select layers with the same parent';
export const WRAP_NOT_SIBLINGS = 'Text or code sits between these layers — select layers with nothing between them';
export const WRAP_IN_PARAGRAPH = "A paragraph can only hold text and inline layers — select the paragraph itself";
export const WRAP_IN_LIST_OR_TABLE = "A list, table or select can only hold its own items — select the whole list or table";
export const WRAP_PAGE_ROOT = "The page body can't be changed this way — select the layers inside it";
export const UNWRAP_EMPTY = 'This layer holds no layers — select a container';
export const UNWRAP_TEXT_OR_CODE = 'Text or code sits in or around this container — select a container that holds only layers';
export const UNWRAP_COMPONENT = "A component can't be removed like a container — select an element";

type WrapNode = UsageTargetNode & { tagName?: string };

export interface LocalWrapArgs {
  /** The selected keys, primary first: the wrap takes them all in source order; the unwrap takes the primary. */
  keys: string[];
  scannedByKey: ReadonlyMap<string, WrapNode>;
  pushUndo?: PushStructuralUndo;
  /** select(null): once accepted the old keys stop being the selection; the result takes it on the next scan. */
  deselect: () => void;
}

/** One write target per layer, or null after the refusal toast. All or
 *  nothing: a partial wrap would change which layers share the container. The
 *  parent receives new children either way (the container on a wrap, its
 *  layers on an unwrap), so it must be able to hold them. */
function planLocalWrap(keys: string[], scannedByKey: ReadonlyMap<string, WrapNode>, pageFile: string | null): SourceLocation[] | null {
  const members = pruneDescendants(keys.map(key => ({ key, elementId: null })), k => scannedByKey.get(k)?.parentKey).map(e => e.key);
  const targets = new Map<string, SourceLocation>();
  for (const key of members) {
    const plan = planLocalElementTarget(key, scannedByKey, pageFile);
    if (!plan) return null;
    if (/^(html|head|body)$/i.test(scannedByKey.get(key)?.tagName ?? '')) { toast(WRAP_PAGE_ROOT); return null; }
    // Two roots of one component invocation are one `<Card />` tag.
    targets.set(`${plan.target.line}:${plan.target.column}`, plan.target);
  }
  const parents = new Set(members.map(key => scannedByKey.get(key)?.parentKey ?? null));
  if (parents.size > 1) { toast(WRAP_DIFFERENT_PARENTS); return null; }
  const [parent] = parents;
  const parentTag = parent ? scannedByKey.get(parent)?.tagName : undefined;
  if (parentTag && !isContainerTag(parentTag)) { toast(WRAP_IN_PARAGRAPH); return null; }
  // A <div> there is invalid; in a table the parser hoists it out, so the preview would not match the file.
  if (parentTag && /^(ul|ol|menu|dl|table|thead|tbody|tfoot|tr|colgroup|select|optgroup)$/i.test(parentTag)) { toast(WRAP_IN_LIST_OR_TABLE); return null; }
  return [...targets.values()];
}

/** DOM siblings are not always source siblings: between two wrapped layers the
 *  file may hold only whitespace, `<!-- -->` and whole elements (a guarded
 *  `{cond && <el/>}` or a whole `.map()` body counts as one). Text, an `{expression}`,
 *  the `)}` of a loop body or a ternary `:` would be split across the container. */
function onlySiblingsBetween(between: string): boolean {
  let roots: Array<{ start: number; end: number; unclosed?: boolean }>;
  try {
    roots = (scanTopLevelElements(between) as Array<{ start: number; end: number; unclosed?: boolean }>)
      .map(r => widenToExpression(between, r) as { start: number; end: number; unclosed?: boolean });
  } catch { return false; } // an element that shares its {…} (a ternary branch) cannot move as a sibling
  if (roots.some(r => r.unclosed)) return false;
  let rest = '', pos = 0;
  for (const r of roots) { rest += between.slice(pos, r.start); pos = r.end; }
  return !(rest + between.slice(pos)).replace(/<!--[\s\S]*?-->/g, '').trim();
}

type SourceGesture = ReturnType<typeof prepareSourceGesture>;
/** A refusal found while the gesture reads the source: a toast, nothing written. */
class Refusal extends Error {}

/**
 * Create / Remove container: ONE gesture of existing ops (`body` applies them
 * and records each one's inverse through `step`), ONE accepted write, ONE undo
 * record. `body` returns where the selection goes on the next scan.
 */
async function regroupLocal(
  { keys, scannedByKey, pushUndo, deselect }: LocalWrapArgs,
  failure: SourceAction,
  body: (gesture: SourceGesture, targets: SourceLocation[], step: (fwd: StructuralOp, inv: StructuralOp[]) => void) => Promise<SourceLocation>,
): Promise<boolean> {
  const origin = captureLocalElementOrigin();
  const selectionEpoch = getSelectionEpoch();
  const targets = planLocalWrap(keys, scannedByKey, origin.pageFile);
  if (!targets?.length) return false;
  await acquireStructuralWrite();
  try {
    const forward: StructuralOp[] = [];
    const inverse: StructuralOp[] = [];
    let next!: SourceLocation;
    let accepted;
    try {
      const projectId = getActiveSaveProjectId();
      if (!projectId) throw new Error('Project storage is not ready');
      const gesture = prepareSourceGesture(projectId, [], origin);
      accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
        next = await body(gesture, targets, (fwd, inv) => { forward.push(fwd); inverse.unshift(...inv); });
        return [...gesture.files.values()];
      });
    } catch (err) {
      if (err instanceof Refusal) { toast(err.message); return false; }
      if (recoverStaleCanvas(err)) return false;
      console.error(`${failure} failed:`, err);
      toast.error(sourceActionFailure(failure, err));
      return false;
    }
    markLocalScanStaleAfterWrite();
    pushUndo?.({ origin, structuralOp: { sourceFiles: accepted.files, forward, inverse } });
    // Keys are positional: the old ones now name other elements.
    if (getSelectionEpoch() === selectionEpoch) {
      deselect();
      setLocalPendingSelection(next.file, next.line, getSelectionEpoch());
    }
    void finishAcceptedFiles(accepted);
    return true;
  } finally {
    releaseStructuralWrite();
  }
}

/** The current text of `file` in the gesture, LF-normalised like the transforms read it. */
const gestureSource = (gesture: SourceGesture, file: string) => gesture.files.get(file)!.afterSource!.replace(/\r\n/g, '\n');

/**
 * Issue #5 — wrap the selected layers in a new class-less `<div>` at the first
 * one's source position, holding them in source order (unselected siblings
 * between them stay outside, after it): insert, then a move per layer (moves
 * keep element identity, so queued edits follow), then a tidy of the blank
 * lines the moves left.
 */
export const wrapLocalElements = (args: LocalWrapArgs) => regroupLocal(args, 'wrap-elements', async (gesture, targets, step) => {
  const resolved: Array<{ target: SourceLocation; loc: SourceLocation }> = [];
  for (const target of targets) resolved.push({ target, loc: await gesture.resolve(target) });
  resolved.sort((a, b) => a.loc.line - b.loc.line || a.loc.column - b.loc.column);
  const file = resolved[0].loc.file;
  const source = () => gestureSource(gesture, file);
  const spans = resolved.map(({ loc }) => widenToExpression(source(), resolveElementSpan(source(), loc)) as { start: number; end: number });
  const gaps = spans.slice(1).map((s, i) => source().slice(spans[i].end, s.start));
  if (spans.slice(1).some((s, i) => s.start < spans[i].end) || !gaps.every(onlySiblingsBetween)) throw new Refusal(WRAP_NOT_SIBLINGS);

  const insert: StructuralOp = { kind: 'insert', loc: resolved[0].loc, markup: '<div></div>', position: 'before' };
  const ins = await gesture.apply(insert) as unknown as StructuralInsertResult;
  step(insert, [insertRegionInverseOp(ins)!]);
  const line = ins.insertedLine;
  const container = { file, line, column: source().split('\n')[line - 1].match(/^[ \t]*/)![0].length + 1 };
  // Re-resolve after every apply: each one moves the coordinates.
  for (const { target } of resolved) {
    const move: StructuralOp = { kind: 'move', from: await gesture.resolve(target), to: container, position: 'inside-end', allowRootRemoval: true };
    const res = await gesture.apply(move) as unknown as StructuralMoveResult;
    step(move, [insertRegionInverseOp(res)!, { kind: 'restore', loc: { file, line: res.removedLine, column: res.removedColumn ?? 1 }, text: res.removedSource }]);
  }
  // Blank lines that separated adjacent layers would pile up behind `</div>`.
  const blank = gaps.every(gap => !gap.trim()) ? gaps.reduce((n, gap) => n + Math.max(0, (gap.match(/\n/g)?.length ?? 0) - 1), 0) : 0;
  if (blank) {
    const close = lineNumberAt(source(), resolveElementSpan(source(), container).closeStart) as number;
    const lines = source().split('\n');
    const dropped = lines.slice(close, close + blank);
    if (dropped.every(l => !l.trim())) {
      const at = { file, line: close, column: 1 };
      const tidy: StructuralOp = { kind: 'restore-region', loc: at, lineCount: 1 + blank, segment: lines[close - 1] + '\n' };
      await gesture.apply(tidy);
      step(tidy, [{ kind: 'restore-region', loc: at, lineCount: 1, segment: [lines[close - 1], ...dropped].join('\n') + '\n' }]);
    }
  }
  return container;
});

/**
 * Remove container (⇧⌘G), the inverse of the wrap, on the PRIMARY selected
 * element: its child layers move out before it, in order, then the emptied
 * element is removed (comments between the children go with it). The first
 * former child becomes the selection.
 */
export const unwrapLocalElement = (args: LocalWrapArgs) => regroupLocal({ ...args, keys: args.keys.slice(0, 1) }, 'unwrap-element', async (gesture, [target], step) => {
  const file = target.file;
  const source = () => gestureSource(gesture, file);
  const loc = await gesture.resolve(target); // loads the file into the gesture
  const own = resolveElementSpan(source(), loc) as { start: number; end: number; tag: string; openEnd: number; closeStart: number | null };
  // A capitalised or dotted tag is a component usage (`<Card>`), whose children are slot content.
  if (/^[A-Z]|\./.test(own.tag)) throw new Refusal(UNWRAP_COMPONENT);
  const inner = own.closeStart === null ? '' : source().slice(own.openEnd, own.closeStart);
  const count = (scanTopLevelElements(inner) as unknown[]).length;
  if (!count) throw new Refusal(UNWRAP_EMPTY);
  // Moved out of a `{cond && …}` the children would stop being conditional.
  if (!onlySiblingsBetween(inner) || widenToExpression(source(), own).start !== own.start) throw new Refusal(UNWRAP_TEXT_OR_CODE);

  let first!: SourceLocation;
  for (let i = 0; i < count; i++) {
    // Always the container's current first child; re-resolve after every apply.
    const to = await gesture.resolve(target);
    const at = (scanTopLevelElements(source(), resolveElementSpan(source(), to).openEnd) as Array<{ start: number }>)[0].start;
    const from = { file, line: lineNumberAt(source(), at) as number, column: columnNumberAt(source(), at) as number };
    const move: StructuralOp = { kind: 'move', from, to, position: 'before' };
    const res = await gesture.apply(move) as unknown as StructuralMoveResult;
    step(move, [insertRegionInverseOp(res)!, { kind: 'restore', loc: { file, line: res.removedLine, column: res.removedColumn ?? 1 }, text: res.removedSource }]);
    first ??= { file, line: res.insertedLine, column: 1 };
  }
  const remove: StructuralOp = { kind: 'remove', loc: await gesture.resolve(target) };
  const res = await gesture.apply(remove) as unknown as StructuralRemoveResult;
  step(remove, [{ kind: 'restore', loc: { file, line: res.removedLine, column: res.removedColumn ?? 1 }, text: res.removedSource }]);
  return first;
});

/** The siblings' order after moving `key` before/after `targetKey` in their
 *  shared parent (scan order = document order), or null when not that case. */
export function predictedSiblingOrder(
  key: string, targetKey: string, position: StructuralInsertPosition,
  scannedByKey?: ReadonlyMap<string, UsageTargetNode>,
): string[] | null {
  const from = scannedByKey?.get(key), to = scannedByKey?.get(targetKey);
  if (!from || !to || from.parentKey !== to.parentKey || (position !== 'before' && position !== 'after')) return null;
  const order = [...scannedByKey!].filter(([k, n]) => k !== key && n.parentKey === from.parentKey).map(([k]) => k);
  const at = order.indexOf(targetKey);
  order.splice(position === 'before' ? at : at + 1, 0, key);
  return order;
}

/**
 * Gutter (canvas root-handle) reorder → structural move target. Simulates the
 * arrayMove the doc path would do and expresses the landing slot as
 * before/after the NEAREST ANCHORABLE neighbor — an unsuffixed source-keyed
 * root. Drawn roots aren't in the file at all and `#n` copies aren't
 * addressable, so both are skipped (anchoring past them is still the correct
 * FILE position); handing one to moveLocalElement would fail with a
 * misleading toast (review of 66987f8b, fix 3). Returns null (silently) when
 * there is no move; toasts + null when a real move has no anchorable
 * neighbor on either side.
 */
export function planGutterLocalMove(
  rootKeys: string[],
  oldIndex: number,
  newIndex: number,
): { targetKey: string; position: 'before' | 'after' } | null {
  if (oldIndex === newIndex) return null;
  if (oldIndex < 0 || oldIndex >= rootKeys.length) return null;
  const arr = [...rootKeys];
  const [moved] = arr.splice(oldIndex, 1);
  arr.splice(newIndex, 0, moved);

  const anchorable = (k: string) =>
    !INSTANCE_SUFFIX_RE.test(k) && isSourceKeyedElementKey(k);

  // Nearest anchorable FOLLOWING sibling → land before it…
  for (let i = newIndex + 1; i < arr.length; i++) {
    if (anchorable(arr[i])) return { targetKey: arr[i], position: 'before' };
  }
  // …else nearest anchorable PRECEDING sibling → land after it.
  for (let i = newIndex - 1; i >= 0; i--) {
    if (anchorable(arr[i])) return { targetKey: arr[i], position: 'after' };
  }
  toast(NO_LOCAL_MOVE_ANCHOR);
  return null;
}

/**
 * Reparent drop (canvas drag-out → Layers drop zone, or the in-canvas
 * reparent drop) → structural move target. The gesture names a NEW PARENT
 * plus an insert index among its current children; the writer needs a
 * before/after anchor — or inside-end of the parent itself when it has no
 * anchorable children (empty container drop). Same nearest-anchorable-
 * neighbor rule as planGutterLocalMove: drawn children aren't in the file
 * and `#n` copies aren't addressable, so both are skipped. `draggedKey` is
 * skipped too — in a same-parent drop it is its own sibling, and anchoring a
 * move to itself is the no-op moveLocalElement refuses. Returns null +
 * toast when nothing can anchor the drop.
 */
export function planLocalReparentInsert(
  newParentKey: string | null,
  childKeys: string[],
  insertIndex: number,
  draggedKey?: string,
): { targetKey: string; position: StructuralInsertPosition } | null {
  const anchorable = (k: string) =>
    k !== draggedKey && !INSTANCE_SUFFIX_RE.test(k) && isSourceKeyedElementKey(k);

  // Nearest anchorable child at/after the slot → land before it…
  for (let i = Math.max(insertIndex, 0); i < childKeys.length; i++) {
    if (anchorable(childKeys[i])) return { targetKey: childKeys[i], position: 'before' };
  }
  // …else nearest anchorable child before the slot → land after it.
  for (let i = Math.min(insertIndex, childKeys.length) - 1; i >= 0; i--) {
    if (anchorable(childKeys[i])) return { targetKey: childKeys[i], position: 'after' };
  }
  // No anchorable sibling (empty container) → drop inside the parent itself.
  if (newParentKey && anchorable(newParentKey)) {
    return { targetKey: newParentKey, position: 'inside-end' };
  }
  toast(NO_LOCAL_MOVE_ANCHOR);
  return null;
}

/** Shared "nothing to anchor the move to" copy (gutter + reparent planners). */
export const NO_LOCAL_MOVE_ANCHOR =
  "Can't move this here — no source-backed neighbor to anchor the move to";

/**
 * Layers-tree drop zone → structural position. Same demotion rule as
 * planLayersDrop: an 'inside' drop on a non-container places after it.
 */
export function layersZoneToStructuralPosition(
  zone: DropPosition,
  overNode: { tagName?: string; children?: unknown[] } | undefined,
): StructuralInsertPosition {
  if (zone === 'inside') return isContainerNode(overNode) ? 'inside-end' : 'after';
  return zone;
}

/**
 * Toast copy for the one still-blocked multi-element structural gesture:
 * group MOVE (useLayersDrag). Group DELETE works — bottom-up sequential
 * writers, one undo record — so this is no longer raised from the delete path.
 */
export const LOCAL_GROUP_BLOCKED =
  'One element at a time in local mode — multi-element structural edits are not supported yet';

/**
 * Toast copy for a mixed Layers drag (drawn row ↔ source-keyed row) in local
 * mode. Honest gate: a drawn row has no file location and a source row has no
 * doc node — neither system can express the cross move. Without this gate the
 * drag fell into moveLocalElement, whose "no source location" copy misleads
 * (the user dragged a perfectly valid drawn element).
 */
export const LOCAL_MIXED_DRAG_BLOCKED =
  "Drawn and source elements can't be reordered together in local projects yet";
