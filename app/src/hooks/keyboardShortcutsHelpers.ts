// src/hooks/keyboardShortcutsHelpers.ts
//
// Pure helpers for the Backspace/Delete routing in useKeyboardShortcuts.
// Split out so they can be tested without rendering the hook.

import * as Y from 'yjs';
import type { ScannedElement, MultiSelectionEntry } from '@/context/SelectionContext';
import { isDrawnKey, parseKey } from '@/store/types';
import type { EditorCommand } from '@/store/types';
import { isWrapperKey, isInstanceRootKey } from '@/store/keyKind';
import { isLayoutChromeKey as isLayoutChromeKeyImpl } from '@/utils/layoutChromeKeys';
import { applyCommand } from '@/store/commands';
import { acceptDocumentMutation, type MutationSnapshot } from '@/store/documentMutation';

export function isFilledDrawnSlot(doc: Y.Doc, key: string): boolean {
  const yEl = doc.getMap('elements').get(key) as Y.Map<unknown> | undefined;
  return !!(yEl && yEl.get('isDrawn') && yEl.get('slotType') && yEl.get('slotComponentMarkup'));
}

/**
 * Walk a scanned element's parentKey chain to find an enclosing filled drawn
 * slot. Needed because drawn slots' inner content is innerHTML'd at runtime
 * and gets dynamic keys (`dynamic:section:0@hash`) — those don't parse as
 * `<slotId>:tag-N`, so the regular instance-child path can't recognize the
 * slot from the selected key alone.
 */
export function findEnclosingFilledDrawnSlotKey(
  doc: Y.Doc,
  startKey: string | null | undefined,
  scannedElements: ScannedElement[],
): string | null {
  if (!startKey) return null;
  const byKey = new Map(scannedElements.map((el) => [el.key, el] as const));
  let cur: string | null | undefined = startKey;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (isFilledDrawnSlot(doc, cur)) return cur;
    cur = byKey.get(cur)?.parentKey;
  }
  return null;
}

// isInstanceRootKey moved to store/keyKind.ts (key-classification home) so
// store-side code — e.g. the group-move planner — can use it without
// importing from hooks/. Re-exported to keep existing imports working.
export { isInstanceRootKey };

/**
 * The blog post page's content slot (`bindingType === 'collection-content'`)
 * is NOT user-deletable — commands.ts refuses REMOVE_ELEMENT and
 * DELETE_INSTANCE_CHILD for it. The keyboard layer must refuse too, BEFORE
 * the snapshot/dispatch/SYNC_REMOVE_ELEMENT_FROM_DOM sequence; otherwise the
 * refused delete still visually removes the slot from the iframe until the
 * next RENDER. Accepts the slot's element id or any of its instance-child
 * keys (`<contentElId>:tag-N`).
 */
export function isContentSlotKey(doc: Y.Doc, key: string): boolean {
  const parsed = parseKey(key);
  if (!parsed || parsed.type === 'source') return false;
  const yEl = doc.getMap('elements').get(parsed.instanceId) as Y.Map<unknown> | undefined;
  return yEl?.get('bindingType') === 'collection-content';
}

/**
 * Drill-up (Shift+Enter) target resolution. Avoids the Astro page wrapper
 * (`[pageId].astro`, the editor's invisible #sq-components injection point) and
 * respects the synthesized Layout level:
 *   - Layout root selected            → null (nothing above the Layout)
 *   - layout chrome/slot tag selected → the Layout root (its conceptual parent)
 *   - DOM parent is the page wrapper  → the Layout root (or null when no layout)
 *   - otherwise                       → the scanned parentKey
 */
export function resolveDrillUpKey(
  selectedKey: string,
  scannedElements: ScannedElement[],
  layoutRootKey: string | null,
): string | null {
  if (layoutRootKey && selectedKey === layoutRootKey) return null;
  if (layoutRootKey && selectedKey.startsWith(`${layoutRootKey}:`)) return layoutRootKey;
  const parent = scannedElements.find((el) => el.key === selectedKey)?.parentKey ?? null;
  if (isWrapperKey(parent)) return layoutRootKey;
  return parent;
}

// Layout chrome (root `layoutchrome-<pageId>` or any child) must never be removed
// via the element-delete path — it would wipe the layout-chrome element; chrome
// belongs to the layout master. The layout ROOT's Delete=Detach is handled
// separately (layoutDeleteAction). Canonical predicate: utils/layoutChromeKeys.
export { isLayoutChromeKey } from '@/utils/layoutChromeKeys';

/** One member of a delete group — same shape and captured-at-click-time
 *  semantics as a multi-selection member, so reuse that type rather than
 *  maintaining a parallel one. */
export type DeleteEntry = MultiSelectionEntry;

export interface DeleteEntryDeps {
  doc: Y.Doc;
  dispatch: import('@/store/durableDispatch').EditorDispatch;
  scannedElements: ScannedElement[];
  claimSnapshot?: () => MutationSnapshot | undefined;
}

export interface EntryDeletion { command: EditorCommand; previewKey?: string }

/**
 * Delete ONE entry using the per-kind matrix shared by the single-key Delete
 * path and the multi-select group loop: drawn root → REMOVE_DRAWN_ELEMENT;
 * instance child → DELETE_INSTANCE_CHILD + DOM sync; instance root / normal
 * element → REMOVE_ELEMENT + DOM sync. Guarded kinds (layout chrome, content
 * slot) are skipped — in a group they must not abort the other entries.
 * Returns whether a delete was dispatched. The caller owns takeSnapshot.
 */
export function planEntryDeletion(entry: DeleteEntry, deps: Pick<DeleteEntryDeps, 'doc' | 'scannedElements'>): EntryDeletion | null {
  const { key, elementId } = entry;
  if (isLayoutChromeKeyImpl(key)) return null; // defensive; membership policy excludes
  if (isContentSlotKey(deps.doc, key)) return null; // collection pipeline guard

  if (isDrawnKey(key) && !key.includes(':')) {
    return { command: { type: 'REMOVE_DRAWN_ELEMENT', elementKey: key } };
  }

  const parsed = parseKey(key);
  const isRootOfInstance =
    parsed?.type === 'instance-child' &&
    isInstanceRootKey(key, parsed.instanceId, deps.scannedElements);
  if (parsed?.type === 'instance-child' && !isRootOfInstance) {
    return { command: {
      type: 'DELETE_INSTANCE_CHILD',
      instanceId: parsed.instanceId,
      selector: parsed.selector,
    }, previewKey: key };
  }

  const targetId =
    parsed?.type === 'instance-root' || isRootOfInstance
      ? parsed!.instanceId
      : elementId;
  if (targetId) {
    return { command: { type: 'REMOVE_ELEMENT', elementId: targetId }, previewKey: key };
  }
  return null;
}

export function publishEntryDeletions(plans: EntryDeletion[]): void {
  for (const plan of plans) if (plan.previewKey) window.postMessage({
    type: 'SYNC_REMOVE_ELEMENT_FROM_DOM', payload: { key: plan.previewKey },
  }, '*');
}

export async function deleteOneEntry(entry: DeleteEntry, deps: DeleteEntryDeps): Promise<boolean> {
  const plan = planEntryDeletion(entry, deps);
  if (!plan) return false;
  if (await deps.dispatch(plan.command) === false) return false;
  publishEntryDeletions([plan]);
  return true;
}

/** A cut/delete group is indivisible at the document acceptance boundary. */
export async function deleteEntries(entries: DeleteEntry[], deps: DeleteEntryDeps): Promise<number> {
  const plans = entries.map(entry => planEntryDeletion(entry, deps)).filter((plan): plan is EntryDeletion => !!plan);
  if (!plans.length) return 0;
  await acceptDocumentMutation(deps.doc, staged => {
    for (const { command } of plans) if (!applyCommand(staged, command)) throw new Error('Element deletion refused');
  }, deps.claimSnapshot?.());
  publishEntryDeletions(plans);
  return plans.length;
}
