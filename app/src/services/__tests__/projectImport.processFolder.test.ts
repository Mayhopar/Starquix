import { describe, it, expect } from 'vitest';
import { isSkippedDir, entriesFromFileList } from '@/services/projectImport/processFolder';

describe('import entries (files-truth)', () => {
  it('skip-dirs and dot-dirs anywhere in the path', () => {
    expect(isSkippedDir('node_modules/x.js')).toBe(true);
    expect(isSkippedDir('src/.cache/x')).toBe(true);
    expect(isSkippedDir('dist/index.html')).toBe(true);
    expect(isSkippedDir('src/pages/index.astro')).toBe(false);
  });
  it('entriesFromFileList keeps the picked folder as segment 0 and drops skip-dirs below it', async () => {
    // jsdom's File has no arrayBuffer(); the adapter only needs that + the relative path.
    const mk = (rel: string) => ({ name: rel.split('/').pop()!, webkitRelativePath: rel, arrayBuffer: async () => new Uint8Array([120]).buffer }) as unknown as File;
    const entries = await entriesFromFileList([mk('site/package.json'), mk('site/node_modules/a.js'), mk('site/src/pages/index.astro')]);
    expect(entries.map((e) => e.path)).toEqual(['site/package.json', 'site/src/pages/index.astro']);
  });
});
