// Gap 23 (pages-lifecycle parity, 2026-08-12): renameLocalDocPage — the
// files-truth local rename. The file move is planned by the instance
// (`/__sq/local/page-plan`) and accepted durably; the doc row is rekeyed in
// the SAME acceptance, reusing the delete/restore doc halves so the
// sq:local-page-created/-deleted events keep useLocalInstance's route→file
// map current. A refused plan leaves the doc untouched.
//
// Migrated 2026-09-23 from the retired synchronous host endpoint
// (`/__sq/local/page-rename` fetch stub) to the durable file acceptance:
// real route table + temp disk (projectFsRuntime) + fake-indexeddb.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { applyCommand } from '@/store/commands';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';
import { renameLocalDocPage } from '../localPageSync';

const PAGE = (title: string) => `---\n---\n<html><body><h1>${title}</h1></body></html>\n`;
let projectId: string;
let folder: string;
let runtime: ReturnType<typeof projectFsRuntime>;

function start(files: Record<string, string>) {
  runtime = projectFsRuntime(projectId, files);
}

function seedDoc(pageIds: string[], currentPageId?: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  for (const id of pageIds) {
    applyCommand(doc, {
      type: 'ADD_PAGE',
      page: { id, name: id === 'index' ? '/' : `/${id}`, rootElementIds: [], children: [] },
    });
  }
  if (currentPageId) doc.getMap('meta').set('currentPageId', currentPageId);
  return doc;
}

async function settle() {
  const { acceptedRevision } = await storage.getDurableProjectState(projectId);
  if (acceptedRevision) await flushDurableSourceWritesThrough(projectId, acceptedRevision);
}

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_rename_${webcrypto.randomUUID()}`;
  folder = `wc://${projectId}`;
  setActiveSaveProjectId(projectId);
});

afterEach(async () => {
  await settle();
  runtime?.close();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
  setActiveSaveProjectId(null);
});

describe('renameLocalDocPage', () => {
  it('rekeys the doc row to the new route, moves the real file, and follows the current page', async () => {
    start({ 'src/pages/index.astro': PAGE('Home'), 'src/pages/about.astro': PAGE('About') });
    const doc = seedDoc(['index', 'about'], 'about');
    const created = vi.fn();
    const deleted = vi.fn();
    window.addEventListener('sq:local-page-created', created as EventListener);
    window.addEventListener('sq:local-page-deleted', deleted as EventListener);

    const newId = await renameLocalDocPage(doc, folder, 'about', 'Team');

    expect(newId).toBe('team');
    const pages = doc.getMap('pages');
    expect(pages.has('about')).toBe(false);
    expect((pages.get('team') as Y.Map<unknown>).get('name')).toBe('/team');
    // The canvas was showing the renamed page — follow it to the new id.
    expect(doc.getMap('meta').get('currentPageId')).toBe('team');
    // Route→file map events: created for the new file, deleted for the old.
    expect((created.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      route: '/team', file: 'src/pages/team.astro',
    });
    expect((deleted.mock.calls[0][0] as CustomEvent).detail).toMatchObject({
      route: '/about', file: 'src/pages/about.astro',
    });
    window.removeEventListener('sq:local-page-created', created as EventListener);
    window.removeEventListener('sq:local-page-deleted', deleted as EventListener);
    // Files are truth: the real file moved, bytes preserved.
    await settle();
    expect(existsSync(join(runtime.root, 'src/pages/about.astro'))).toBe(false);
    expect(runtime.read('src/pages/team.astro')).toBe(PAGE('About'));
  });

  it('leaves currentPageId alone when another page is open', async () => {
    start({ 'src/pages/index.astro': PAGE('Home'), 'src/pages/about.astro': PAGE('About') });
    const doc = seedDoc(['index', 'about'], 'index');
    await renameLocalDocPage(doc, folder, 'about', 'Team');
    expect(doc.getMap('meta').get('currentPageId')).toBe('index');
  });

  it('renames a single-page doc (adds the new row BEFORE deleting the old — DELETE_PAGE refuses on the last page)', async () => {
    start({ 'src/pages/about.astro': PAGE('About') });
    const doc = seedDoc(['about'], 'about');
    const newId = await renameLocalDocPage(doc, folder, 'about', 'Team');
    expect(newId).toBe('team');
    expect(doc.getMap('pages').has('about')).toBe(false);
    expect(doc.getMap('pages').has('team')).toBe(true);
  });

  it('same-slug rename is a no-op on the doc', async () => {
    start({ 'src/pages/index.astro': PAGE('Home'), 'src/pages/about.astro': PAGE('About') });
    const doc = seedDoc(['index', 'about'], 'about');
    const newId = await renameLocalDocPage(doc, folder, 'about', 'About');
    expect(newId).toBe('about');
    expect(doc.getMap('pages').has('about')).toBe(true);
    expect(doc.getMap('meta').get('currentPageId')).toBe('about');
    expect(runtime.read('src/pages/about.astro')).toBe(PAGE('About'));
  });

  it('throws the server reason and leaves the doc untouched on refusal', async () => {
    start({
      'src/pages/index.astro': PAGE('Home'),
      'src/pages/about.astro': PAGE('About'),
      'src/pages/team.astro': PAGE('Team'),
    });
    const doc = seedDoc(['index', 'about'], 'about');
    await expect(renameLocalDocPage(doc, folder, 'about', 'Team'))
      .rejects.toThrow('A page for /team already exists');
    expect(doc.getMap('pages').has('about')).toBe(true);
    expect(doc.getMap('pages').has('team')).toBe(false);
    expect(await db.durableEdits.count()).toBe(0);
    expect(runtime.read('src/pages/about.astro')).toBe(PAGE('About'));
  });

  it('refuses a folder that belongs to a different project before any plan', async () => {
    start({ 'src/pages/index.astro': PAGE('Home'), 'src/pages/about.astro': PAGE('About') });
    const doc = seedDoc(['index', 'about'], 'about');
    await expect(renameLocalDocPage(doc, 'wc://browser_other', 'about', 'Team'))
      .rejects.toThrow('File gesture belongs to a different project');
    expect(doc.getMap('pages').has('about')).toBe(true);
  });
});
