import * as Y from 'yjs';
import { COMPONENT_EDITOR_PAGE_ID } from '../constants';

/**
 * Idempotent self-heal: adopt orphan pages into rootPages. Before the
 * ADD_PAGE fix, the AI add_page tool wrote pages into the pages map without
 * a rootPages entry, so they existed in Yjs but never appeared in the Pages
 * tree. Any page that is neither in rootPages nor claimed as another page's
 * child gets appended to rootPages. The component-editor scratch page is
 * orphaned on purpose and stays out.
 */
export function adoptOrphanPages(doc: Y.Doc): void {
  const pages = doc.getMap('pages');
  if (pages.size === 0) return;

  const rootPages = doc.getArray<string>('rootPages');
  const claimed = new Set<string>(rootPages.toArray());
  pages.forEach((value) => {
    const children = (value as Y.Map<unknown>).get('children') as Y.Array<string> | undefined;
    children?.toArray().forEach(id => claimed.add(id));
  });

  const orphans: string[] = [];
  pages.forEach((_value, id) => {
    if (id !== COMPONENT_EDITOR_PAGE_ID && !claimed.has(id)) orphans.push(id);
  });
  if (orphans.length === 0) return;

  doc.transact(() => {
    rootPages.push(orphans);
  }, 'migration');
}
