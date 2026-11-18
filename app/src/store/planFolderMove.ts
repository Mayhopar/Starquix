/**
 * Group move inside the folder manifest — the file-tree sibling of
 * planGroupMove (store/multiSelectMove.ts), sharing its pruneDescendants and
 * its two hard-won rules:
 *   1. a selected node's own descendants never move independently — they ride
 *      along with their ancestor, or they would be moved twice
 *   2. the block lands in TREE order, not click order, so a multi-select drag
 *      preserves what the user saw
 *
 * Pure: manifest in, new manifest out, input never mutated (the caller keeps
 * the previous object as the undo payload).
 */
import { pruneDescendants } from './multiSelect';
import { isFolderId, type FolderManifest } from './folderManifest';

export interface FolderMoveTarget {
  /** null = the root list. */
  targetFolderId: string | null;
  insertIndex: number;
}

export function planFolderMove(
  manifest: FolderManifest,
  args: { selectedIds: string[] } & FolderMoveTarget,
): FolderManifest {
  const { selectedIds, targetFolderId, insertIndex } = args;
  if (selectedIds.length === 0) return manifest;

  // parent lookup over the manifest
  const parentOf = new Map<string, string | null>();
  for (const id of manifest.roots) parentOf.set(id, null);
  for (const [fid, node] of Object.entries(manifest.folders)) {
    for (const child of node.children) parentOf.set(child, fid);
  }
  const getParent = (id: string) => parentOf.get(id);

  // Guard: a folder may not move into itself or its own descendant.
  if (targetFolderId) {
    let cursor: string | null | undefined = targetFolderId;
    const seen = new Set<string>();
    while (cursor != null && !seen.has(cursor)) {
      if (selectedIds.includes(cursor)) return manifest;
      seen.add(cursor);
      cursor = getParent(cursor);
    }
  }

  const pruned = pruneDescendants(selectedIds.map((id) => ({ key: id, elementId: null })), getParent)
    .map((e) => e.key);
  if (pruned.length === 0) return manifest;

  // Tree order: depth-first over roots.
  const order: string[] = [];
  const walk = (ids: string[], seen: Set<string>) => {
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      if (isFolderId(id)) walk(manifest.folders[id]?.children ?? [], seen);
    }
  };
  walk(manifest.roots, new Set());
  const rank = new Map(order.map((id, i) => [id, i]));
  const moving = [...pruned].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));

  // Deep clone, then detach and re-insert.
  const next: FolderManifest = {
    version: 1,
    roots: [...manifest.roots],
    folders: Object.fromEntries(
      Object.entries(manifest.folders).map(([id, n]) => [id, { name: n.name, children: [...n.children] }]),
    ),
  };

  const movingSet = new Set(moving);
  next.roots = next.roots.filter((id) => !movingSet.has(id));
  for (const node of Object.values(next.folders)) {
    node.children = node.children.filter((id) => !movingSet.has(id));
  }

  const list = targetFolderId ? next.folders[targetFolderId]?.children : next.roots;
  if (!list) return manifest; // unknown target folder
  const at = Math.max(0, Math.min(insertIndex, list.length));
  list.splice(at, 0, ...moving);

  return next;
}
