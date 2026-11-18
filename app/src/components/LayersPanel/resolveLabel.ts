/**
 * Resolve the displayed label for a layers-panel row.
 *
 * Component names ("BlogSlot", "Header", …) come from Yjs `componentType`
 * keyed by elementId. The elementId is the part of a data-key before the
 * first `:` (e.g. `el-x:section-0` → `el-x`). EVERY keyed descendant of an
 * instance therefore shares the same elementId — so blindly looking up
 * componentTypeById[node.elementId] used to label every internal piece
 * ("section", "div", "slot", "h2", …) with the parent's component name,
 * producing the "BlogSlot → BlogSlot → BlogSlot → BlogCard → BlogCard …"
 * ladders the user reported.
 *
 * Rule:
 * - **Instance root** (`node.key === node.elementId`, no `:tag-N` suffix):
 *   show the Yjs componentType if set, otherwise componentName / tagName.
 * - **Instance child** (data-key has a tag suffix): show the actual tag
 *   name. Never inherit the parent's componentType.
 * - **Post-root** (special case for blog card clones registered by the
 *   bridge): show the post root's label (defaults to "BlogCard").
 */

export interface ResolveLabelArgs {
  nodeKey: string;
  nodeElementId: string;
  nodeDisplayName: string;
  nodeComponentName: string | undefined;
  componentTypeById: Record<string, string>;
  postRootKeys: Set<string>;
  postRootLabels: Record<string, string>;
  blogCardComponentName: string;
  /** The instance's ONE rendered root row (ElementsTree motherEntityKeys) —
   *  labels as the componentType even though its key carries a tag suffix
   *  (the inserted BlogPost's outermost <Layout> tag read as a bare "layout"
   *  row, inviting confusion with the actual Layout chrome — 2026-08-26). */
  isMotherEntity?: boolean;
  /** The row's HTML tag — a slot never wears the owner's component name. */
  nodeTagName?: string;
}

export interface ResolveLabelResult {
  displayLabel: string;
  isInstanceRoot: boolean;
  componentTypeLabel: string | undefined;
}

export function resolveLayerLabel(args: ResolveLabelArgs): ResolveLabelResult {
  const {
    nodeKey,
    nodeElementId,
    nodeDisplayName,
    nodeComponentName,
    componentTypeById,
    postRootKeys,
    postRootLabels,
    blogCardComponentName,
  } = args;

  const isInstanceRoot = nodeKey === nodeElementId;
  // A <slot> keeps its own identity, never the owner's component name. In a
  // layout master the slot is a mother-entity child, so it took the layout's
  // name and the tree read "Layout ▸ Layout" — a nesting level that does not
  // exist in the .astro, where <slot /> is a plain child of the layout body.
  const isSlotRow = nodeDisplayName === 'slot' || /^slot\b/.test(args.nodeTagName ?? '');
  const componentTypeLabel = !isSlotRow && (isInstanceRoot || args.isMotherEntity)
    ? componentTypeById[nodeElementId]
    : undefined;

  const displayLabel = postRootKeys.has(nodeKey)
    ? (postRootLabels[nodeKey] ?? blogCardComponentName)
    : (componentTypeLabel ?? nodeComponentName ?? nodeDisplayName);

  return { displayLabel, isInstanceRoot, componentTypeLabel };
}

/** task-142: local-mode component subtree ROOT — the row's key lives in a
 *  component/layout file and the parent row is in a DIFFERENT file (the usage
 *  site). Returns the component display name for the purple treatment, or
 *  null. Same-file internals stay plain rows, mirroring the WC instance rule. */
export function localComponentRootName(
  key: string | null | undefined,
  parentKey: string | null | undefined,
  /** The file whose tree is being VIEWED (component editor) — its own rows
   *  are internals, never component roots, even at the tree top level. */
  viewedFile?: string | null,
): string | null {
  const file = localComponentRootFile(key, parentKey, viewedFile);
  return file ? file.split('/').pop()!.replace(/\.astro$/i, '') : null;
}

/** The root's source FILE (e.g. `src/components/Foo.astro`) — exact-matches
 *  the local scan's `ScannedComponent.path`, which is how a local row joins
 *  the library (dynamic accent). Same root rule as localComponentRootName. */
export function localComponentRootFile(
  key: string | null | undefined,
  parentKey: string | null | undefined,
  viewedFile?: string | null,
): string | null {
  const fileOf = (k: string | null | undefined): string | null => {
    const m = k?.match(/^(src\/(?:components|layouts)\/[^:]+?\.astro):\d+:\d+/i);
    return m ? m[1] : null;
  };
  const file = fileOf(key);
  if (!file || fileOf(parentKey) === file) return null;
  if (viewedFile && file === viewedFile) return null;
  return file;
}
