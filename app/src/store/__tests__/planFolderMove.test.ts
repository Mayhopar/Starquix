import { describe, it, expect } from 'vitest';
import { planFolderMove } from '../planFolderMove';
import type { FolderManifest } from '../folderManifest';

const M: FolderManifest = {
  version: 1,
  roots: ['f_out', 'comp:library/Z.astro'],
  folders: {
    f_out: { name: 'Out', children: ['f_in', 'comp:library/A.astro'] },
    f_in: { name: 'In', children: ['comp:library/B.astro'] },
  },
};

describe('planFolderMove', () => {
  it('moves a component into a folder', () => {
    const next = planFolderMove(M, { selectedIds: ['comp:library/Z.astro'], targetFolderId: 'f_in', insertIndex: 1 });
    expect(next.folders.f_in.children).toEqual(['comp:library/B.astro', 'comp:library/Z.astro']);
    expect(next.roots).toEqual(['f_out']);
  });

  it('moves a folder into a folder WITHOUT unwrapping it', () => {
    const next = planFolderMove(M, { selectedIds: ['f_in'], targetFolderId: null, insertIndex: 0 });
    expect(next.roots).toEqual(['f_in', 'f_out', 'comp:library/Z.astro']);
    expect(next.folders.f_in.children).toEqual(['comp:library/B.astro']); // members ride along
    expect(next.folders.f_out.children).toEqual(['comp:library/A.astro']);
  });

  it('prunes a member whose ancestor is also selected', () => {
    const next = planFolderMove(M, {
      selectedIds: ['f_in', 'comp:library/B.astro'], // B is inside f_in
      targetFolderId: null,
      insertIndex: 0,
    });
    expect(next.roots).toEqual(['f_in', 'f_out', 'comp:library/Z.astro']);
    expect(next.folders.f_in.children).toEqual(['comp:library/B.astro']); // stayed inside, not hoisted
  });

  it('lands the block in tree order, not click order', () => {
    const next = planFolderMove(M, {
      selectedIds: ['comp:library/Z.astro', 'comp:library/A.astro'], // clicked Z first
      targetFolderId: 'f_in',
      insertIndex: 0,
    });
    // tree order is A (inside f_out) before Z (root, after f_out)
    expect(next.folders.f_in.children).toEqual(['comp:library/A.astro', 'comp:library/Z.astro', 'comp:library/B.astro']);
  });

  it('refuses to move a folder into its own descendant', () => {
    const next = planFolderMove(M, { selectedIds: ['f_out'], targetFolderId: 'f_in', insertIndex: 0 });
    expect(next).toEqual(M); // no-op
  });

  it('does not mutate the input manifest', () => {
    const before = JSON.stringify(M);
    planFolderMove(M, { selectedIds: ['comp:library/A.astro'], targetFolderId: null, insertIndex: 0 });
    expect(JSON.stringify(M)).toBe(before);
  });
});
