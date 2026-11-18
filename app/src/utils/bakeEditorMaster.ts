import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { applyAllOverrides } from '@/store/selectors';
import { baseMarkup, selectMasterChildOverrides, placementKeyOf, selectMasterMarkup } from '@/store/masters';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { serializeElementClassOverrides } from './serializeElementClassOverrides';
import { stripDrawnElements } from './stripDrawnElements';

/**
 * Bake the component-editor element's resolved markup (its current base +
 * accumulated child overrides) into the `masters` overlay, keyed by the editor
 * element's astroSource. This is the dev persistence AND propagation for master
 * edits (design §6, OQ2): one write that every placement's baseMarkup() then
 * reads — replacing the task-077 localStorage tier and the .astro round-trip.
 *
 * No-op (returns false) without an astroSource — there is nothing to key the
 * master on (e.g. a freshly-drawn editor element before it has a source).
 */
export function bakeEditorMaster(doc: Y.Doc, elementId: string): boolean {
  const editorEl = doc.getMap('elements').get(elementId) as Y.Map<unknown> | undefined;
  if (!editorEl) {
    return false;
  }
  const astroSource = editorEl.get('astroSource') as string | undefined;
  if (!astroSource) {
    return false;
  }

  const markup = applyAllOverrides(baseMarkup(doc, editorEl), editorEl);

  // ONE transaction for markup + every childOverrides mirror: the masters
  // persistence saver (400ms leading+trailing debounce) snapshots on each
  // observer batch — a two-transaction bake let a fast reload persist the
  // markup half while the childOverrides half rode the trailing write and
  // died with the page (red fill reverted to the previous bake).
  doc.transact(() => {
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource, markup });

    // Mirror each child instance's live classOverrides into the parent master's
    // per-placement childOverrides (task-098): merge per-selector over the
    // existing entry so other selectors' state survives. Children with no
    // overrides leave the entry untouched.
    doc.getMap('elements').forEach((value) => {
      const child = value as Y.Map<unknown>;
      if (child.get('pageId') !== COMPONENT_EDITOR_PAGE_ID) return;
      if (child.get('parentId') !== elementId) return;
      const placementKey = placementKeyOf(child);
      if (!placementKey) return;
      const serialized = serializeElementClassOverrides(child);
      if (Object.keys(serialized).length === 0) return;
      const existing = selectMasterChildOverrides(doc, astroSource)[placementKey] ?? {};
      applyCommand(doc, {
        type: 'SET_MASTER_CHILD_OVERRIDES',
        astroSource,
        placementKey,
        overrides: { ...existing, ...serialized },
      });
    });
  });
  return true;
}

/**
 * Mirror the editor's baked drawn set into the masters overlay (3-store law:
 * doc + masters overlay + .astro). Runs at editor-leave AFTER the .astro
 * drawnReconcile write landed, with the SAME `data-sq-drawn`-marked markups —
 * pages render layout/component chrome via baseMarkup (overlay-first), so
 * without this a master-drawn element never reached any page until the next
 * master open re-read the source (proven 2026-08-26). Idempotent: existing
 * marked elements are stripped before the current set is appended, so a
 * delete-to-zero ([]) removes the stale copy everywhere (C3).
 *
 * No-op when the overlay has no entry for this source — there is nothing for
 * pages to read yet, and inventing one from the frozen staticMarkup could
 * shadow a newer source.
 */
export function syncDrawnIntoMasterOverlay(
  doc: Y.Doc,
  astroSource: string,
  drawnMarkups: string[],
): boolean {
  const existing = selectMasterMarkup(doc, astroSource);
  if (existing === undefined) return false;
  const base = stripDrawnElements(existing);
  const markup = drawnMarkups.length > 0
    ? `${base.replace(/\s+$/, '')}\n${drawnMarkups.join('\n')}\n`
    : base;
  if (markup === existing) return false;
  applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource, markup });
  return true;
}
