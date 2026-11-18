/**
 * Folder organization for the Assets panel — a sidecar manifest, not a
 * derivation of the source files.
 *
 * WHY a manifest and not real directories: source keys are `path:line:col`, so
 * moving a .astro file would orphan every sourceClasses/sourceText overlay,
 * master binding and instance keyed on the old path, and would require
 * rewriting imports in every referencing page. Files never move.
 *
 * WHY folder ids are opaque and not the folder name: the old model used
 * `cat:<name>`, so renaming a folder changed its identity, and — combined with
 * the one-word `@category` regex — "Folder" and "Folder 2" collided.
 *
 * `@category` survives as a FALLBACK only: a component the manifest does not
 * mention is filed under its authored category, so components shipped by a
 * future release still land in the right place. The manifest records deltas.
 *
 * Design: docs/plans/2026-08-09-component-folders-redesign-design.md §2.
 */
import { isProjectCopyOf } from '@/utils/libraryThemes';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { orderCategories } from './categoryOrder';
import { isSystemComponentPath } from '@/utils/systemComponents';
import { localFetch } from '../utils/sqLocalBase';

export interface FolderNode {
  name: string;
  /** Ordered member ids: `f_*` (nested folder) or `comp:<path>` (component). */
  children: string[];
}

export interface FolderManifest {
  version: 1;
  /** Ordered top-level ids. */
  roots: string[];
  folders: Record<string, FolderNode>;
}

export const EMPTY_MANIFEST: FolderManifest = { version: 1, roots: [], folders: {} };

export type AssetItemKind = 'folder' | 'component';

export interface AssetItem {
  id: string;
  kind: AssetItemKind;
  name: string;
  children: string[];
  /** Present only when kind === 'component'. */
  component?: ScannedComponent;
}

export interface ResolvedTree {
  items: AssetItem[];
  rootIds: string[];
}

export function componentItemId(path: string): string {
  return `comp:${path}`;
}

export function isFolderId(id: string): boolean {
  return id.startsWith('f_');
}

/** Opaque, name-independent folder id. Collision odds are irrelevant at this scale. */
export function newFolderId(): string {
  return `f_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

/**
 * The runtime-aware manifest endpoints. The built-in library (no project path)
 * writes next to the components; a project writes a dotfile inside its folder.
 * Shared by useFolderManifest and the AI set_component_category tool so there
 * is exactly one place that knows the URL shape.
 */
export function folderManifestUrls(localPath: string | null): {
  get: string;
  post: string;
  body: (manifest: FolderManifest) => unknown;
  /** The transport for get/post: the local seam (localFetch) for a project,
   *  plain fetch for the built-in library. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
} {
  return {
    get: localPath ? `/__sq/local/folders?path=${encodeURIComponent(localPath)}` : '/__sq/folders',
    post: localPath ? '/__sq/local/folders' : '/__sq/folders',
    body: (manifest) => (localPath ? { path: localPath, manifest } : { manifest }),
    fetch: (url, init) => (localPath ? localFetch(url, init) : init === undefined ? fetch(url) : fetch(url, init)),
  };
}

/** Parse an unknown blob from disk into a manifest, or EMPTY_MANIFEST. */
export function parseManifest(raw: unknown): FolderManifest {
  if (!raw || typeof raw !== 'object') return EMPTY_MANIFEST;
  const obj = raw as Partial<FolderManifest>;
  if (obj.version !== 1) return EMPTY_MANIFEST;
  const folders: Record<string, FolderNode> = {};
  for (const [id, node] of Object.entries(obj.folders ?? {})) {
    if (!node || typeof node.name !== 'string') continue;
    folders[id] = {
      name: node.name,
      children: Array.isArray(node.children) ? node.children.filter((c) => typeof c === 'string') : [],
    };
  }
  return {
    version: 1,
    roots: Array.isArray(obj.roots) ? obj.roots.filter((r) => typeof r === 'string') : [],
    folders,
  };
}

/** Persistence reads must distinguish proven absence from corrupt content.
 * The tolerant parser above remains useful for explicitly optional imports. */
export function decodeFolderManifest(raw: unknown): FolderManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid folder manifest');
  const value = raw as Partial<FolderManifest>;
  if (value.version !== 1 || !Array.isArray(value.roots) || !value.roots.every(id => typeof id === 'string')
    || !value.folders || typeof value.folders !== 'object' || Array.isArray(value.folders)
    || !Object.values(value.folders).every(node => node && typeof node.name === 'string'
      && Array.isArray(node.children) && node.children.every(id => typeof id === 'string'))) throw new Error('Invalid folder manifest');
  return value as FolderManifest;
}

/**
 * The one component list both the Assets panel and the ⌘K picker resolve
 * against. Deduplicated by path; built-in wins over a same-path user component
 * (it carries the better category fallback), layouts win over both.
 *
 * `layouts` is OPTIONAL: the Assets panel deliberately passes none, because a
 * layout in this list is a folder-tree member — draggable, droppable-into, and
 * routed to component-rooted rename/delete endpoints. The ⌘K picker still
 * passes them; it only lists.
 */
export function mergeScannedComponents(
  builtIn: ScannedComponent[],
  userProject: ScannedComponent[],
  layouts: ScannedComponent[] = [],
): ScannedComponent[] {
  const byPath = new Map(userProject.map((c) => [c.path, c]));
  // A library component the user opened was COPIED into the project (owner
  // ruling 2026-08-27); both rows open that same copy, so the original is a
  // duplicate entry under the same name — list only the project's file.
  // Themed sections dedupe only against a copy of the SAME section + theme (a
  // project's Classic Hero must not hide Starquix Hero) — utils/libraryThemes.ts.
  // A built-in page template (BlogPost) is never listed: it imports the app's own
  // layout, so it can't be copied into a project and its row only answered with a
  // refusal (HN report 2026-11-09). A project's own post route is its real page.
  for (const c of builtIn) if (!c.pageTemplate && !userProject.some((u) => isProjectCopyOf(u, c))) byPath.set(c.path, c);
  for (const c of layouts) byPath.set(c.path, c);
  return Array.from(byPath.values());
}

/**
 * Categories hoisted to the root with no folder header (legacy behavior kept).
 */
const FLATTEN_TO_ROOT: readonly string[] = ['Uncategorized', ''];

/**
 * Fallback folders sorted before every other fallback folder. Page templates
 * are system sources whose edits propagate to every rendered route, so they
 * outrank user-authored components. Only applies to folders the manifest never
 * placed — an explicit manifest position always wins.
 */
const PINNED_FALLBACK_CATEGORIES: readonly string[] = ['Pages'];

/** Prefix of the ephemeral folder ids synthesized from an `@category` fallback. */
export const FALLBACK_FOLDER_PREFIX = 'fallback:';

export function isFallbackFolderId(id: string): boolean {
  return id.startsWith(FALLBACK_FOLDER_PREFIX);
}

/**
 * Resolve scanned components + manifest into the tree the panel renders.
 *
 * Order of precedence per component:
 *   1. listed in the manifest -> that position
 *   2. @category              -> a fallback folder appended after manifest roots
 *   3. neither                -> root
 *
 * Self-healing: members naming a missing file are dropped, references to
 * unknown folder ids are dropped, cycles are contained (a node is placed at the
 * FIRST position that reaches it and never re-entered), and a folder unreachable
 * from `roots` is surfaced at the root rather than silently lost.
 */
export function resolveFolderTree(
  components: ScannedComponent[],
  manifest: FolderManifest,
): ResolvedTree {
  const byPath = new Map(components.map((c) => [c.path, c]));
  const items: AssetItem[] = [];
  const placed = new Set<string>();

  const emitFolder = (id: string): string[] => {
    const node = manifest.folders[id];
    if (!node) return [];
    const kids: string[] = [];
    for (const childId of node.children) {
      if (placed.has(childId)) continue;
      if (isFolderId(childId)) {
        if (!manifest.folders[childId]) continue; // unknown folder id
        placed.add(childId);
        kids.push(childId);
        const grandKids = emitFolder(childId);
        items.push({ id: childId, kind: 'folder', name: manifest.folders[childId].name, children: grandKids });
      } else {
        const path = childId.slice('comp:'.length);
        const component = byPath.get(path);
        if (!component) continue; // file gone — self-heal
        placed.add(childId);
        kids.push(childId);
        items.push({ id: childId, kind: 'component', name: component.name, children: [], component });
      }
    }
    return kids;
  };

  const rootIds: string[] = [];

  for (const id of manifest.roots) {
    if (placed.has(id)) continue;
    if (isFolderId(id)) {
      if (!manifest.folders[id]) continue;
      placed.add(id);
      rootIds.push(id);
      const kids = emitFolder(id);
      items.push({ id, kind: 'folder', name: manifest.folders[id].name, children: kids });
    } else {
      const path = id.slice('comp:'.length);
      const component = byPath.get(path);
      if (!component) continue;
      placed.add(id);
      rootIds.push(id);
      items.push({ id, kind: 'component', name: component.name, children: [], component });
    }
  }

  // Folders declared but unreachable from roots — surface rather than lose.
  for (const [id, node] of Object.entries(manifest.folders)) {
    if (placed.has(id)) continue;
    placed.add(id);
    rootIds.push(id);
    const kids = emitFolder(id);
    items.push({ id, kind: 'folder', name: node.name, children: kids });
  }

  // Fallback pass: components the manifest never mentioned, grouped by @category.
  // A category naming an EXISTING manifest folder joins that folder instead of
  // minting a second folder with the same name (runtime-proven 2026-08-26: a
  // layout scanned in AFTER the manifest materialized produced a duplicate
  // "Layouts" folder → duplicate React keys in the ⌘K picker's category list).
  const manifestFolderByName = new Map<string, AssetItem>();
  for (const item of items) {
    if (item.kind === 'folder' && !manifestFolderByName.has(item.name)) {
      manifestFolderByName.set(item.name, item);
    }
  }
  const fallbackFolders = new Map<string, string[]>();
  for (const component of components) {
    const id = componentItemId(component.path);
    if (placed.has(id)) continue;
    placed.add(id);
    items.push({ id, kind: 'component', name: component.name, children: [], component });
    // Blog content is placed by WHAT IT IS, not by its authored @category: the
    // system Media ships as @category Media, and leaving it in that folder
    // would pull the folder's static siblings (Video) into Dynamic with it.
    // Flattening to the root keeps it visible under Dynamic with no folder of
    // its own and no siblings to drag along.
    const category = component.category || 'Uncategorized';
    if (isBlogContentComponent(component.path) || FLATTEN_TO_ROOT.includes(category)) {
      rootIds.push(id);
      continue;
    }
    const existing = manifestFolderByName.get(category);
    if (existing) {
      existing.children.push(id);
      continue;
    }
    fallbackFolders.set(category, [...(fallbackFolders.get(category) ?? []), id]);
  }

  // Anatomy order applies ONLY to the fallback group — an explicit manifest
  // position always wins. Both the panel and the ⌘K picker read this one tree,
  // so they can no longer disagree about ordering.
  const pinned = PINNED_FALLBACK_CATEGORIES.filter((n) => fallbackFolders.has(n));
  const rest = orderCategories(
    [...fallbackFolders.keys()].filter((n) => !PINNED_FALLBACK_CATEGORIES.includes(n)),
  );
  for (const name of [...pinned, ...rest]) {
    // Fallback folders are keyed by name — they are ephemeral by construction:
    // the moment you edit the tree, materializeTree writes a real f_* folder.
    const id = `${FALLBACK_FOLDER_PREFIX}${name}`;
    items.push({ id, kind: 'folder', name, children: fallbackFolders.get(name)! });
    rootIds.push(id);
  }

  return { items, rootIds };
}

/**
 * Components that render project DATA (a blog collection, a database table)
 * rather than authored markup. The Assets panel splits its roots on this so
 * the two kinds never read as one undifferentiated list.
 *
 * `@category` is one input among several (see isDynamicComponent) because it
 * already survives BOTH runtime scans — no new frontmatter marker, no runtime
 * branch. 'Layouts' is stamped by layoutToScannedComponent in both runtimes
 * (built-in `layouts/`, local `src/layouts/**`), never authored.
 * Design: docs/plans/2026-08-13-dynamic-components-representation-design.md
 */
const DYNAMIC_CATEGORIES: readonly string[] = ['Blog', 'Layouts'];

/**
 * The built-in catalog (virtual:built-in-components, `library/`-rooted) lists
 * the template Media at the library root. systemComponents.isSystemComponentPath
 * deliberately does not include this scanned shape: that predicate also drives
 * the System badge and the rename/delete lock, and this classification must
 * not alter what a user is allowed to edit. A project reaches the same
 * component through the sq/ prefix.
 */
const BUILT_IN_MEDIA_SCAN_PATHS: readonly string[] = ['library/Media.astro'];

/**
 * "Blog content" — the components the post editor's `/` menu inserts into a
 * post body. They render per-post data whatever @category the file carries,
 * which is why the user reads sq/ as dynamic.
 */
export function isBlogContentComponent(path: string | undefined): boolean {
  return isSystemComponentPath(path) || BUILT_IN_MEDIA_SCAN_PATHS.includes(path ?? '');
}

export function isDynamicComponent(component: ScannedComponent | undefined): boolean {
  if (!component) return false;
  if (isBlogContentComponent(component.path)) return true;
  // Page templates (BlogPost et al) render every route of their kind. The
  // pageTemplate field — not a 'Pages' category match — so a user component
  // merely tagged @category Pages doesn't false-positive.
  if (component.pageTemplate) return true;
  // Scan-side content-collection sniff — what classifies a local project's
  // marker-less components. Undefined (old scan payloads) reads as static.
  if (component.contentBound) return true;
  return DYNAMIC_CATEGORIES.includes(component.category);
}

/**
 * name/path lookup of the dynamic subset, for surfaces that identify a
 * component indirectly: Layers rows carry a componentType NAME (Yjs) or a
 * source-file PATH prefix (local mode), the DesignBar caption a name. ONE
 * index derived from the ONE predicate, so the yellow "dynamic" accent
 * (text-dynamic) can't drift between Assets, Layers, and captions.
 */
export interface DynamicComponentIndex {
  names: Set<string>;
  /** Lowercased names — for rows labeled with a LOWERCASED component tag
   *  (the `<layout>` master wrapper, layout-chrome nodes). */
  namesLower: Set<string>;
  paths: Set<string>;
}

export function buildDynamicComponentIndex(
  components: ScannedComponent[],
): DynamicComponentIndex {
  const names = new Set<string>();
  const namesLower = new Set<string>();
  const paths = new Set<string>();
  for (const c of components) {
    if (!isDynamicComponent(c)) continue;
    names.add(c.name);
    namesLower.add(c.name.toLowerCase());
    paths.add(c.path);
  }
  return { names, namesLower, paths };
}

/**
 * Reserved folder holding the components the USER forced into Dynamic.
 *
 * It is a REAL folder node, which is the whole point: every existing manifest
 * operation — planFolderMove, materializeTree, delete, undo — already handles
 * it, so forcing a section needed no schema field and no new plumbing. The
 * panel never paints its row; it paints the "Dynamic" header and hoists the
 * members to depth 0.
 */
export const DYNAMIC_FOLDER_ID = 'f_dynamic';

/** Add the reserved folder when it is missing, so a move can target it. */
export function ensureDynamicFolder(manifest: FolderManifest): FolderManifest {
  if (manifest.folders[DYNAMIC_FOLDER_ID]) return manifest;
  return {
    version: 1,
    roots: [...manifest.roots, DYNAMIC_FOLDER_ID],
    folders: { ...manifest.folders, [DYNAMIC_FOLDER_ID]: { name: 'Dynamic', children: [] } },
  };
}

/**
 * Split the resolved roots into the panel's Static and Dynamic sections.
 *
 * Two ways in: the user FORCED it (a member of DYNAMIC_FOLDER_ID) or the
 * content says so (a dynamic component, or a folder with any dynamic
 * descendant — a mixed folder surfaces under Dynamic rather than hiding a
 * data-bound component in Static).
 *
 * Recursion needs no cycle guard — resolveFolderTree places every id at most
 * once, so its output is acyclic by construction.
 */
export function partitionRoots(tree: ResolvedTree): {
  staticIds: string[];
  dynamicIds: string[];
  /** Members of the reserved folder — the only rows offering "Remove from Dynamic". */
  forcedIds: Set<string>;
} {
  const byId = new Map(tree.items.map((i) => [i.id, i]));
  const isDynamic = (id: string): boolean => {
    const item = byId.get(id);
    if (!item) return false;
    if (item.kind === 'component') return isDynamicComponent(item.component);
    return item.children.some(isDynamic);
  };

  const forced = byId.get(DYNAMIC_FOLDER_ID)?.children ?? [];
  const forcedIds = new Set(forced);

  const staticIds: string[] = [];
  const derived: string[] = [];
  for (const id of tree.rootIds) {
    if (id === DYNAMIC_FOLDER_ID) continue; // hoisted below, never a row
    (isDynamic(id) ? derived : staticIds).push(id);
  }
  return { staticIds, dynamicIds: [...forced, ...derived], forcedIds };
}

/**
 * Remove a folder and lift its members into the folder's OWN position in its
 * parent list. NO FILE IS DELETED — a folder is just a manifest node.
 * Unknown id returns the manifest unchanged (identity, so callers can bail).
 */
export function deleteFolder(manifest: FolderManifest, folderId: string): FolderManifest {
  const node = manifest.folders[folderId];
  if (!node) return manifest;

  const lift = (list: string[]): string[] => {
    const at = list.indexOf(folderId);
    if (at === -1) return list;
    return [...list.slice(0, at), ...node.children, ...list.slice(at + 1)];
  };

  const folders: Record<string, FolderNode> = {};
  for (const [id, n] of Object.entries(manifest.folders)) {
    if (id === folderId) continue;
    folders[id] = { name: n.name, children: lift(n.children) };
  }
  return { version: 1, roots: lift(manifest.roots), folders };
}

/**
 * Repoint a member id after the component FILE was renamed.
 *
 * Manifest members are `comp:<scanned path>`, so a rename changes the key. If
 * the old id were left behind, resolveFolderTree would drop it as a missing
 * file and the renamed component would fall back to its @category — i.e. it
 * would silently jump out of the folder you filed it in.
 *
 * Returns the SAME object when the id is absent, so callers can skip the write.
 */
export function repointComponentId(
  manifest: FolderManifest,
  fromId: string,
  toId: string,
): FolderManifest {
  if (fromId === toId) return manifest;
  let touched = false;
  const swap = (list: string[]) => list.map((c) => {
    if (c !== fromId) return c;
    touched = true;
    return toId;
  });
  const roots = swap(manifest.roots);
  const folders = Object.fromEntries(
    Object.entries(manifest.folders).map(([k, n]) => [k, { name: n.name, children: swap(n.children) }]),
  );
  return touched ? { version: 1, roots, folders } : manifest;
}

/**
 * Freeze the currently RESOLVED tree into the manifest so an edit taken from
 * the rendered rows means the same thing in the file.
 *
 * Every `fallback:<category>` folder becomes a real `f_*` folder, and the root
 * list becomes the visible root order. Both are required for correctness, not
 * tidiness: an insert index counted over rendered rows lands somewhere else in
 * a manifest that only records deltas, and dropping INTO an @category folder
 * would target a folder that exists nowhere but the resolver's output.
 *
 * Deliberate consequence: after the first organizing gesture the manifest
 * describes the whole current tree, not just your deltas. Components scanned
 * LATER are still unlisted, so they still file themselves by @category.
 *
 * Returns the id remapping so the caller can translate the ids it captured
 * from the rendered rows (a `fallback:` id it was dragging or dropping onto).
 */
export function materializeTree(
  manifest: FolderManifest,
  tree: ResolvedTree,
): { manifest: FolderManifest; idMap: Map<string, string> } {
  const idMap = new Map<string, string>();
  const folders: Record<string, FolderNode> = {};

  for (const item of tree.items) {
    if (item.kind !== 'folder') continue;
    let id = item.id;
    if (isFallbackFolderId(id)) {
      id = newFolderId();
      idMap.set(item.id, id);
    }
    folders[id] = { name: item.name, children: [...item.children] };
  }

  for (const node of Object.values(folders)) {
    node.children = node.children.map((c) => idMap.get(c) ?? c);
  }

  return {
    manifest: { version: 1, roots: tree.rootIds.map((id) => idMap.get(id) ?? id), folders },
    idMap,
  };
}
