/**
 * Assets → **Blog** section (owner 2026-10-10): every card + the shared blog
 * pieces (the project's `Blog` category folder: BlogSlot, pagination) — no
 * folder per collection. A card belongs to no collection here: any listing
 * can render any card. Folders inside the section are the user's own notes —
 * real folders under the `Blog` folder, written to the manifest like any
 * other move; they bind nothing. A RENDER overlay: cards that sit outside the
 * `Blog` folder are shown at the section's top level (never written there).
 */
import type { ResolvedTree } from '@/store/folderManifest';
import type { CardAssignment } from '@/utils/cardAssignment';

export interface BlogSectionView extends ResolvedTree {
  /** The Blog section's top-level ids (the Blog folder's children, then loose cards) — also the tail of rootIds. */
  blogIds: string[];
  /** The manifest folder the section shows (null = the project has none yet). */
  blogFolderId: string | null;
}

export function overlayBlogSection(tree: ResolvedTree, { assignments }: { assignments: ReadonlyMap<string, CardAssignment> }): BlogSectionView {
  const blogFolder = tree.items.find((i) => i.kind === 'folder' && i.name.toLowerCase() === 'blog');
  const byId = new Map(tree.items.map((i) => [i.id, i]));
  const inBlog = new Set<string>();
  const walk = (id: string) => { for (const c of byId.get(id)?.children ?? []) if (!inBlog.has(c)) { inBlog.add(c); walk(c); } };
  if (blogFolder) walk(blogFolder.id);
  const loose = [...assignments].filter(([, a]) => a.card).map(([f]) => `comp:${f}`).filter((id) => byId.has(id) && !inBlog.has(id));
  if (!blogFolder && !loose.length) return { ...tree, blogIds: [], blogFolderId: null };

  const pulled = new Set(loose);
  const blogIds = [...(blogFolder?.children ?? []), ...loose];
  const items = tree.items
    .filter((i) => i !== blogFolder)
    .map((i) => (i.kind === 'folder' ? { ...i, children: i.children.filter((c) => !pulled.has(c)) } : i));
  const rootIds = [...tree.rootIds.filter((r) => r !== blogFolder?.id && !pulled.has(r)), ...blogIds];
  return { items, rootIds, blogIds, blogFolderId: blogFolder?.id ?? null };
}
