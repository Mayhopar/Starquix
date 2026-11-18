import * as Y from 'yjs';
import { applyCommand, resetComponentEditorPage } from '@/store/commands';
import { buildAddCommand } from '@/store/addCommandFactory';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { emptyClassData } from '@/store/types';
import { generateId } from '@/utils/generateId';
import { seedMissingChildMasters } from '@/utils/ensureBlogPostMaster';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import type { ChildPlacement } from '@/utils/componentPlaceholders';

/**
 * Seed the component-editor page for an Assets open (extracted from
 * LeftSidebar.handleSelectComponent for headless testability, task-098):
 * sweep the previous editor page, create a fresh one, add the editor element,
 * then materialize every nested-component placement as a REAL child instance
 * element — selectable, override-able, pushable to its own master. The editor
 * element's staticMarkup keeps the `<sq-child>` placeholders; the canvas
 * composer splices the children in at their placement keys.
 *
 * NO seeding of child classOverrides: master-level per-placement state renders
 * via baseMarkup's childOverrides layering; a child's live classOverrides are
 * this-session divergence only.
 *
 * Runs in one `doc.transact(…, 'sync')`. Returns the editor element id.
 */
export function seedComponentEditorPage(
  doc: Y.Doc,
  args: {
    component: ScannedComponent;
    /** Resolved canvas html — placeholders already extracted. */
    html: string;
    placements: ChildPlacement[];
    /** Library for child staticMarkup lookup (frozen fallback base). */
    library: ScannedComponent[];
  },
): string {
  const { component, html, placements, library } = args;
  const elementId = generateId();

  doc.transact(() => {
    const pages = doc.getMap('pages');

    // Sweep every element tagged to the editor page (not just rootIds — drawn
    // slots, post wrappers, and instance children accumulate as orphans
    // otherwise). Unconditional: handleTopTabChange may have already deleted
    // the page but orphan elements can still live in the elements map.
    resetComponentEditorPage(doc);

    // Create the component page (directly in Yjs, not via ADD_PAGE, to avoid rootPages side effects)
    const yPage = new Y.Map();
    yPage.set('id', COMPONENT_EDITOR_PAGE_ID);
    yPage.set('name', component.name);
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(COMPONENT_EDITOR_PAGE_ID, yPage);

    // Add the component as the sole root element
    applyCommand(doc, buildAddCommand({
      elementId,
      pageId: COMPONENT_EDITOR_PAGE_ID,
      component,
      parentId: null,
      index: 0,
      staticMarkupOverride: html,
    }));

    // Materialize nested components as real child instance elements (mirrors
    // the pagination-child ADD_ELEMENT shape in instanceLifecycle.ts).
    placements.forEach((placement, i) => {
      const child = library.find((c) => c.path === placement.path);
      applyCommand(doc, {
        type: 'ADD_ELEMENT',
        element: {
          id: generateId(),
          pageId: COMPONENT_EDITOR_PAGE_ID,
          parentId: elementId,
          index: i,
          type: 'component',
          instanceType: 'local',
          componentType: placement.name,
          slotName: placement.slotFallback ?? '',
          placementKey: placement.placementKey,
          classes: emptyClassData(),
          staticMarkup: child?.html ?? '',
          astroSource: placement.path,
          classOverrides: {},
        },
      });
    });

    // The OPEN is a fresh resolve of the source — refresh THIS component's
    // master overlay to match. Without this a stale bake shadows the source
    // forever: baseMarkup prefers masters, and the auto-bake re-bakes FROM
    // baseMarkup, so a nav added to the source never appeared and a deleted
    // footer never left (live-caught; the session-long "purge masters" loop).
    // Safe because every master edit class now writes back to source on leave
    // (classes/text via write-back, adds via append, deletes via delete
    // selectors) — the source IS the durable truth at open time. task-118's
    // remap machinery migrates overrides across the markup change.
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: component.path, markup: html });

    // Seed a missing child master for every placement — see the helper's doc
    // (live-caught: Footer vanished from blog-post pages).
    seedMissingChildMasters(doc, placements.map((p) => p.path), library);

    // Switch to it
    applyCommand(doc, { type: 'SET_CURRENT_PAGE', pageId: COMPONENT_EDITOR_PAGE_ID });
  }, 'sync');

  return elementId;
}
