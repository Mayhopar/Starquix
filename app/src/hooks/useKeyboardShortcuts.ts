// src/hooks/useKeyboardShortcuts.ts
import { selectOptionsFor } from '@/utils/selectOptions';
import { useEffect, useCallback, useRef } from 'react';
import { useDispatch, useEditorDoc } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { selectCurrentPageId, selectPageLayout } from '@/store/selectors';
import { pageLayoutElementId } from '@/store/layoutElement';
import { useTool } from '@/context';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { useSelectionContext, useScannedElementsRef } from '@/context/SelectionContext';
import { findNode, findSiblings } from '@/utils/treeUtils';
import { getModifierKey, isMac } from '@/utils/platform';
import { useWrapSelection } from '@/hooks/useWrapSelection';
import { dispatchZoomCommand, type ZoomCommandAction } from '@/components/Canvas/zoomCommands';
import { toggleGrid } from '@/components/Canvas/gridPreferences';
import { isDrawnKey, parseKey } from '@/store/types';
import { selectProjectId } from '@/store/selectors';
import { isLocalProjectId } from '@/utils/localMode';
import {
  deleteLocalElement,
  isSourceKeyedElementKey,
  acquireStructuralWrite,
  releaseStructuralWrite,
  pruneUnusedImports } from '@/components/Editor/localStructuralOps';
import { captureLocalElementOrigin } from '@/utils/localWriteScope';
import { resolveLocalUsageTarget, type UsageTargetNode } from '@/utils/localUsageTarget';
import toast from 'react-hot-toast';
import { recoverStaleCanvas, sourceActionFailure } from '@/utils/sourceActionFeedback';
import {
  copySelection,
  cutSelection,
  pasteClipboard,
  duplicateSelection,
  type ClipboardActionDeps,
} from '@/clipboard/clipboardActions';
import { getLocalPageFile, getLocalExpectedRoute, getLocalSurfaceGeneration } from '@/utils/localPageSync';
import { getActiveSaveProjectId, getActiveSaveProjectGeneration } from '@/services/pendingProjectMutations';
import type { PushStructuralUndo, StructuralUndoRecord } from '@/store/structuralUndo';
import type { MultiSelectionEntry } from '@/context/SelectionContext';
import {
  deleteOneEntry,
  deleteEntries,
  findEnclosingFilledDrawnSlotKey,
  resolveDrillUpKey,
  isLayoutChromeKey,
  isContentSlotKey,
  type DeleteEntryDeps,
} from './keyboardShortcutsHelpers';
import { pruneDescendants } from '@/store/multiSelect';
import { planLocalElementDeletion } from '@/components/Editor/localStructuralOps';
import { prepareSourceGesture } from '@/services/durableEdits/sourceGesture';
import { acceptFileChanges, finishAcceptedFiles } from '@/services/durableEdits/fileAcceptance';
import { acceptDocumentMutation } from '@/store/documentMutation';
import { applyCommand } from '@/store/commands';
import { planEntryDeletion, publishEntryDeletions, type EntryDeletion } from './keyboardShortcutsHelpers';
import { markLocalScanStaleAfterWrite } from '@/utils/localPageSync';
import { TOOL_SHORTCUTS, BREAKPOINT_SHORTCUT_KEYS } from '@/bridge/globalShortcuts';

/**
 * Decide what the Delete/Backspace key should do when the page's Layout root is
 * selected (real key `layoutchrome-<pageId>` — the layout-chrome instance root,
 * no selector segment). Keyboard delete on a layout maps to the SAFE action
 * (Detach — keep content), never the destructive layout+content delete, which is
 * menu-only by design. Returns null for any non-layout-root selection (a chrome
 * child `…:selector` or a content key is a normal element).
 */
export function layoutDeleteAction(
  selectedKey: string | null | undefined,
): { type: 'detach' } | null {
  if (!selectedKey) return null;
  if (!selectedKey.startsWith('layoutchrome-') || selectedKey.includes(':')) return null;
  return { type: 'detach' };
}

const BREAKPOINT_ORDER = ['base', 'sm', 'md', 'lg', 'xl', '2xl'] as const;

/** `#n` loop-copy suffix — same grammar localStructuralOps refuses on. Used
 *  here only to PARSE a member's file:line for ordering; the refusal itself
 *  still happens inside deleteLocalElement. */
const GROUP_INSTANCE_SUFFIX_RE = /#\d+$/;

/**
 * Gap-9 (WC↔local parity): effective write target of a group member, for
 * ORDERING and DEDUPE only. Reuses the exact resolution deleteLocalElement
 * performs (usage retarget first, raw key second) so the sort ranks members
 * by the line the write will actually splice — a component root that
 * retargets to its `<Card />` usage tag must be ordered by the TAG's line in
 * the page file, not by its own line in the component file.
 */
function groupMemberSortTarget(
  key: string,
  scannedByKey: ReadonlyMap<string, UsageTargetNode>,
  pageFile: string | null,
): { file: string; line: number; column: number } | null {
  const usage = resolveLocalUsageTarget(key, scannedByKey, pageFile);
  if (usage) return usage;
  const parsed = parseKey(key.replace(GROUP_INSTANCE_SUFFIX_RE, ''));
  if (parsed?.type !== 'source') return null;
  return { file: parsed.file, line: parsed.line, column: parsed.col };
}

export interface LocalGroupDeleteDeps {
  /** Called ONCE after the loop, only if anything was actually deleted. */
  clearSelection: () => void;
  /** UndoContext's pushStructuralUndo — receives ONE combined record for the
   *  whole group (one undo step, parity with the WC group's single snapshot). */
  pushUndo?: PushStructuralUndo;
  /** The scan tree — parent chain + usage retarget (same map the single-key
   *  local delete path passes to deleteLocalElement). */
  scannedByKey: ReadonlyMap<string, UsageTargetNode>;
  /** Doc-path deps for drawn / instance members (WC per-kind matrix). */
  docDeps: DeleteEntryDeps;
  /** UndoContext takeSnapshot — taken once IFF the group has doc-backed members. */
  takeSnapshot: () => void;
  /** Test seam — defaults to the real local delete op. */
  deleteLocal?: typeof deleteLocalElement;
}

/**
 * Gap-9 (WC↔local parity): multi-select group Delete for the local
 * (files-truth) runtime. Replaces the old LOCAL_GROUP_BLOCKED refusal.
 *
 * Why a loop is safe now: within one file, deleting BOTTOM-UP (descending
 * effective file:line) never invalidates the remaining members' coordinates —
 * removing the highest span only shifts lines BELOW it, and the plugin
 * re-resolves each span from fresh file content per write. Cross-file members
 * don't interact at all. So the sequencing hazard the old refusal guarded
 * against ("after the first write every other member's file:line is stale")
 * simply does not arise in this order.
 *
 * Mixed groups: doc-backed members (drawn roots, instance keys) have no file
 * spans — they go through the same WC per-kind matrix (deleteOneEntry) under
 * ONE snapshot, exactly like a WC group; source-keyed members go through
 * deleteLocalElement, the SAME op as a single-key local delete (all its
 * guards — cross-file refusal, `#n` refusal, usage retarget —
 * apply per member; guards skip entries, not the group, same policy as WC).
 */
export async function deleteLocalElementGroup(
  members: MultiSelectionEntry[],
  deps: LocalGroupDeleteDeps,
): Promise<void> {
  // This callback belongs to the original UndoProvider, not whichever page
  // becomes active while the gesture is waiting on a source member.
  const pushUndo = deps.pushUndo;
  // Capture before document acceptance yields. A resumed source member must
  // never inherit another project/surface, even after an away-and-back switch.
  const projectId = selectProjectId(deps.docDeps.doc);
  const activeProjectId = getActiveSaveProjectId();
  const projectGeneration = getActiveSaveProjectGeneration();
  // The page the members were picked on (the one being left while a switch is
  // pending): the whole group lands there even if the user moves on meanwhile
  // (owner 2026-11-10: "nothing should be lost"). Only a project change stops it.
  const origin = captureLocalElementOrigin();
  const surface = getLocalExpectedRoute();
  const surfaceGeneration = getLocalSurfaceGeneration();
  const scannedByKey = new Map(deps.scannedByKey);
  const ownsContinuation = () =>
    selectProjectId(deps.docDeps.doc) === projectId &&
    getActiveSaveProjectId() === activeProjectId &&
    (activeProjectId === null || activeProjectId === projectId) &&
    getActiveSaveProjectGeneration() === projectGeneration;
  // The write finishes on its page either way; the canvas/selection side
  // effects belong to the page only while it is still the one on screen.
  const stillOnItsPage = () => ownsContinuation() && getLocalPageFile() === origin.pageFile &&
    getLocalExpectedRoute() === surface && getLocalSurfaceGeneration() === surfaceGeneration;

  // The whole group takes one write turn.
  await acquireStructuralWrite();
  try {
  const docMembers = members.filter((m) => !isSourceKeyedElementKey(m.key));
  const sourceMembers = members.filter((m) => isSourceKeyedElementKey(m.key));

  const plans = docMembers.map(member => planEntryDeletion(member, deps.docDeps)).filter((plan): plan is EntryDeletion => !!plan);

  // BOTTOM-UP file order: descending effective file:line (usage retarget
  // included). DEDUPE on the effective target — two members of ONE component
  // invocation both retarget to the same `<Card />` tag, and deleting the
  // same span twice is exactly the successive-sibling corruption the old
  // refusal existed to prevent.
  const seenTargets = new Set<string>();
  const ordered = sourceMembers
    .map((m) => ({
      m,
      t: groupMemberSortTarget(m.key, scannedByKey, origin.pageFile),
      suffixed: GROUP_INSTANCE_SUFFIX_RE.test(m.key),
    }))
    .sort((a, b) => {
      if (!a.t || !b.t) return a.t ? -1 : b.t ? 1 : 0;
      if (a.t.file !== b.t.file) return a.t.file < b.t.file ? -1 : 1;
      if (a.t.line !== b.t.line) return b.t.line - a.t.line;
      if (a.t.column !== b.t.column) return b.t.column - a.t.column;
      // Findings 13/19: EQUAL effective targets — a `#n` loop copy and its
      // unsuffixed twin (or the component root whose usage it shares). Order
      // the unsuffixed member FIRST so the dedupe below keeps the one
      // deleteLocalElement can actually write: the suffixed member is refused
      // per-member (INSTANCE_BLOCKED, before its usage retarget), so letting
      // it win the dedupe slot deleted NOTHING.
      return Number(a.suffixed) - Number(b.suffixed);
    })
    .filter(({ t }) => {
      if (!t) return true; // no parse → deleteLocalElement's own refusal toasts
      const id = `${t.file}:${t.line}:${t.column}`;
      if (seenTargets.has(id)) return false;
      seenTargets.add(id);
      return true;
    });

  // Collect each member's undo ops → ONE combined record = ONE undo step.
  // Inverse ops stack in REVERSE deletion order so undo restores the
  // last-deleted member first — each restore then replays against a file
  // state identical to the one its remove saw.
  const collected: StructuralUndoRecord[] = [];

  if (!projectId) throw new Error('Project storage is not ready');
  let files: import('@/services/durableEdits/types').DurableFileChange[] = [];
  // Plan once, up front (the planner toasts its refusals): an all-refused
  // group must not commit an empty edit or clear the selection.
  const sourcePlans = ordered
    .map(({ m }) => planLocalElementDeletion(m.key, scannedByKey, origin.pageFile))
    .filter((plan): plan is NonNullable<typeof plan> => !!plan);
  const prepare = async () => {
    const gesture = prepareSourceGesture(projectId, [], origin);
    for (const plan of sourcePlans) {
      if (!ownsContinuation()) throw new Error('Deletion stopped because the project closed');
      const forward = { kind: 'remove' as const, loc: await gesture.resolve(plan.target), allowRootRemoval: plan.allowRootRemoval };
      const removed = await gesture.apply(forward);
      collected.push({ structuralOp: { forward: [forward], inverse: [{ kind: 'restore',
        loc: { file: removed.file, line: removed.removedLine as number, column: removed.removedColumn as number }, text: removed.removedSource as string }] } });
    }
    if (!ownsContinuation()) throw new Error('Deletion stopped because the project closed');
    // Imports the removals orphaned. Pushed LAST so the reversed inverse
    // re-adds them FIRST — every member restore then lands on its original line.
    for (const file of [...gesture.files.keys()]) {
      const pruned = await pruneUnusedImports(gesture, file);
      if (pruned.forward.length) collected.push({ structuralOp: pruned });
    }
    files = [...gesture.files.values()];
    return files;
  };
    if (!ownsContinuation()) { console.warn('[delete] the project closed during a group delete — stopped'); return; } // nothing to tell an editor that is gone
    if (!plans.length && !sourcePlans.length) return;
    if (plans.length) deps.takeSnapshot();
    const snapshot = plans.length ? deps.docDeps.claimSnapshot?.() : undefined;
    const mutate = (staged: import('yjs').Doc) => {
      for (const plan of plans) if (!applyCommand(staged, plan.command)) throw new Error('Element deletion refused');
    };
    const accepted = sourcePlans.length ? await acceptFileChanges(`wc://${projectId}`, prepare, deps.docDeps.doc, mutate, snapshot) : undefined;
    if (!accepted) await acceptDocumentMutation(deps.docDeps.doc, mutate, snapshot);
    // The original provider retains the accepted inverse even after navigation.
    if (!snapshot?.attachFiles && collected.length > 0 && pushUndo) {
      pushUndo({
        origin,
        structuralOp: {
          sourceFiles: files,
          forward: collected.flatMap((r) => r.structuralOp.forward),
          inverse: [...collected].reverse().flatMap((r) => r.structuralOp.inverse),
        },
      });
    }
    if (stillOnItsPage()) {
      publishEntryDeletions(plans);
      if (files.length) markLocalScanStaleAfterWrite();
      deps.clearSelection();
    }
    if (accepted) void finishAcceptedFiles(accepted);
  } finally { releaseStructuralWrite(); }
}

export function useKeyboardShortcuts(): void {
  const dispatch = useDispatch();
  const doc = useEditorDoc();
  const { undo, redo, takeSnapshot, claimSnapshot, pushStructuralUndo } = useUndoContext();
  const { activeTool, setActiveTool, isPreview, setPreview } = useTool();

  const {
    selectedKey,
    selectedElementId,
    selectedSourceLocation,
    clearSelection,
    contextKey,
    enterContext,
    exitContext,
    select,
    additionalSelections,
    clearAdditionalSelections,
  } = useSelectionContext();
  // Scans are only read inside the keydown handler — ref-based access means
  // this hook (and its host component) no longer re-renders on every scan.
  const { scannedElementsRef, scannedByKeyRef, treeNodesRef } = useScannedElementsRef();

  // Consolidated ref for event handler access (avoid stale closures)
  const stateRef = useRef({ selectedKey, selectedSourceLocation, contextKey, activeTool, additionalSelections, isPreview });
  stateRef.current = { selectedKey, selectedSourceLocation, contextKey, activeTool, additionalSelections, isPreview };

  const wrapSelection = useWrapSelection();

  // Helper to select an element with full metadata from scannedElements
  const selectElement = useCallback((key: string) => {
    const element = scannedByKeyRef.current.get(key);
    if (element) {
      select(key, selectOptionsFor(element));
    }
  }, [select, scannedByKeyRef]);

  const handleKeyDown = useCallback(
    async (e: KeyboardEvent) => {
      const cmdOrCtrl = getModifierKey(e);

      // Save is global even while a property/source field has focus. Let
      // composition and a field's own handled shortcut keep their ownership.
      if (cmdOrCtrl && e.key === 's') {
        if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || stateRef.current.isPreview) return;
        e.preventDefault();
        const projectId = selectProjectId(doc);
        if (projectId) {
          // Edits are already durable; ⌘S only hurries their source projection.
          void flushDurableSourceWrites(projectId).catch(() => {});
        }
        return;
      }

      // Ignore if focused on input/textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      const { selectedKey: currentSelectedKey, selectedSourceLocation: currentSelectedSourceLocation, contextKey: currentContextKey, activeTool: currentActiveTool, additionalSelections: currentAdditionalSelections, isPreview: currentIsPreview } = stateRef.current;
      const currentScannedElements = scannedElementsRef.current;
      const currentTreeNodes = treeNodesRef.current;

      // task-116: preview is read-only and shows no chrome, so every editor
      // shortcut below is both useless and invisible — Delete/Cmd+Z would
      // mutate the doc with nothing on screen to show it. Esc is the escape
      // hatch that sits alongside the footer's ⏸. (Keys pressed inside the
      // preview page itself never reach here: the bridge's keydown listener is
      // detached in preview, so typing in a form is unaffected.)
      if (currentIsPreview) {
        if (e.key === 'Escape') {
          e.preventDefault();
          setPreview(false);
        }
        return;
      }

      // Canvas zoom: Cmd/Ctrl+0 → 100%, Cmd/Ctrl+= / Cmd/Ctrl+- → step,
      // Shift+1 → zoom to fit. preventDefault suppresses the BROWSER's own
      // page-zoom shortcuts — only reached when the editor document has focus
      // and the target is not an input (guard above), so typing "0" in a
      // panel field never zooms the canvas.
      const zoom = (action: ZoomCommandAction) => {
        e.preventDefault();
        dispatchZoomCommand(action);
      };
      if (cmdOrCtrl && !e.altKey) {
        if (e.key === '0' && !e.shiftKey) { zoom('reset'); return; }
        if (e.key === '=' || e.key === '+') { zoom('in'); return; }
        if (e.key === '-' || e.key === '_') { zoom('out'); return; }
      }
      if (!cmdOrCtrl && e.shiftKey && !e.altKey && e.code === 'Digit1') {
        zoom('fit');
        return;
      }

      // Alignment grid on/off: Ctrl+G on every platform (⌃G on a Mac, as in Figma's
      // layout grids — so ⌘G stays free). Modifier combos are forwarded out of the
      // iframe by rule (bridge/parts/events.ts), so this works with focus in the page.
      if (e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        toggleGrid(selectProjectId(doc));
        return;
      }

      // Create container: ⌘G on a Mac, Ctrl+Alt+G elsewhere (Ctrl+G is the grid there).
      // `code`, not `key`: ⌥ and AltGr change the letter.
      const wrapCombo = isMac() ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && e.altKey && !e.metaKey;
      if (wrapCombo && !e.shiftKey && e.code === 'KeyG') {
        e.preventDefault();
        if (!e.repeat) wrapSelection();
        return;
      }

      // Bare-key shortcuts (no modifiers). Both the keys handled here and the
      // set the bridge forwards out of the preview iframe come from ONE list:
      // bridge/globalShortcuts.ts. Add a bare-key shortcut there, never here.
      if (!cmdOrCtrl && !e.shiftKey && !e.altKey) {
        // Breakpoint shortcuts: 1–6 → xs…2xl (input guard above keeps typing safe)
        const bpIndex = BREAKPOINT_SHORTCUT_KEYS.indexOf(e.key);
        if (bpIndex !== -1) {
          dispatch({ type: 'SET_BREAKPOINT', breakpoint: BREAKPOINT_ORDER[bpIndex] });
          return;
        }
        // Tools: select/frame/text/slot/blog + vector shapes (task-106) and the
        // bezier pen (task-107). Arrow/Polygon have no key — footer flyout only.
        const tool = TOOL_SHORTCUTS[e.key.toLowerCase()];
        if (tool) {
          e.preventDefault();
          setActiveTool(tool);
          return;
        }
      }

      // Undo: Cmd/Ctrl + Z
      if (cmdOrCtrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Redo: Cmd/Ctrl + Shift + Z or Cmd/Ctrl + Y
      if (cmdOrCtrl && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        redo();
        return;
      }

      // AI mode: Cmd/Ctrl + J — toggle activeTool to/from 'ai'
      if (cmdOrCtrl && e.key === 'j') {
        e.preventDefault();
        const next = currentActiveTool === 'ai' ? 'select' : 'ai';
        setActiveTool(next); // Footer's effect is the sole sq:ai-context-mode emitter
        return;
      }

      // ⌘C copy / ⌘X cut / ⌘V paste / ⌘D duplicate — element clipboard
      if (cmdOrCtrl && (e.key === 'c' || e.key === 'x' || e.key === 'v' || e.key === 'd') && !e.shiftKey && !e.altKey) {
        const buildClipboardDeps = (entries: MultiSelectionEntry[]): ClipboardActionDeps => ({
          doc,
          entries,
          scannedByKey: scannedByKeyRef.current,
          scannedElements: currentScannedElements,
          pageId: selectCurrentPageId(doc) ?? '',
          projectId: selectProjectId(doc) ?? '',
          selectedElementId: selectedElementId ?? null,
          selectedKey: currentSelectedKey,
          pageFile: getLocalPageFile(),
          dispatch,
          takeSnapshot,
          claimSnapshot,
          clearSelection,
          pushStructuralUndo,
          deleteLocalGroup: (members) => deleteLocalElementGroup(members, {
            clearSelection,
            pushUndo: pushStructuralUndo,
            scannedByKey: scannedByKeyRef.current,
            docDeps: { doc, dispatch, scannedElements: currentScannedElements, claimSnapshot },
            takeSnapshot,
          }),
          toast: (msg) => { toast(msg); },
        });
        const primary = currentSelectedKey
          ? [{ key: currentSelectedKey, elementId: selectedElementId ?? null }]
          : [];
        const entries = [...primary, ...currentAdditionalSelections];
        if (e.key === 'v') {
          e.preventDefault();
          void pasteClipboard(buildClipboardDeps(entries));
          return;
        }
        if (entries.length === 0) return;          // no selection: let native copy happen
        e.preventDefault();
        if (e.key === 'c') { void copySelection(buildClipboardDeps(entries)); return; }
        if (e.key === 'x') { void cutSelection(buildClipboardDeps(entries)); return; }
        void duplicateSelection(buildClipboardDeps(entries));
        return;
      }

      // Delete: Backspace or Delete
      if (e.key === 'Backspace' || e.key === 'Delete') {
        // Synthetic layout node selected → Delete = Detach (safe; keep content).
        // Destructive layout+content delete is menu-only by design.
        const layoutAction = layoutDeleteAction(currentSelectedKey);
        if (layoutAction) {
          const layoutPageId = selectCurrentPageId(doc);
          if (layoutPageId) {
            e.preventDefault();
            takeSnapshot();
            await dispatch({ type: 'SET_PAGE_LAYOUT', pageId: layoutPageId, layoutName: null });
            clearSelection();
            return;
          }
        }

        // Multi-select group delete: ONE snapshot → one undo step, then the
        // same per-kind logic per entry (deleteOneEntry). The membership
        // policy (store/multiSelect.ts) keeps layout root/chrome/wrapper out
        // of groups, so the special pre-guards below (layout detach,
        // filled-drawn-slot fill-clear) deliberately don't apply here;
        // delete-time guards inside deleteOneEntry skip entries, not the group.
        // task-133 Task 6: local runtime (files-truth) — source-keyed elements
        // have NO doc nodes; the doc delete matrix can't touch them. Computed
        // once per keydown; `local_` ids ALWAYS mean the local runtime.
        const isLocalRuntime = isLocalProjectId(selectProjectId(doc) ?? '');

        if (currentAdditionalSelections.length > 0 && currentSelectedKey) {
          e.preventDefault();
          // Any-layer groups (task-076): a member whose ancestor is also a
          // member rides along with the ancestor's delete — prune it so it
          // isn't dispatched twice. In local mode the prune is also a
          // correctness guard: a descendant's file span lives INSIDE its
          // ancestor's span, so deleting both would splice a stale region.
          const getParent = (k: string) => scannedByKeyRef.current.get(k)?.parentKey;
          const survivors = pruneDescendants(
            [{ key: currentSelectedKey, elementId: selectedElementId ?? null }, ...currentAdditionalSelections],
            getParent,
          );
          // Gap-9 parity: local groups with source-keyed members used to be
          // refused (LOCAL_GROUP_BLOCKED, task-133 sequencing rule). Deleting
          // BOTTOM-UP per file keeps every remaining span valid, so the group
          // now deletes member-by-member through the same deleteLocalElement
          // path a single delete uses. Drawn/doc members ride the WC matrix.
          if (isLocalRuntime && survivors.some((s) => isSourceKeyedElementKey(s.key))) {
            // Same auto-repeat hazard as the single-key local path: a held key
            // would re-enter with the same now-stale keys.
            if (e.repeat) return;
            await deleteLocalElementGroup(survivors, {
              clearSelection,
              pushUndo: pushStructuralUndo,
              scannedByKey: scannedByKeyRef.current,
              docDeps: { doc, dispatch, scannedElements: currentScannedElements, claimSnapshot },
              takeSnapshot,
            });
            return;
          }
          const deps = { doc, dispatch, scannedElements: currentScannedElements, claimSnapshot };
          takeSnapshot();
          await deleteEntries(survivors, deps);
          clearSelection(); // also clears the extension set
          return;
        }

        // Pick the most specific selection. When the user clicked an inner
        // tag of a drawn element (currentSelectedKey = "<drawnId>:tag-N"),
        // keep that inner key so the handler can decide whether to clear a
        // slot fill or hide a child. Otherwise fall back to the drawn root
        // (so deleting a drawn element selected via Layers still works).
        const drawnInnerSelected =
          !!currentSelectedKey &&
          isDrawnKey(selectedElementId) &&
          currentSelectedKey.startsWith(selectedElementId + ':');
        const activeKey = drawnInnerSelected
          ? currentSelectedKey
          : isDrawnKey(selectedElementId)
            ? selectedElementId
            : (currentSelectedKey ?? selectedElementId);

        if (!activeKey) return;
        e.preventDefault();

        // Layout chrome (slot/header/…) belongs to the layout master — it is NOT
        // user-deletable. Without this guard, deleting the slot resolves to
        // REMOVE_ELEMENT on the layoutchrome-<pageId> element and wipes the whole
        // layout. (The layout ROOT's Delete=Detach is handled above.)
        if (isLayoutChromeKey(activeKey)) return;

        // The post page's content slot (bindingType 'collection-content')
        // belongs to the collection pipeline — it is NOT user-deletable.
        // commands.ts refuses the delete anyway, so short-circuit BEFORE the
        // snapshot/dispatch/SYNC_REMOVE_ELEMENT_FROM_DOM sequence; otherwise
        // the refused delete still visually removes the slot from the iframe
        // until the next RENDER.
        if (isContentSlotKey(doc, activeKey)) return;

        // If anything inside a filled drawn slot is selected — even if the
        // selected element has a dynamic key with no Yjs entry — clearing
        // the slot's fill is the right action, since the inner content was
        // injected as raw markup and can't be deleted as a discrete entity.
        const enclosingFilledSlotKey = findEnclosingFilledDrawnSlotKey(
          doc, activeKey, currentScannedElements,
        );
        if (enclosingFilledSlotKey && enclosingFilledSlotKey !== activeKey) {
          takeSnapshot();
          await dispatch({ type: 'CLEAR_DRAWN_SLOT_FILL', slotKey: enclosingFilledSlotKey });
          clearSelection();
          return;
        }

        // task-133 Task 6: local runtime + source-keyed key → remove from the
        // REAL file (async, one toast per failure inside the op; selection is
        // cleared by the op only on success). NO takeSnapshot — undo replays
        // the inverse structural write (Task 8). Doc-backed ghosts (drawn
        // elements, instance keys) fall through to the doc path below.
        // Auto-repeat (holding the key) is DROPPED: each repeat still sees the
        // same activeKey and would issue another writeRemove at a now-stale
        // file:line — deleting whichever sibling shifted into it. The module's
        // in-flight guard is the second lock on the same hazard.
        if (isLocalRuntime && isSourceKeyedElementKey(activeKey)) {
          if (e.repeat) return;
          void deleteLocalElement({ key: activeKey, clearSelection, pushUndo: pushStructuralUndo, scannedByKey: scannedByKeyRef.current });
          return;
        }

        takeSnapshot();

        // Single-key per-kind delete (drawn root / instance child / instance
        // root / normal element) — shared with the group loop above.
        await deleteOneEntry(
          { key: activeKey, elementId: selectedElementId ?? null },
          { doc, dispatch, scannedElements: currentScannedElements },
        );

        clearSelection();
        return;
      }

      // Escape: disarm draw tool first, then collapse multi-select, then exit context / clear selection
      if (e.key === 'Escape') {
        e.preventDefault();
        if (currentActiveTool !== 'select') {
          setActiveTool('select');
          return;
        }
        if (currentAdditionalSelections.length > 0) {
          // Back to single-select; context and primary stay untouched.
          clearAdditionalSelections();
          return;
        }
        if (currentContextKey) {
          exitContext();
        } else if (currentSelectedKey) {
          clearSelection();
        }
        return;
      }

      // Tab: Navigate to next sibling (wraps to first)
      if (e.key === 'Tab' && !e.shiftKey && !cmdOrCtrl && currentSelectedKey) {
        e.preventDefault();
        const { next, siblings } = findSiblings(currentSelectedKey, currentTreeNodes, currentScannedElements);
        if (next) {
          selectElement(next.key);
        } else if (siblings.length > 0) {
          selectElement(siblings[0].key);
        }
        return;
      }

      // Shift+Tab: Navigate to previous sibling (wraps to last)
      if (e.key === 'Tab' && e.shiftKey && !cmdOrCtrl && currentSelectedKey) {
        e.preventDefault();
        const { prev, siblings } = findSiblings(currentSelectedKey, currentTreeNodes, currentScannedElements);
        if (prev) {
          selectElement(prev.key);
        } else if (siblings.length > 0) {
          selectElement(siblings[siblings.length - 1].key);
        }
        return;
      }

      // Enter: pen shapes enter node editing; else drill down / text edit mode
      if (e.key === 'Enter' && !e.shiftKey && !cmdOrCtrl && currentSelectedKey) {
        e.preventDefault();
        // A penPath element's "inside" is its nodes — Enter opens the pen
        // node editor (same as double-clicking the shape).
        const yEl = doc.getMap('elements').get(currentSelectedKey) as import('yjs').Map<unknown> | undefined;
        if (yEl?.get('penPath')) {
          window.dispatchEvent(new CustomEvent('sq:request-pen-edit', {
            detail: { key: currentSelectedKey }
          }));
          return;
        }
        const selectedNode = findNode(currentSelectedKey, currentTreeNodes);
        if (selectedNode && selectedNode.children.length > 0) {
          // Has children - drill down to first child
          const firstChild = selectedNode.children[0];
          enterContext(currentSelectedKey);
          selectElement(firstChild.key);
        } else {
          // No children - request text edit mode
          window.dispatchEvent(new CustomEvent('sq:request-edit-mode', {
            detail: { key: currentSelectedKey }
          }));
        }
        return;
      }

      // Shift+Enter: Drill up. Resolve the conceptual parent — skip the invisible
      // Astro page wrapper and step a layout slot/chrome up to the Layout itself.
      if (e.key === 'Enter' && e.shiftKey && !cmdOrCtrl && currentSelectedKey) {
        e.preventDefault();
        const pageId = selectCurrentPageId(doc);
        const layoutRootKey = pageId && selectPageLayout(doc, pageId).layoutName
          ? pageLayoutElementId(pageId)
          : null;
        const parentKey = resolveDrillUpKey(currentSelectedKey, currentScannedElements, layoutRootKey);
        if (parentKey) {
          // The Layout root has no scanned/DOM element — select its key directly.
          if (parentKey === layoutRootKey) select(parentKey);
          else selectElement(parentKey);
          if (currentContextKey === parentKey) {
            exitContext();
          }
        } else {
          clearSelection();
        }
        return;
      }
    },
    [
      undo, redo, takeSnapshot, claimSnapshot, pushStructuralUndo,
      dispatch, doc, selectedElementId,
      setActiveTool, setPreview,
      clearSelection, clearAdditionalSelections, enterContext, exitContext, selectElement,
      scannedElementsRef, treeNodesRef, wrapSelection
    ]
  );

  useEffect(() => {
    const handleCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') void handleKeyDown(event).catch(error => {
        if (recoverStaleCanvas(error)) { clearSelection(); return; }
        console.error('Keyboard edit was not saved', error);
        toast.error(sourceActionFailure('keyboard-edit', error));
      });
    };
    // Escape belongs to a focused field or open popup before the canvas.
    // Window bubble runs after their document/target handlers, including
    // synthetic document events forwarded by the iframe bridge.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !event.isComposing && event.keyCode !== 229) void handleKeyDown(event).catch(error => { console.error('Keyboard action failed', error); });
    };
    document.addEventListener('keydown', handleCapture, true);
    window.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleCapture, true);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [handleKeyDown, clearSelection]);
}
