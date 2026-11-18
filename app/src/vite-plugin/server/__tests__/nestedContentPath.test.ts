/**
 * Imported-adoption phase 0 (Task 2.1): nested content slugs (`2024/post`)
 * now flow through the client grouping regex, so the server path resolver
 * must (a) resolve them inside src/content and (b) STILL refuse traversal —
 * a slug is user-shaped data and `../` must never reach the join.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveLocalContentPath } from '../../project-fs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sq-nested-'));
  mkdirSync(path.join(dir, 'src', 'content', 'blog', '2024'), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveLocalContentPath with nested slugs', () => {
  it('resolves a nested entry inside src/content', () => {
    expect(resolveLocalContentPath(dir, 'src/content/blog/2024/post.md')).toBe(
      path.join(dir, 'src/content/blog/2024/post.md')
    );
  });

  it('refuses ../ traversal smuggled through a nested slug', () => {
    expect(() =>
      resolveLocalContentPath(dir, 'src/content/blog/../../../etc/passwd')
    ).toThrow('path outside src/content');
  });

  it('refuses an absolute escape', () => {
    expect(() => resolveLocalContentPath(dir, '/etc/passwd')).toThrow(
      'path outside src/content'
    );
  });
});
