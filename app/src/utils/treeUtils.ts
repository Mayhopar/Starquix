// app/src/utils/treeUtils.ts
/**
 * Tree utilities for element navigation
 * Shared between SelectionContext and ElementsTree
 */

import type { ScannedElement } from '@/context/SelectionContext';
import type { ContainerLayout } from '@/bridge/types';
import { isWrapperKey } from '@/store/keyKind';

// ============================================================================
// Types
// ============================================================================

export interface TreeNode {
  key: string;
  displayName: string;
  tagName: string;
  layout?: ContainerLayout;
  elementId: string;
  slotId?: string;
  /** Component name from the bridge (filled drawn-slot first child). */
  componentName?: string;
  /** Layout slot name when this node is a layout slot ('' = default). Present ⇒
   *  render as a slot (label "slot", slot icon) even when the filled slot is a div. */
  slotName?: string;
  children: TreeNode[];
  depth: number;
}

// ============================================================================
// Tree Building
// ============================================================================

/**
 * Build tree nodes from flat scanned elements using parentKey relationships
 */
/**
 * Editor infrastructure the preview injects (the HMR write channel, the
 * component/post view shells). They are real components in the rendered DOM, so
 * the scan reports them — but they belong to the editor, not to the user's
 * file, and a layout master showed `SqHmrWriteBridge` as a row beside <slot>
 * (wearing the layout's own name, since a mother-entity child inherits it).
 * Matched by exact tag so a user component like "square" is never hidden.
 */
const EDITOR_INFRA_TAGS = new Set([
  'sqhmrwritebridge',
  'sqcomponentview',
  'sqpostview',
  'sqstubcontent',
]);

export function isEditorInfraTag(tagName: string | null | undefined): boolean {
  return !!tagName && EDITOR_INFRA_TAGS.has(tagName.toLowerCase());
}

/** `labelOf` names a node by meaning (a card element → its field); null = tag/component name. */
export function buildTreeFromScannedElements(input: ScannedElement[], labelOf?: (el: ScannedElement) => string | null): TreeNode[] {
  const elements = input.filter((el) => !isEditorInfraTag(el.tagName));
  if (elements.length === 0) return [];

  // Deduplicate by key — keep first occurrence so each key has exactly one parentKey.
  // Without this, duplicate keys with different parentKeys create multi-parent diamonds
  // that the depth-first traversal misreports as cycles.
  const dedupedElements: ScannedElement[] = [];
  const seenKeys = new Set<string>();
  for (const el of elements) {
    if (!seenKeys.has(el.key)) {
      seenKeys.add(el.key);
      dedupedElements.push(el);
    }
  }

  // Create tree nodes
  const nodeMap = new Map<string, TreeNode>();
  dedupedElements.forEach(el => {
    // Extract element ID from source key (e.g., "elem-abc123:1:1" -> "elem-abc123")
    const elementId = el.key.split(':')[0];
    nodeMap.set(el.key, {
      key: el.key,
      // A layout slot keeps its "slot" identity even when filled (rendered as a
      // <div data-sq-slot>), so it doesn't read as a confusing "div" in Layers.
      displayName: el.slotName !== undefined ? 'slot' : (labelOf?.(el) ?? el.componentName ?? el.tagName),
      tagName: el.tagName,
      layout: el.layout,
      elementId,
      componentName: el.componentName,
      slotName: el.slotName,
      children: [],
      depth: 0,
    });
  });

  // Build parent-child relationships
  const rootNodes: TreeNode[] = [];
  dedupedElements.forEach(el => {
    const node = nodeMap.get(el.key)!;
    // Skip self-references (element is its own parent)
    if (el.parentKey === el.key) {
      rootNodes.push(node);
      return;
    }
    if (el.parentKey && nodeMap.has(el.parentKey)) {
      const parent = nodeMap.get(el.parentKey)!;
      if (parent !== node) {
        parent.children.push(node);
      } else {
        rootNodes.push(node);
      }
    } else {
      rootNodes.push(node);
    }
  });

  // Auto-unwrap the infrastructure container (the preview shell's own div):
  // it belongs to the editor's page shell, never to the user's file, so its
  // children take its place among the roots. Guarding on "single root" left it
  // visible the moment anything else scanned as a root — inserting a component
  // into a layout master put its tag beside the shell, and the panel grew a
  // `div` row wrapping <slot> that has no counterpart in the .astro.
  const effectiveRoots: TreeNode[] = [];
  for (const root of rootNodes) {
    if (isWrapperKey(root.key)) effectiveRoots.push(...root.children);
    else effectiveRoots.push(root);
  }

  // Calculate depths recursively (with silent cycle guard)
  const visited = new Set<string>();
  function setDepths(nodes: TreeNode[], depth: number) {
    nodes.forEach(node => {
      if (visited.has(node.key)) return; // Already visited — skip silently
      visited.add(node.key);
      node.depth = depth;
      setDepths(node.children, depth + 1);
    });
  }
  setDepths(effectiveRoots, 0);

  return effectiveRoots;
}

// ============================================================================
// Local layout derivation
// ============================================================================

const LOCAL_LAYOUT_FILE_RE = /^src\/layouts\/([^/:]+)\.astro$/i;

/**
 * Local mode: the page's applied layout is not a doc association — the user's
 * own file wraps the page (`<Main>…</Main>`), Astro inlines it, and the scan
 * reports the layout's top-level tags as sibling roots. Derive the layout
 * identity back from the scan so the Layers tree can present the authored
 * nesting (one Layout node wrapping the page), same as the WC layoutName path.
 *
 * An element belongs to a layout when its DEFINING file is src/layouts/*
 * (elements authored in the layout file). Components the layout instantiates
 * carry the layout file in `usageLocation` instead. Either signal proves the
 * page renders that layout.
 *
 * ponytail: first layout file wins; a page whose markup escapes its layout tag
 * would still be wrapped whole — acceptable until a real site hits it.
 */
export function deriveLocalLayout(
  elements: ScannedElement[],
): { name: string; file: string } | null {
  for (const el of elements) {
    const m =
      (el.sourceLocation && LOCAL_LAYOUT_FILE_RE.exec(el.sourceLocation.file)) ||
      (el.usageLocation && LOCAL_LAYOUT_FILE_RE.exec(el.usageLocation.file));
    if (m) return { name: m[1], file: m[0] };
  }
  return null;
}

/** THE app-side "is this a local layout file" shape — one regex, shared by
 *  tree derivation and the DesignBar page-side gate. Returns the layout's
 *  display name, or null for anything else. */
export function parseLocalLayoutName(file: string | null | undefined): string | null {
  return file ? (LOCAL_LAYOUT_FILE_RE.exec(file)?.[1] ?? null) : null;
}

/**
 * Component view of a layout: the Assets row above the nested tree already IS
 * the layout, so repeating the scanned <body> as a name-wearing row nested a
 * phantom "Layout inside Layout" (owner report 2026-08-27 — the local twin of
 * the WC master-tree fix cc00224d). Lift the body's children flat when the
 * viewed file IS the body's own file. Page trees (viewedFile null) keep the
 * body row — there it is the Layout node (layout-element paradigm).
 */
export function liftLayoutBodyForComponentView(
  nodes: TreeNode[],
  bodyKey: string,
  bodyFile: string | undefined,
  viewedFile: string | null | undefined,
): TreeNode[] | null {
  if (!viewedFile || bodyFile !== viewedFile) return null;
  const idx = nodes.findIndex((n) => n.key === bodyKey);
  if (idx === -1) return null;
  const body = nodes[idx];
  const lifted = [...nodes.slice(0, idx), ...body.children, ...nodes.slice(idx + 1)];
  const dec = (list: TreeNode[]) => { for (const n of list) { n.depth = Math.max(0, n.depth - 1); dec(n.children); } };
  dec(body.children);
  return lifted;
}

/** The scanned layout-owned <body> root, when the bridge reported one
 *  (layout-element paradigm 2026-08-24). Present ⇒ the Layout row is THIS real
 *  element and no synthetic layoutchrome node is minted. */
export function findLocalLayoutBodyRoot(elements: ScannedElement[]): ScannedElement | null {
  return elements.find(
    (el) => el.tagName === 'body' && el.parentKey === null &&
      !!el.sourceLocation && LOCAL_LAYOUT_FILE_RE.test(el.sourceLocation.file),
  ) ?? null;
}

/** THE root of a viewed master file (component/layout view): the scanned
 *  layout <body> when it belongs to that file, else the file's first
 *  top-level element, else its first element in document order. ONE
 *  predicate for "select the master's root" (pending-select on open) and
 *  "is the master row selected" (AssetsPanel) — two would drift. */
export function viewRootKey(viewedFile: string | null, elements: ScannedElement[]): string | null {
  if (!viewedFile) return null;
  const body = findLocalLayoutBodyRoot(elements);
  if (body?.sourceLocation?.file === viewedFile) return body.key;
  const prefix = `${viewedFile}:`;
  return (
    elements.find((el) => el.parentKey === null && el.key.startsWith(prefix)) ??
    elements.find((el) => el.key.startsWith(prefix))
  )?.key ?? null;
}

// ============================================================================
// Navigation Helpers
// ============================================================================

/**
 * Find a node by key in the tree (recursive)
 */
export function findNode(targetKey: string, nodes: TreeNode[]): TreeNode | null {
  for (const node of nodes) {
    if (node.key === targetKey) return node;
    const found = findNode(targetKey, node.children);
    if (found) return found;
  }
  return null;
}

/**
 * Find siblings of a node at the same level
 * Returns { prev, next, siblings } where prev/next are adjacent siblings or null
 */
export function findSiblings(
  targetKey: string,
  treeNodes: TreeNode[],
  scannedElements: ScannedElement[]
): { prev: TreeNode | null; next: TreeNode | null; siblings: TreeNode[] } {
  // Get parent key from scanned elements
  const targetElement = scannedElements.find(el => el.key === targetKey);
  const parentKey = targetElement?.parentKey ?? null;

  // Find the sibling list (either root nodes or parent's children)
  let siblingList: TreeNode[] = [];

  if (parentKey === null) {
    // Target is at root level
    siblingList = treeNodes;
  } else {
    // Find parent and get its children
    const parent = findNode(parentKey, treeNodes);
    if (parent) {
      siblingList = parent.children;
    } else {
      // Parent not found in tree - this happens when the infrastructure container
      // (e.g., [pageId].astro) is auto-unwrapped. In this case, the effective roots
      // are the siblings of the target.
      // Check if target is in the root nodes (which are unwrapped children)
      const isEffectiveRoot = treeNodes.some(n => n.key === targetKey);
      if (isEffectiveRoot) {
        siblingList = treeNodes;
      }
    }
  }

  // Find current index in sibling list
  const currentIndex = siblingList.findIndex(n => n.key === targetKey);
  if (currentIndex === -1) {
    return { prev: null, next: null, siblings: [] };
  }

  return {
    prev: currentIndex > 0 ? siblingList[currentIndex - 1] : null,
    next: currentIndex < siblingList.length - 1 ? siblingList[currentIndex + 1] : null,
    siblings: siblingList
  };
}

/** Pre-order keys of the rows the Layers panel actually renders —
 *  children of collapsed nodes are not visible and never join a range. */
export function flattenVisibleKeys(nodes: TreeNode[], expandedNodes: Set<string>): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      out.push(n.key);
      if (n.children.length > 0 && expandedNodes.has(n.key)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Get parent key for an element
 */
export function getParentKey(
  targetKey: string,
  scannedElements: ScannedElement[]
): string | null {
  const element = scannedElements.find(el => el.key === targetKey);
  return element?.parentKey ?? null;
}
