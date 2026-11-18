// HN report 2026-11-09: Assets → Dynamic › Pages › BlogPost answered every click
// with "Couldn't prepare the component for editing: BlogPost depends on
// ../../layouts/Layout.astro, which lives outside the component library". A row
// the copier can never copy must not be offered. Invariant, over the REAL
// packaged catalog: every built-in the Assets panel / ⌘K picker lists
// (mergeScannedComponents) for a fresh project can be copied into it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sqSourcePlugin } from '@/vite-plugin';
import { mergeScannedComponents } from '@/store/folderManifest';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { openDurableInsertProject, type DurableInsertProject } from './localInsertDurableHarness';
import { materializeLibraryComponent } from '../localComponentInsert';

const appDir = path.resolve(__dirname, '../../../..');
const componentsDir = path.resolve(appDir, '../preview-template/src/components');

/** The catalog the packaged app bundles (virtual:built-in-components), built by the real plugin. */
async function packagedCatalog(): Promise<ScannedComponent[]> {
  const plugin = sqSourcePlugin({ root: appDir }) as unknown as {
    configResolved(c: { root: string; command: string }): void;
    load(id: string): Promise<string>;
  };
  plugin.configResolved({ root: appDir, command: 'build' });
  const code = await plugin.load('\0virtual:built-in-components');
  return JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, ''));
}

let project: DurableInsertProject;
describe('Assets / ⌘K list only built-ins that can be opened', () => {
  beforeEach(async () => {
    project = await openDurableInsertProject({ 'src/pages/index.astro': '<main>\n</main>\n' });
    // The editor's two page fetches, served from the real files: the dev raw
    // built-in source read (fetchRaw) and the bundled snapshot (asset copies).
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://editor.test');
      if (url.pathname === '/astro-snapshot.json') {
        return new Response(await readFile(path.join(appDir, 'public/astro-snapshot.json')), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.pathname !== '/__sq/component-html' || url.searchParams.get('raw') !== '1') return new Response('not found', { status: 404 });
      const raw = await readFile(path.join(componentsDir, url.searchParams.get('path') ?? ''), 'utf-8');
      return new Response(raw, { status: 200, headers: { 'content-type': 'text/plain' } });
    }));
  });
  afterEach(async () => { await project.close(); vi.unstubAllGlobals(); });

  it('every built-in listed for a fresh project can be copied into it', async () => {
    const catalog = await packagedCatalog();
    // BlogPost stays in the catalog: the post-page wrap (ViewportFrame) still reads it.
    expect(catalog.some(c => c.name === 'BlogPost')).toBe(true);
    const listed = mergeScannedComponents(catalog, []).filter(c => c.source === 'built-in');
    expect(listed.length).toBeGreaterThan(30);
    const refused: string[] = [];
    for (const c of listed) {
      const r = await materializeLibraryComponent(c, project.folder, []); // plan only: nothing is written
      if (!r.ok) refused.push(`${c.name}: ${r.reason}`);
    }
    expect(refused).toEqual([]);
  }, 60_000);
});
