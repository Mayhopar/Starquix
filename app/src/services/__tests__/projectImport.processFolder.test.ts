import { describe, it, expect } from 'vitest';
import { entriesFromFileList } from '@/services/projectImport/processFolder';
import { prepareImportMetadata } from '@/services/projectImport/importValidation';

describe('import entries (files-truth)', () => {
  it('skips only build, vendor and VCS dirs; dot-files are the project\'s (#16)', () => {
    const kept = ['package.json', 'src/pages/index.astro', '.gitignore', '.env', '.npmrc', '.starquix/folders.json',
      '.github/workflows/starquix-pages.yml', 'public/.well-known/security.txt', 'public/.htaccess', 'src/content/.gitkeep'];
    const skipped = ['node_modules/x.js', 'src/node_modules/y.js', '.git/HEAD', '.sq/seed-complete.json', 'dist/index.html', '.astro/types.d.ts',
      '.vercel/project.json', '.netlify/state.json', '.output/server.mjs'];
    const { entries, skipped: count } = prepareImportMetadata([...kept, ...skipped].map((path) => ({ path: `site/${path}`, size: 1 })));
    expect(entries.map((entry) => entry.path)).toEqual(kept);
    expect(count).toBe(skipped.length);
  });
  it('entriesFromFileList keeps the picked folder as segment 0 and drops skip-dirs below it', async () => {
    // jsdom's File has no arrayBuffer(); the adapter only needs that + the relative path.
    const mk = (rel: string) => ({ name: rel.split('/').pop()!, webkitRelativePath: rel, arrayBuffer: async () => new Uint8Array([120]).buffer }) as unknown as File;
    const entries = await entriesFromFileList([mk('site/package.json'), mk('site/node_modules/a.js'), mk('site/src/pages/index.astro')]);
    expect(entries.map((e) => e.path)).toEqual(['site/package.json', 'site/src/pages/index.astro']);
  });
});
