/**
 * Frontmatter-image uploads in a files-truth project (2026-08-14 owner report:
 * "create a new mdx, fill all the fields → error").
 *
 * Proven live: the generic asset path writes public/uploads/ and returns
 * `/uploads/<name>` — a public URL Astro's `image()` schema helper REJECTS
 * (InvalidContentEntryFrontmatterError → every route 500s). A frontmatter
 * image must live INSIDE the collection and be referenced relative to the
 * post file — the convention the user's own posts already follow
 * (`./images/...`), valid for image() and plain-string schemas alike.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeLocalContentAsset } from '../../project-fs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-fmimg-'));
  mkdirSync(path.join(dir, 'src', 'content', 'works', '2024'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeLocalContentAsset', () => {
  it('writes into the collection and returns a post-relative ./ src', () => {
    const { src } = writeLocalContentAsset(
      dir, 'src/content/works/untitled-1.mdx', 'pic.png', Buffer.from('x')
    );
    expect(src).toBe('./images/uploads/pic.png');
    expect(existsSync(path.join(dir, 'src/content/works/images/uploads/pic.png'))).toBe(true);
  });

  it('nested post gets a ../ path back to the collection images dir', () => {
    const { src } = writeLocalContentAsset(
      dir, 'src/content/works/2024/post.mdx', 'pic.png', Buffer.from('x')
    );
    expect(src).toBe('../images/uploads/pic.png');
  });

  it('name collisions get unique suffixes, not overwrites', () => {
    const a = writeLocalContentAsset(dir, 'src/content/works/a.mdx', 'pic.png', Buffer.from('1'));
    const b = writeLocalContentAsset(dir, 'src/content/works/b.mdx', 'pic.png', Buffer.from('2'));
    expect(a.src).not.toBe(b.src);
  });

  it('refuses a postFile escaping src/content', () => {
    expect(() =>
      writeLocalContentAsset(dir, 'src/pages/index.astro', 'p.png', Buffer.from('x'))
    ).toThrow('path outside src/content');
  });
});
