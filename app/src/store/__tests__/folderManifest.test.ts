// Regression tests for the three reported folder bugs (2026-08-09).
// Causes: @category read/written as \w+ (one word) collapsed "Folder"/"Folder 2";
// empty folders lived only in React state; buildAssetTree was hard-coded two-level.
import { describe, it, expect } from 'vitest';
import { mergeScannedComponents, resolveFolderTree, materializeTree, deleteFolder, repointComponentId, partitionRoots, ensureDynamicFolder, isDynamicComponent, buildDynamicComponentIndex, DYNAMIC_FOLDER_ID, EMPTY_MANIFEST, type FolderManifest } from '../folderManifest';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

function comp(name: string, category = 'Uncategorized', pageTemplate: string | null = null): ScannedComponent {
  return {
    name,
    path: `library/${name}.astro`,
    source: 'built-in',
    html: '',
    category,
    props: [],
    slots: [],
    dependencies: [],
    pageTemplate,
  };
}

/** Convenience: the item ids under a folder, by folder name. */
function childrenOf(tree: ReturnType<typeof resolveFolderTree>, folderName: string): string[] {
  const folder = tree.items.find((i) => i.kind === 'folder' && i.name === folderName);
  return folder ? folder.children : [];
}

describe('resolveFolderTree — fallbacks', () => {
  it('files an unlisted component under its @category', () => {
    const tree = resolveFolderTree([comp('Hero', 'Hero')], EMPTY_MANIFEST);
    expect(childrenOf(tree, 'Hero')).toEqual(['comp:library/Hero.astro']);
  });

  it('puts an uncategorized component at the root', () => {
    const tree = resolveFolderTree([comp('Loose')], EMPTY_MANIFEST);
    expect(tree.rootIds).toContain('comp:library/Loose.astro');
  });

  it('lets the manifest override @category', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_1'],
      folders: { f_1: { name: 'Mine', children: ['comp:library/Hero.astro'] } },
    };
    const tree = resolveFolderTree([comp('Hero', 'Hero')], manifest);
    expect(childrenOf(tree, 'Mine')).toEqual(['comp:library/Hero.astro']);
    // and it is NOT also under the @category folder
    expect(tree.items.some((i) => i.kind === 'folder' && i.name === 'Hero')).toBe(false);
  });
});

describe('resolveFolderTree — the three reported bugs', () => {
  // BUG 1 — "I put many components into my folder and then it resets".
  // @category is read as /@category\s+(\w+)/, so "Folder 2" read back as "Folder"
  // and every folder's members merged into one.
  it('keeps two similarly-named folders distinct across a resolve cycle', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_a', 'f_b'],
      folders: {
        f_a: { name: 'Folder', children: ['comp:library/A.astro'] },
        f_b: { name: 'Folder 2', children: ['comp:library/B.astro'] },
      },
    };
    const tree = resolveFolderTree([comp('A'), comp('B')], manifest);
    expect(childrenOf(tree, 'Folder')).toEqual(['comp:library/A.astro']);
    expect(childrenOf(tree, 'Folder 2')).toEqual(['comp:library/B.astro']);
  });

  // BUG 2 — a new/empty folder vanished on the next scan because it only ever
  // existed in React state.
  it('preserves an empty folder', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_empty'],
      folders: { f_empty: { name: 'Empty', children: [] } },
    };
    const tree = resolveFolderTree([], manifest);
    expect(tree.rootIds).toEqual(['f_empty']);
    expect(childrenOf(tree, 'Empty')).toEqual([]);
  });

  // BUG 3 — "once folder is moved into folder, it unwraps".
  it('preserves a folder nested inside a folder', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_outer'],
      folders: {
        f_outer: { name: 'Outer', children: ['f_inner'] },
        f_inner: { name: 'Inner', children: ['comp:library/Hero.astro'] },
      },
    };
    const tree = resolveFolderTree([comp('Hero')], manifest);
    expect(tree.rootIds).toEqual(['f_outer']);
    expect(childrenOf(tree, 'Outer')).toEqual(['f_inner']);
    expect(childrenOf(tree, 'Inner')).toEqual(['comp:library/Hero.astro']);
  });
});

describe('resolveFolderTree — self-healing', () => {
  it('drops a manifest member whose file no longer exists', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_1'],
      folders: { f_1: { name: 'Mine', children: ['comp:library/Gone.astro'] } },
    };
    const tree = resolveFolderTree([], manifest);
    expect(childrenOf(tree, 'Mine')).toEqual([]);
  });

  it('drops a reference to a folder id that does not exist', () => {
    const manifest: FolderManifest = { version: 1, roots: ['f_1', 'f_ghost'], folders: { f_1: { name: 'Mine', children: [] } } };
    const tree = resolveFolderTree([], manifest);
    expect(tree.rootIds).toEqual(['f_1']);
  });

  it('contains a cycle instead of hanging', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_a'],
      folders: {
        f_a: { name: 'A', children: ['f_b'] },
        f_b: { name: 'B', children: ['f_a'] }, // cycle
      },
    };
    const tree = resolveFolderTree([], manifest);
    expect(childrenOf(tree, 'A')).toEqual(['f_b']);
    expect(childrenOf(tree, 'B')).toEqual([]); // f_a already placed — not re-entered
  });

  it('keeps a folder orphaned from roots reachable at the root', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: [],
      folders: { f_1: { name: 'Orphan', children: [] } },
    };
    const tree = resolveFolderTree([], manifest);
    expect(tree.rootIds).toEqual(['f_1']);
  });
});

// Moved here from AssetsPanel.test.tsx when buildAssetTree was replaced by the
// resolver. PINNED_CATEGORIES is now a fallback-only ordering rule: an explicit
// manifest position always wins over it.
describe('resolveFolderTree — fallback folder ordering', () => {
  it('pins the Pages fallback folder above the other fallback folders', () => {
    const tree = resolveFolderTree(
      [comp('Hero', 'Hero'), comp('BlogPost', 'Pages', 'blog-post'), comp('Card', 'Layouts')],
      EMPTY_MANIFEST,
    );
    const folderNames = tree.rootIds
      .map((id) => tree.items.find((i) => i.id === id))
      .filter((i) => i?.kind === 'folder')
      .map((i) => i!.name);
    expect(folderNames[0]).toBe('Pages');
  });

  it('omits the Pages folder when no page templates exist', () => {
    const tree = resolveFolderTree([comp('Hero', 'Hero')], EMPTY_MANIFEST);
    expect(tree.items.filter((i) => i.kind === 'folder').map((i) => i.name)).not.toContain('Pages');
  });
});

describe('deleteFolder', () => {
  const M: FolderManifest = {
    version: 1,
    roots: ['comp:library/Z.astro', 'f_out'],
    folders: {
      f_out: { name: 'Out', children: ['f_in', 'comp:library/A.astro'] },
      f_in: { name: 'In', children: ['comp:library/B.astro'] },
    },
  };

  it('lifts members into the deleted folder position, keeping nesting', () => {
    const next = deleteFolder(M, 'f_out');
    expect(next.roots).toEqual(['comp:library/Z.astro', 'f_in', 'comp:library/A.astro']);
    expect(next.folders.f_in.children).toEqual(['comp:library/B.astro']);
    expect(next.folders.f_out).toBeUndefined();
  });

  it('lifts a nested folder into its parent folder, not to the root', () => {
    const next = deleteFolder(M, 'f_in');
    expect(next.folders.f_out.children).toEqual(['comp:library/B.astro', 'comp:library/A.astro']);
    expect(next.roots).toEqual(['comp:library/Z.astro', 'f_out']);
  });

  it('returns the same object for an unknown id', () => {
    expect(deleteFolder(M, 'f_nope')).toBe(M);
  });
});

describe('materializeTree', () => {
  it('turns a fallback folder into a real f_ folder carrying its members', () => {
    const tree = resolveFolderTree([comp('Hero', 'Heroes')], EMPTY_MANIFEST);
    const { manifest, idMap } = materializeTree(EMPTY_MANIFEST, tree);
    const newId = idMap.get('fallback:Heroes')!;
    expect(newId).toMatch(/^f_/);
    expect(manifest.folders[newId]).toEqual({ name: 'Heroes', children: ['comp:library/Hero.astro'] });
    expect(manifest.roots).toEqual([newId]);
  });

  it('pins the visible root order so an insert index means the same thing', () => {
    const base: FolderManifest = {
      version: 1,
      roots: ['f_a'],
      folders: { f_a: { name: 'A', children: [] } },
    };
    const tree = resolveFolderTree([comp('Loose')], base);
    const { manifest } = materializeTree(base, tree);
    expect(manifest.roots).toEqual(['f_a', 'comp:library/Loose.astro']);
  });

  it('remaps a nested fallback reference and drops a vanished member', () => {
    const base: FolderManifest = {
      version: 1,
      roots: ['f_a'],
      folders: { f_a: { name: 'A', children: ['comp:library/Gone.astro'] } },
    };
    const tree = resolveFolderTree([], base);
    const { manifest } = materializeTree(base, tree);
    expect(manifest.folders.f_a.children).toEqual([]);
  });

  it('is a fixed point once everything is explicit', () => {
    const base: FolderManifest = {
      version: 1,
      roots: ['f_a'],
      folders: { f_a: { name: 'A', children: ['comp:library/Hero.astro'] } },
    };
    const { manifest } = materializeTree(base, resolveFolderTree([comp('Hero')], base));
    expect(manifest).toEqual(base);
  });
});

// Renaming a component file changes its scanned path, and the manifest is keyed
// by that path. Without repointing, the renamed component drops out of its
// folder and falls back to its @category.
describe('repointComponentId', () => {
  const M: FolderManifest = {
    version: 1,
    roots: ['comp:library/Loose.astro'],
    folders: { f_a: { name: 'A', children: ['comp:library/Old.astro'] } },
  };

  it('repoints a member inside a folder', () => {
    const next = repointComponentId(M, 'comp:library/Old.astro', 'comp:library/New.astro');
    expect(next.folders.f_a.children).toEqual(['comp:library/New.astro']);
  });

  it('repoints a root-level member', () => {
    const next = repointComponentId(M, 'comp:library/Loose.astro', 'comp:library/Found.astro');
    expect(next.roots).toEqual(['comp:library/Found.astro']);
  });

  it('returns the SAME object when the id is not present (caller skips the write)', () => {
    expect(repointComponentId(M, 'comp:library/Absent.astro', 'comp:library/X.astro')).toBe(M);
  });

  it('keeps the renamed component in its folder across a resolve cycle', () => {
    const next = repointComponentId(M, 'comp:library/Old.astro', 'comp:library/New.astro');
    const tree = resolveFolderTree([comp('New', 'SomeCategory')], next);
    expect(childrenOf(tree, 'A')).toEqual(['comp:library/New.astro']);
    // and it did NOT fall back into an @category folder
    expect(tree.items.some((i) => i.kind === 'folder' && i.name === 'SomeCategory')).toBe(false);
  });
});

describe('partitionRoots — Static vs Dynamic sections', () => {
  const names = (tree: ReturnType<typeof resolveFolderTree>, ids: string[]) =>
    ids.map((id) => tree.items.find((i) => i.id === id)!.name);

  it('files Blog fallback folders under Dynamic, the rest under Static', () => {
    const tree = resolveFolderTree(
      [comp('Hero', 'Hero'), comp('BlogCard', 'Blog')],
      EMPTY_MANIFEST,
    );
    const { staticIds, dynamicIds } = partitionRoots(tree);
    expect(names(tree, staticIds)).toEqual(['Hero']);
    expect(names(tree, dynamicIds).sort()).toEqual(['Blog']);
  });

  it('sends a root-level uncategorized component to Static', () => {
    const tree = resolveFolderTree([comp('Loose')], EMPTY_MANIFEST);
    expect(partitionRoots(tree).staticIds).toEqual(['comp:library/Loose.astro']);
  });

  it('marks a user folder dynamic when ANY descendant is — never hides a data-bound component in Static', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_mix'],
      folders: {
        f_mix: { name: 'Mixed', children: ['comp:library/Hero.astro', 'f_deep'] },
        f_deep: { name: 'Deep', children: ['comp:library/BlogCard.astro'] },
      },
    };
    const tree = resolveFolderTree([comp('Hero', 'Hero'), comp('BlogCard', 'Blog')], manifest);
    expect(partitionRoots(tree).dynamicIds).toEqual(['f_mix']);
    expect(partitionRoots(tree).staticIds).toEqual([]);
  });

  it('keeps every root in exactly one section', () => {
    const tree = resolveFolderTree(
      [comp('Hero', 'Hero'), comp('BlogCard', 'Blog'), comp('Loose')],
      EMPTY_MANIFEST,
    );
    const { staticIds, dynamicIds } = partitionRoots(tree);
    expect([...staticIds, ...dynamicIds].sort()).toEqual([...tree.rootIds].sort());
  });
});

describe('partitionRoots — sq/ and the forced Dynamic folder', () => {
  /** A component under sq/ — the post editor's `/` menu inserts these into a
   *  post body, so they render per-post data whatever @category they carry. */
  function sqComp(name: string, category = 'Uncategorized'): ScannedComponent {
    return { ...comp(name, category), path: `src/components/sq/${name}.astro` };
  }

  it('treats an sq/ component as dynamic even with a non-dynamic category', () => {
    const tree = resolveFolderTree([sqComp('Media', 'Media')], EMPTY_MANIFEST);
    const { staticIds, dynamicIds } = partitionRoots(tree);
    expect(staticIds).toEqual([]);
    // flattened to the Dynamic root — no folder of its own, no siblings
    expect(dynamicIds).toEqual(['comp:src/components/sq/Media.astro']);
  });

  it('moves a static component into Dynamic via the reserved folder, and never renders that folder as a row', () => {
    const base = ensureDynamicFolder({
      version: 1,
      roots: ['comp:library/Hero.astro'],
      folders: {},
    });
    const forced: FolderManifest = {
      ...base,
      roots: [DYNAMIC_FOLDER_ID],
      folders: { [DYNAMIC_FOLDER_ID]: { name: 'Dynamic', children: ['comp:library/Hero.astro'] } },
    };
    const tree = resolveFolderTree([comp('Hero', 'Hero')], forced);
    const { staticIds, dynamicIds, forcedIds } = partitionRoots(tree);

    expect(staticIds).toEqual([]);
    expect(dynamicIds).toEqual(['comp:library/Hero.astro']);
    expect(forcedIds.has('comp:library/Hero.astro')).toBe(true);
    // the reserved folder is hoisted away, never painted as a folder row
    expect(dynamicIds).not.toContain(DYNAMIC_FOLDER_ID);
    expect(staticIds).not.toContain(DYNAMIC_FOLDER_ID);
  });

  it('ensureDynamicFolder is idempotent', () => {
    const once = ensureDynamicFolder(EMPTY_MANIFEST);
    expect(once.folders[DYNAMIC_FOLDER_ID]).toBeTruthy();
    expect(ensureDynamicFolder(once)).toBe(once);
  });

  it('lists forced members before derived ones', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: [DYNAMIC_FOLDER_ID],
      folders: { [DYNAMIC_FOLDER_ID]: { name: 'Dynamic', children: ['comp:library/Hero.astro'] } },
    };
    const tree = resolveFolderTree([comp('Hero', 'Hero'), comp('BlogCard', 'Blog')], manifest);
    const { dynamicIds } = partitionRoots(tree);
    expect(dynamicIds[0]).toBe('comp:library/Hero.astro');
  });
});

describe('blog content (sq/) grouping', () => {
  it('groups the WC system Media into Dynamic WITHOUT dragging its @category siblings along', () => {
    const media = { ...comp('Media', 'Media'), path: 'library/Media.astro' };
    const video = { ...comp('Video', 'Media'), path: 'library/Video.astro' };
    const tree = resolveFolderTree([media, video], EMPTY_MANIFEST);
    const { staticIds, dynamicIds } = partitionRoots(tree);

    const nameOf = (id: string) => tree.items.find((i) => i.id === id)!.name;
    expect(dynamicIds).toEqual(['comp:library/Media.astro']);
    expect(staticIds.map(nameOf)).toEqual(['Media']);
    // the static sibling stayed put in its @category folder
    expect(childrenOf(tree, 'Media')).toEqual(['comp:library/Video.astro']);
  });

  it('groups a local promoted sq/ component the same way', () => {
    const promoted = { ...comp('Callout', 'Feature'), path: 'src/components/sq/Callout.astro' };
    const tree = resolveFolderTree([promoted], EMPTY_MANIFEST);
    const { staticIds, dynamicIds } = partitionRoots(tree);
    expect(staticIds).toEqual([]);
    expect(dynamicIds).toEqual(['comp:src/components/sq/Callout.astro']);
  });
});

describe('isDynamicComponent — derived classification (2026-08-13 design)', () => {
  it('page templates are dynamic (BlogPost: @category Pages + @page-template)', () => {
    expect(isDynamicComponent(comp('BlogPost', 'Pages', 'blog-post'))).toBe(true);
  });

  it('layouts are dynamic (layoutToScannedComponent stamps Layouts in both runtimes)', () => {
    expect(isDynamicComponent(comp('Layout', 'Layouts'))).toBe(true);
  });

  it('content-bound components (scan sniff) are dynamic', () => {
    expect(isDynamicComponent({ ...comp('PostGrid'), contentBound: true })).toBe(true);
  });

  it('a plain component with contentBound undefined stays static (old scan payloads)', () => {
    expect(isDynamicComponent(comp('Hero', 'Hero'))).toBe(false);
  });

  it('the Pages fallback folder hoists under Dynamic when it holds a template', () => {
    const tree = resolveFolderTree(
      [comp('BlogPost', 'Pages', 'blog-post'), comp('Hero', 'Hero')],
      EMPTY_MANIFEST,
    );
    const { staticIds, dynamicIds } = partitionRoots(tree);
    const nameOf = (id: string) => tree.items.find((i) => i.id === id)!.name;
    expect(dynamicIds.map(nameOf)).toEqual(['Pages']);
    expect(staticIds.map(nameOf)).toEqual(['Hero']);
  });
});

describe('buildDynamicComponentIndex — name/path lookup for the yellow accent', () => {
  it('indexes only the dynamic subset, by name AND path', () => {
    const idx = buildDynamicComponentIndex([
      comp('BlogCard', 'Blog'),
      { ...comp('PostGrid'), path: 'src/components/PostGrid.astro', contentBound: true },
      comp('Hero', 'Hero'),
    ]);
    expect(idx.names.has('BlogCard')).toBe(true);
    expect(idx.paths.has('src/components/PostGrid.astro')).toBe(true);
    expect(idx.names.has('Hero')).toBe(false);
    expect(idx.paths.has('library/Hero.astro')).toBe(false);
  });
});

describe('resolveFolderTree — fallback joins a same-named manifest folder (2026-08-26)', () => {
  // Runtime-proven dup: a materialized "Layouts" folder existed in the
  // manifest, then a NEW layout (Layout1) scanned in later. The fallback pass
  // minted a SECOND folder named "Layouts" (fallback:Layouts), so the Assets
  // panel showed two Layouts sections and the ⌘K picker rendered duplicate
  // React keys `Layouts` (7 errors per open). An unlisted component whose
  // @category matches an existing manifest folder NAME must join that folder.
  it('unlisted component with a category matching a manifest folder joins it', () => {
    const manifest: FolderManifest = {
      version: 1,
      roots: ['f_1'],
      folders: { f_1: { name: 'Layouts', children: ['comp:library/Old.astro'] } },
    };
    const tree = resolveFolderTree(
      [comp('Old', 'Layouts'), comp('New', 'Layouts')],
      manifest,
    );
    const layoutFolders = tree.items.filter((i) => i.kind === 'folder' && i.name === 'Layouts');
    expect(layoutFolders).toHaveLength(1);
    expect(layoutFolders[0].children).toEqual([
      'comp:library/Old.astro',
      'comp:library/New.astro',
    ]);
  });

  it('no same-named manifest folder → fallback folder as before', () => {
    const tree = resolveFolderTree([comp('New', 'Layouts')], EMPTY_MANIFEST);
    const folders = tree.items.filter((i) => i.kind === 'folder' && i.name === 'Layouts');
    expect(folders).toHaveLength(1);
    expect(folders[0].id).toBe('fallback:Layouts');
  });
});

describe('mergeScannedComponents — a materialized copy replaces its library original', () => {
  it('lists the project copy once instead of a library row and a copy under the same name', () => {
    const lib = comp('Hero2', 'Hero');
    const copy: ScannedComponent = { ...comp('Hero2', 'Hero'), path: 'src/components/Hero2.astro', source: 'user-project' };
    const other = comp('Hero3', 'Hero');
    const merged = mergeScannedComponents([lib, other], [copy]);
    expect(merged.map((c) => c.path).sort()).toEqual(['library/Hero3.astro', 'src/components/Hero2.astro']);
  });
});
