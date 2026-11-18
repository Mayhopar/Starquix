import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import type { AssetItem, ResolvedTree } from '@/store/folderManifest';

export type PickerCategory =
  | { kind: 'library'; name: string; components: ScannedComponent[] }
  | { kind: 'theme'; name: string; themeId: string };

/**
 * Single source for the Components-tab left column.
 *
 * Reads the SAME resolved folder tree the Assets panel renders, so the two can
 * no longer disagree about names or order (they used to: the panel derived
 * folders from @category while the picker re-derived its own list). The left
 * column stays a FLAT list — the tree is flattened depth-first with the label
 * of a nested folder joined by ' / ' ("Marketing pages / Heroes") — which is
 * why the modal's keyboard navigation needed no changes at all.
 *
 * Order is the tree's order: explicit manifest position first, then the
 * @category fallback folders in anatomy order (resolveFolderTree owns that).
 * Root-level components with no folder land in 'Uncategorized', last.
 * Theme categories are appended after everything, unchanged.
 */
export function buildPickerCategories(args: {
  tree: ResolvedTree;
  themes: Array<{ _id: string; name: string }>;
}): PickerCategory[] {
  const { tree, themes } = args;
  const byId = new Map(tree.items.map((i) => [i.id, i]));
  const out: PickerCategory[] = [];
  const loose: ScannedComponent[] = [];

  const componentsOf = (item: AssetItem): ScannedComponent[] =>
    item.children
      .map((id) => byId.get(id))
      .filter((c): c is AssetItem => c?.kind === 'component' && !!c.component)
      .map((c) => c.component!);

  const emitFolder = (item: AssetItem, prefix: string): void => {
    const label = prefix ? `${prefix} / ${item.name}` : item.name;
    const components = componentsOf(item);
    // An empty folder has nothing to pick — it exists in the panel, not here.
    if (components.length > 0) out.push({ kind: 'library', name: label, components });
    for (const childId of item.children) {
      const child = byId.get(childId);
      if (child?.kind === 'folder') emitFolder(child, label);
    }
  };

  for (const id of tree.rootIds) {
    const item = byId.get(id);
    if (!item) continue;
    if (item.kind === 'folder') emitFolder(item, '');
    else if (item.component) loose.push(item.component);
  }

  if (loose.length > 0) out.push({ kind: 'library', name: 'Uncategorized', components: loose });
  for (const t of themes) out.push({ kind: 'theme', name: t.name, themeId: t._id });
  return out;
}
