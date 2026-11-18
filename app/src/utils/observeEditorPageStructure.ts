import * as Y from 'yjs';

/**
 * Schedules `onChange` whenever an element on the editor page is added,
 * removed, or mutated — excluding the editor element itself, which has its
 * own (narrower) observer. Used by the component-editor auto-flush in
 * LeftSidebar: structural edits the user makes inside the editor (drawing
 * slots, filling them, adding drawn sections) land on OTHER elements on
 * the editor page, and `pushAndPropagateChanges` already bakes those into
 * source via `selectPageDrawnElements`. Without this trigger the flush
 * never fires for drawn-element edits and the changes silently fail to
 * reach the `.astro` source file.
 */
export function observeEditorPageStructure(
  doc: Y.Doc,
  editorPageId: string,
  editorElementId: string,
  onChange: () => void,
): () => void {
  const elementsMap = doc.getMap('elements');
  const isOnEditorPage = (id: string | null | undefined): boolean => {
    if (!id) return false;
    const yEl = elementsMap.get(id) as Y.Map<unknown> | undefined;
    return yEl?.get('pageId') === editorPageId;
  };
  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const ev of events) {
      if (ev.path.length === 0) {
        // Top-level change to the elements map: an element was added or
        // removed. Adds we can check by pageId; deletes can't be re-inspected
        // post-hoc so we treat them as relevant — removing a drawn element
        // should still flush the remaining state.
        let relevant = false;
        ev.changes.keys.forEach((change, key) => {
          if (change.action === 'add' && isOnEditorPage(key)) relevant = true;
          else if (change.action === 'delete') relevant = true;
        });
        if (relevant) { onChange(); return; }
      } else {
        const id = typeof ev.path[0] === 'string' ? (ev.path[0] as string) : null;
        if (id && id !== editorElementId && isOnEditorPage(id)) {
          onChange();
          return;
        }
      }
    }
  };
  elementsMap.observeDeep(handler);
  return () => elementsMap.unobserveDeep(handler);
}
