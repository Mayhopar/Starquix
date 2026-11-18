// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerProjectFsRoutes, createChangeJournal } from '../../../../../preview-template/src/plugins/sq-project-fs-routes.js';
import { setLocalTransport, resetLocalTransportForTests } from '@/utils/sqLocalBase';
import { clearSnapshotCache } from '@/services/snapshotLoader';
import { insertLocalComponent, materializeLibraryComponent } from '../localComponentInsert';
import snapshot from '../../../../public/astro-snapshot.json';
import { db } from '@/db';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { _resetStructuralWriteInFlightForTests } from '../localStructuralOps';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalScannedRoute, setLocalPageFile } from '@/utils/localPageSync';

// Inert: the module self-registers a window listener at load (node env has no
// window). Writes go through the durable gesture, never this writer.
vi.mock('@/services/ViteStructuralWriter', () => ({ viteStructuralWriter: {} }));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

const files = snapshot.files as Record<string, string>;
const bytes = (file: string) => Buffer.from(files[file], 'base64');
const hero = 'public/assets/images/content/hero-bg.webp';
const logo = 'public/assets/logos/logo-placeholder.svg';
const component = (name: string) => ({ name, path: `library/${name}.astro`, source: 'built-in' as const, html: '', category: '', props: [], slots: [], dependencies: [] });
let dir: string;
/** Files-truth (2026-09): gestures are accepted durably against a `wc://<id>`
 *  project (Dexie) and materialized to disk afterwards — `project` is the
 *  folder handed to the code, `dir` is the runtime disk behind the routes. */
let projectId: string;
let project: string;
/** Materialize every accepted durable edit to disk before asserting on it. */
const flush = () => flushDurableSourceWrites(projectId);
let server: Server;
let url: string;
let journal: ReturnType<typeof createChangeJournal>;
const nativeFetch = globalThis.fetch;

beforeEach(async () => {
  await db.delete(); await db.open();
  projectId = `browser_assets_${crypto.randomUUID()}`;
  project = `wc://${projectId}`;
  setActiveSaveProjectId(projectId);
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests();
  dir = mkdtempSync(join(tmpdir(), 'sq-library-assets-'));
  mkdirSync(join(dir, 'src/components'), { recursive: true });
  journal = createChangeJournal();
  type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
  const routes: Array<[string, Handler]> = [];
  registerProjectFsRoutes({ middlewares: { use: (route: string, handler: Handler) => routes.push([route, handler]) } }, {
    resolveRoot: () => dir, sqComponentsDir: '', journal,
  });
  server = createServer((req, res) => {
    const route = routes.find(([path]) => req.url?.split('?')[0] === path);
    if (!route) { res.writeHead(404); res.end(); return; }
    route[1](req, res, () => { res.writeHead(404); res.end(); });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  setLocalTransport({ fetch: (path, init) => nativeFetch(url + path, init) });
  vi.stubGlobal('fetch', async (path: string) => {
    if (path !== '/astro-snapshot.json') throw new Error(`Unexpected external source: ${path}`);
    return new Response(JSON.stringify(snapshot));
  });
  vi.stubEnv('PROD', true);
  vi.stubEnv('VITE_SNAPSHOT_VERSION', snapshot.version);
  clearSnapshotCache();
});
afterEach(async () => {
  await flush().catch(() => {});
  setActiveSaveProjectId(null);
  _resetStructuralWriteInFlightForTests(); _resetLocalPageSyncForTests();
  resetLocalTransportForTests();
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearSnapshotCache();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});
const put = (file: string, data: string | Buffer) => {
  mkdirSync(join(dir, file, '..'), { recursive: true }); writeFileSync(join(dir, file), data);
};
const assetPost = (file: string, data: Buffer = bytes(hero)) => nativeFetch(`${url}/__sq/local/bundled-asset?file=${encodeURIComponent(file)}`, { method: 'POST', body: data });

describe('materialized library public assets through real shared filesystem routes', () => {
  // This first integration decodes the full snapshot, accepts real Dexie rows,
  // then materializes and reads binary bytes over HTTP. It finishes <1s alone
  // but exceeded 5s during full-suite startup; allow contention without changing
  // the default budget for the smaller route/asset cases below.
  it('copies original Hero WebP bytes and records a readable journal entry before success', async () => {
    const result = await materializeLibraryComponent(component('Hero'), project);
    expect(result.ok).toBe(true);
    await flush();
    expect(existsSync(join(dir, hero)), 'Hero background must exist on project disk').toBe(true);
    expect(readFileSync(join(dir, hero)).equals(bytes(hero))).toBe(true);
    expect(readFileSync(join(dir, 'src/components/Hero.astro'))).toEqual(bytes('src/components/library/Hero.astro'));
    expect(journal.since(0).entries).toContainEqual(expect.objectContaining({ file: hero, kind: 'change' }));
    const read = await nativeFetch(`${url}/__sq/local/file?file=${encodeURIComponent(hero)}`);
    expect(Buffer.from(await read.arrayBuffer()).equals(bytes(hero))).toBe(true);
  }, 15_000);
  it('copies text SVG exactly and preserves a customized existing asset', async () => {
    put(hero, Buffer.from('custom user image'));
    expect((await materializeLibraryComponent(component('Hero'), project)).ok).toBe(true);
    await flush();
    expect(readFileSync(join(dir, hero), 'utf8')).toBe('custom user image');
    expect((await materializeLibraryComponent(component('Header'), project)).ok).toBe(true);
    await flush();
    expect(readFileSync(join(dir, logo))).toEqual(bytes(logo));
    expect(journal.since(0).entries.filter(entry => entry.file === hero)).toEqual([]);
  });
  it('reconciles reuse from actual frontmatter and nested project imports without overwriting user source', async () => {
    const custom = `---
import Child from './nested/Child.astro';
const image = '/assets/images/content/cta.webp';
---
<section>My custom Hero<Child /><img src={image}/></section>`;
    put('src/components/Hero.astro', custom);
    put('src/components/nested/Child.astro', `<img src="/assets/logos/Coastline.svg"/><img src="/uploads/mine.webp"/>`);
    const result = await materializeLibraryComponent(component('Hero'), project);
    expect(result).toMatchObject({ ok: true, reused: true });
    await flush();
    expect(readFileSync(join(dir, 'src/components/Hero.astro'), 'utf8')).toBe(custom);
    expect(readFileSync(join(dir, 'public/assets/images/content/cta.webp'))).toEqual(bytes('public/assets/images/content/cta.webp'));
    expect(readFileSync(join(dir, 'public/assets/logos/Coastline.svg'))).toEqual(bytes('public/assets/logos/Coastline.svg'));
    expect(existsSync(join(dir, hero))).toBe(false);
  });
  it('the discovered user-project picker path also repairs a prior copy on insertion', async () => {
    put('src/components/Hero.astro', bytes('src/components/library/Hero.astro'));
    put('src/pages/index.astro', '<main>\n</main>\n');
    setLocalPageFile('src/pages/index.astro'); setLocalExpectedRoute('/'); setLocalScannedRoute('/');
    const result = await insertLocalComponent({
      component: { ...component('Hero'), path: 'src/components/Hero.astro', source: 'user-project', html: '<section>custom scan</section>' },
      localProjectPath: project, pageFile: 'src/pages/index.astro', selection: null, scannedElements: [],
    });
    expect(result.ok).toBe(true);
    await flush();
    expect(readFileSync(join(dir, hero)).equals(bytes(hero))).toBe(true);
    expect(readFileSync(join(dir, 'src/pages/index.astro'), 'utf8')).toContain('<Hero />');
    expect(readFileSync(join(dir, 'src/components/Hero.astro'))).toEqual(bytes('src/components/library/Hero.astro'));
  });
  it('preflights and copies assets of a newly bundled nested Astro dependency', async () => {
    const extra = {
      'src/components/library/Parent.astro': Buffer.from("---\nimport Child from './nested/Child.astro';\n---\n<section><Child /></section>").toString('base64'),
      'src/components/library/nested/Child.astro': Buffer.from('<img src="/assets/logos/Coastline.svg"/>').toString('base64'),
    };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ...snapshot, files: { ...files, ...extra } })));
    expect((await materializeLibraryComponent(component('Parent'), project)).ok).toBe(true);
    await flush();
    expect(readFileSync(join(dir, 'public/assets/logos/Coastline.svg'))).toEqual(bytes('public/assets/logos/Coastline.svg'));
    expect(readFileSync(join(dir, 'src/components/Parent.astro'), 'utf8')).toContain("from './Child.astro'");
  });
  it('rejects an invalid literal path in actual reused source before any asset write', async () => {
    put('src/components/Hero.astro', '<img src="/assets/../outside.webp"/>');
    expect(await materializeLibraryComponent(component('Hero'), project)).toMatchObject({ ok: false });
    expect(journal.since(0).entries).toEqual([]);
  });
  // fdd2d12f: assets are no longer POSTed one by one ahead of the component
  // (the old /bundled-asset failure window this test guarded). They ride in
  // the SAME durable file batch as the component, so a component can never
  // land without its assets — pin that atomicity instead.
  it('the component and its bundled assets are accepted as ONE atomic file batch', async () => {
    expect(await materializeLibraryComponent(component('Hero'), project)).toMatchObject({ ok: true });
    const rows = await listUnmaterialized(projectId);
    const batches = rows.flatMap(row => row.commands).filter(command => command.kind === 'file-batch');
    expect(batches).toHaveLength(1);
    const batchFiles = (batches[0] as { payload: { files: Array<{ file: string }> } }).payload.files.map(f => f.file);
    expect(batchFiles).toEqual(expect.arrayContaining([hero, 'src/components/Hero.astro']));
    expect(existsSync(join(dir, 'src/components/Hero.astro'))).toBe(false);
    await flush();
    expect(existsSync(join(dir, 'src/components/Hero.astro'))).toBe(true);
    expect(existsSync(join(dir, hero))).toBe(true);
  });
  it('refuses unavailable required bundled bytes before any write', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ...snapshot, files: { ...files, [hero]: undefined } })));
    expect(await materializeLibraryComponent(component('Hero'), project)).toMatchObject({ ok: false });
    expect(journal.since(0).entries).toEqual([]);
  });
});

describe('create-only path preserving binary route', () => {
  it('concurrent same-path creates preserve the first bytes and journal only one create', async () => {
    const responses = await Promise.all([assetPost(hero, Buffer.from('first')), assetPost(hero, Buffer.from('second'))]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(r => r.json()));
    expect(results.filter(r => r.created)).toHaveLength(1);
    expect(['first', 'second']).toContain(readFileSync(join(dir, hero), 'utf8'));
    expect(journal.since(0).entries.map(entry => entry.file)).toEqual([hero]);
  });
  it.each(['../outside.webp', '/public/assets/a.webp', 'public/assets/../outside.webp', 'public/assets/%2e%2e/out.webp', 'public/assets/a%2fb.webp', 'public/assets//a.webp', 'public/assets/./a.webp', 'public/assets/a\\b.webp', 'public/uploads/a.webp'])('refuses invalid path %s', async file => {
    expect((await assetPost(file)).status).toBe(400);
    expect(journal.since(0).entries).toEqual([]);
  });
  it('refuses directories and symlink parent/leaf escapes without touching their targets', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'sq-library-outside-'));
    try {
      mkdirSync(join(dir, 'public/assets'), { recursive: true });
      symlinkSync(outside, join(dir, 'public/assets/escape'));
      writeFileSync(join(outside, 'user.webp'), 'user');
      symlinkSync(join(outside, 'user.webp'), join(dir, 'public/assets/leaf.webp'));
      for (const file of ['public/assets/escape/new.webp', 'public/assets/leaf.webp', 'public/assets/escape']) {
        expect((await assetPost(file)).status).toBe(400);
      }
      expect(existsSync(join(outside, 'new.webp'))).toBe(false);
      expect(readFileSync(join(outside, 'user.webp'), 'utf8')).toBe('user');
      expect(journal.since(0).entries).toEqual([]);
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });
});
