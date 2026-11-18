import * as Y from 'yjs';

/**
 * One-time, idempotent migration: drop the dead `page.layoutMasterVersion` key.
 *
 * The bespoke layout-version tracking (page.layoutMasterVersion +
 * SET_PAGE_LAYOUT_VERSION) is replaced by the derived layout-chrome element's
 * `masterVersion`, which reuses the component-instance reload lifecycle. This
 * removes the leftover page-level key so nothing reads stale data. Idempotent
 * because no page carries the key after the first run.
 */
export function dropLayoutMasterVersion(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  doc.transact(() => {
    pages.forEach((value) => {
      const page = value as Y.Map<unknown>;
      if (page.get('layoutMasterVersion') !== undefined) {
        page.delete('layoutMasterVersion');
      }
    });
  }, 'migration');
}
