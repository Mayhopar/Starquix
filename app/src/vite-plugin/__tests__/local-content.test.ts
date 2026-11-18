import { describe, it, expect } from 'vitest';
import { listLocalContentFiles, resolveLocalContentPath } from '../project-fs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-content-'));
  mkdirSync(join(dir, 'src', 'content', 'blog'), { recursive: true });
  writeFileSync(join(dir, 'src', 'content', 'blog', 'hello.md'), '---\ntitle: "Hi"\n---\nbody');
  writeFileSync(join(dir, 'src', 'content', 'blog', 'note.mdx'), '---\ntitle: "Note"\n---\n');
  writeFileSync(join(dir, 'src', 'content', 'config.ts'), 'export const collections = {};');
  return dir;
}

describe('listLocalContentFiles', () => {
  it('returns md/mdx under src/content keyed by repo-relative path', () => {
    const files = listLocalContentFiles(scaffold());
    expect(Object.keys(files).sort()).toEqual([
      'src/content/blog/hello.md',
      'src/content/blog/note.mdx',
    ]);
    expect(files['src/content/blog/hello.md']).toContain('title: "Hi"');
  });

  it('returns {} when src/content is missing', () => {
    expect(listLocalContentFiles(mkdtempSync(join(tmpdir(), 'sq-content-')))).toEqual({});
  });
});

describe('resolveLocalContentPath', () => {
  it('resolves paths inside src/content', () => {
    const dir = scaffold();
    expect(resolveLocalContentPath(dir, 'src/content/blog/new.md'))
      .toBe(join(dir, 'src', 'content', 'blog', 'new.md'));
  });

  it('retargets a missing .md to the existing .mdx post', () => {
    const dir = scaffold();
    expect(resolveLocalContentPath(dir, 'src/content/blog/note.md'))
      .toBe(join(dir, 'src', 'content', 'blog', 'note.mdx'));
  });

  it('throws on escape and on src/content itself', () => {
    const dir = scaffold();
    expect(() => resolveLocalContentPath(dir, 'src/content/../../etc/passwd')).toThrow();
    expect(() => resolveLocalContentPath(dir, 'src/pages/index.astro')).toThrow();
    expect(() => resolveLocalContentPath(dir, 'src/content')).toThrow();
  });
});
