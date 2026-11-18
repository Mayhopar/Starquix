import * as Y from 'yjs';
import { isLayoutPath } from '@/utils/astroAssetPaths';

/** `layouts/Marketing.astro` → `Marketing` (case-preserving, mirrors generateAstro). */
function extractComponentName(path: string): string {
  const fileName = path.split('/').pop() || path;
  return fileName.replace(/\.[^.]+$/, '');
}

/**
 * One-time, idempotent migration from the legacy "layout = synthetic instance
 * root with content reparented under it" model to the page-level model:
 * `page.layoutName` + flat content roots.
 *
 * For each page, find a root element whose `astroSource` is a layout path. If
 * found: set `page.layoutName`, lift that element's children back to page roots
 * (in order, clearing each child's `parentId`, preserving `slotName`), and
 * delete the synthetic layout element. Running again is a no-op because no
 * layout-pathed root remains.
 */
export function migrateLayoutToPageLevel(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  const elements = doc.getMap('elements');

  doc.transact(() => {
    pages.forEach((value) => {
      const page = value as Y.Map<unknown>;
      const rootIds = page.get('rootElementIds') as Y.Array<string> | undefined;
      if (!rootIds) return;

      const roots = rootIds.toArray();
      const layoutId = roots.find((id) => {
        const el = elements.get(id) as Y.Map<unknown> | undefined;
        return isLayoutPath(el?.get('astroSource') as string | null | undefined);
      });
      if (!layoutId) return;

      const layoutEl = elements.get(layoutId) as Y.Map<unknown> | undefined;
      const src = layoutEl?.get('astroSource') as string | undefined;
      if (src) page.set('layoutName', extractComponentName(src));

      // Collect the layout's children in index order; they become page roots.
      const childIds: string[] = [];
      elements.forEach((cValue, cId) => {
        const cEl = cValue as Y.Map<unknown>;
        if ((cEl.get('parentId') as string | null | undefined) === layoutId) {
          childIds.push(cId);
        }
      });
      childIds.sort((a, b) => {
        const ai = (elements.get(a) as Y.Map<unknown>).get('index') as number | undefined;
        const bi = (elements.get(b) as Y.Map<unknown>).get('index') as number | undefined;
        return (ai ?? 0) - (bi ?? 0);
      });

      // Clear each lifted child's parentId (slotName preserved untouched).
      for (const cId of childIds) {
        (elements.get(cId) as Y.Map<unknown>).delete('parentId');
      }

      // Replace the layout id in rootElementIds with the lifted children, in place.
      const layoutIdx = rootIds.toArray().indexOf(layoutId);
      if (layoutIdx !== -1) {
        rootIds.delete(layoutIdx, 1);
        if (childIds.length > 0) rootIds.insert(layoutIdx, childIds);
      }

      // Delete the synthetic layout element.
      elements.delete(layoutId);
    });
  }, 'migration');
}
