import { describe, it, expect, beforeEach } from 'vitest';
import {
  isLocalProjectId, isLocalProjectId, markFilesTruth, unmarkFilesTruth, findLocalProjectEntry,
  discoverPagesFromPaths, routeForPageFile, filesTruthPath,
} from '../localMode';
import { discoverLocalPages as jsDiscover, routeForPageFile as jsRoute } from '../../../../preview-template/src/plugins/sq-project-fs.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('files-truth WC registry', () => {
  beforeEach(() => { unmarkFilesTruth('browser_x'); localStorage.clear(); });

  it('a browser_ id is local ONLY once marked; the mark survives via the localStorage mirror', () => {
    expect(isLocalProjectId('browser_x')).toBe(false);
    expect(isLocalProjectId('browser_x')).toBe(false);
    markFilesTruth('browser_x');
    expect(isLocalProjectId('browser_x')).toBe(true);
    expect(isLocalProjectId('browser_x')).toBe(true);
    expect(localStorage.getItem('sq:files-truth:browser_x')).toBe('1');
    unmarkFilesTruth('browser_x');
    expect(isLocalProjectId('browser_x')).toBe(false);
    // mirror alone (fresh module state after a reload) is enough
    localStorage.setItem('sq:files-truth:browser_x', '1');
    expect(isLocalProjectId('browser_x')).toBe(true);
  });

  it('a local_ id (the removed host-folder disk) is not a project at all', () => {
    expect(isLocalProjectId('local_abc')).toBe(false);
    expect(isLocalProjectId('local_abc')).toBe(false);
    expect(findLocalProjectEntry('local_abc')).toBeNull();
  });

  it('findLocalProjectEntry returns the synthetic wc:// path for a marked id', () => {
    markFilesTruth('browser_x');
    expect(findLocalProjectEntry('browser_x')).toEqual({ path: filesTruthPath('browser_x'), name: 'browser_x' });
    expect(findLocalProjectEntry('browser_other')).toBeNull();
  });
});

describe('discoverPagesFromPaths ≡ sq-project-fs discoverLocalPages', () => {
  it('same routes, order and fields over the same tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sq-pages-parity-'));
    const files = [
      'src/pages/index.astro', 'src/pages/about.astro', 'src/pages/blog/[slug].astro',
      'src/pages/blog/index.astro', 'src/pages/notes.md', 'src/pages/x/y/deep.mdx',
      'src/pages/ignore.txt', 'src/components/Card.astro', 'public/a.png',
    ];
    for (const f of files) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), ''); }
    expect(discoverPagesFromPaths(files)).toEqual(jsDiscover(dir));
    for (const f of files) expect(routeForPageFile(f)).toBe(jsRoute(f));
  });

  // task-240 Phase 3: `[...page].astro` (Astro pagination) is the parent route
  // itself — one static, editable page in both twins.
  it('[...page].astro lists as its parent route in both twins', () => {
    for (const f of ['src/pages/blog/[...page].astro', 'src/pages/[...page].astro', 'src/pages/docs/[...slug].astro']) {
      expect(routeForPageFile(f)).toBe(jsRoute(f));
    }
    expect(routeForPageFile('src/pages/blog/[...page].astro')).toBe('/blog');
    expect(discoverPagesFromPaths(['src/pages/blog/[...page].astro'])).toEqual([
      { route: '/blog', file: 'src/pages/blog/[...page].astro', editable: true },
    ]);
  });
});
