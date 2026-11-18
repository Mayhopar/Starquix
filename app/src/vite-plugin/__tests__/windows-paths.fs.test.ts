/**
 * Windows port (2026-11-10): the instance's file helpers on a REAL disk return POSIX paths — what the editor stores and
 * the write routes accept (no backslash). On macOS/Linux this holds by construction; the Windows CI runs this file
 * natively (.github/workflows/windows.yml), where a bare path.relative / path.join answered `ui\cards\Card.astro`.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// eslint-disable-next-line import/no-relative-packages
import { createComponentFile, renameComponentFile, moveComponentToSystemDir, writeLocalContentAsset, scanComponents } from '../../../../preview-template/src/plugins/sq-project-fs.js';

async function site() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sq-winpaths-'));
  await mkdir(path.join(dir, 'src', 'components'), { recursive: true });
  return dir;
}

describe('Windows paths on a real disk', () => {
  it('component files: create / rename / promote / demote answer project-relative POSIX paths', async () => {
    const dir = await site(); const components = path.join(dir, 'src', 'components');
    try {
      const created = await createComponentFile(components, 'Card', '<div class="p-4">Card</div>\n', 'ui/cards');
      expect(created).toBe('ui/cards/Card.astro');
      const renamed = await renameComponentFile(components, created, 'Tile');
      expect(renamed).toBe('ui/cards/Tile.astro');
      const promoted = await moveComponentToSystemDir(components, renamed, true);
      expect(promoted).toBe('ui/cards/sq/Tile.astro');
      // A nested system folder is still recognized from the editor's POSIX path.
      expect(await moveComponentToSystemDir(components, promoted, false)).toBe('ui/cards/Tile.astro');
      const [scanned] = await scanComponents(dir);
      expect(scanned).toMatchObject({ path: 'src/components/ui/cards/Tile.astro', category: 'Ui' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('an image uploaded into a post is referenced relative to the post, in forward slashes', async () => {
    const dir = await site();
    try {
      await mkdir(path.join(dir, 'src', 'content', 'blog'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'content', 'blog', 'post.mdx'), '---\ntitle: Post\n---\n');
      const { src } = writeLocalContentAsset(dir, 'src/content/blog/post.mdx', 'cover.png', new Uint8Array([1, 2, 3]));
      expect(src).toBe('./images/uploads/cover.png');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
