// @vitest-environment node
/**
 * Files-truth Phase 1 (2026-08-28): the /__sq/local/* route table is ONE JS
 * module served by the host (root from the request) AND by the sq plugin
 * inside a files-truth instance (root = its own). This proves:
 *   1. plugin-served routes answer byte-identical JSON to the host-served ones;
 *   2. `sqSourcePlugin({ bridgeJsPath })` registers them; without bridgeJsPath
 *      it registers none (law 3: unarmed servers stay byte-identical);
 *   3. the JS copies of the client rules (slugify / localPageId /
 *      resolveLocalPageDeletion) match app/src/utils.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerProjectFsRoutes, rootFromRequest } from '../../../../preview-template/src/plugins/sq-project-fs-routes.js';
import {
  slugify as jsSlugify, localPageId as jsLocalPageId, resolveLocalPageDeletion as jsResolveDeletion,
} from '../../../../preview-template/src/plugins/sq-project-fs.js';
// @ts-expect-error plain-JS preview-template plugin, no types
import { sqSourcePlugin } from '../../../../preview-template/src/plugins/sq-source-plugin.js';
import { slugify } from '../../utils/slugify';
import { localPageId, resolveLocalPageDeletion } from '../../utils/localMode';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

/** Minimal connect: prefix match on a path segment boundary, in registration order. */
function fakeServer() {
  const routes: Array<{ route: string; handler: Handler }> = [];
  const middlewares = {
    use(route: string | Handler, handler?: Handler) {
      if (typeof route === 'function') routes.push({ route: '', handler: route });
      else routes.push({ route, handler: handler! });
    },
  };
  const ws = { send() {}, on() {} };
  const http = createServer((req, res) => {
    const url = req.url ?? '/';
    const pathname = url.split('?')[0];
    const matching = routes.filter(r => r.route === '' || pathname === r.route || pathname.startsWith(r.route + '/'));
    let i = 0;
    const next = () => {
      const r = matching[i++];
      if (!r) { res.statusCode = 404; res.end('nope'); return; }
      r.handler(req, res, next);
    };
    next();
  });
  return { middlewares, ws, http, routes, httpServer: http };
}

function scaffold(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sq-fs-parity-'));
  mkdirSync(join(dir, 'src', 'pages', 'blog'), { recursive: true });
  mkdirSync(join(dir, 'src', 'content', 'posts'), { recursive: true });
  mkdirSync(join(dir, 'src', 'components'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"dependencies":{"astro":"^4"}}');
  writeFileSync(join(dir, 'src', 'pages', 'index.astro'), '---\n---\n<h1>Home</h1>');
  writeFileSync(join(dir, 'src', 'pages', 'about.astro'), '---\n---\n<h1>About</h1>');
  writeFileSync(join(dir, 'src', 'pages', 'blog', '[slug].astro'), '---\n---\n<h1>Post</h1>');
  writeFileSync(join(dir, 'src', 'content', 'posts', 'hello.md'), '---\ntitle: Hello\n---\nHi');
  writeFileSync(join(dir, 'src', 'components', 'Card.astro'), '---\ninterface Props { title: string }\n---\n<div class="card"><slot /></div>');
  writeFileSync(join(dir, 'public', 'logo.svg'), '<svg/>');
  return dir;
}

const repoRoot = resolve(__dirname, '..', '..', '..', '..');
const sqComponentsDir = join(repoRoot, 'preview-template', 'src', 'components');

async function listen(s: Server): Promise<string> {
  await new Promise<void>(r => s.listen(0, '127.0.0.1', () => r()));
  const { port } = s.address() as { port: number };
  return `http://127.0.0.1:${port}`;
}

describe('sq-project-fs routes: host-served ≡ plugin-served', () => {
  let hostDir: string;
  let pluginDir: string;
  let hostUrl: string;
  let pluginUrl: string;
  const servers: Server[] = [];

  beforeAll(async () => {
    hostDir = scaffold();
    pluginDir = scaffold();
    const host = fakeServer();
    registerProjectFsRoutes(host, { resolveRoot: rootFromRequest, sqComponentsDir });
    const plugin = fakeServer();
    registerProjectFsRoutes(plugin, { resolveRoot: () => pluginDir, sqComponentsDir });
    servers.push(host.http, plugin.http);
    hostUrl = await listen(host.http);
    pluginUrl = await listen(plugin.http);
  });

  afterAll(() => {
    for (const s of servers) s.close();
    rmSync(hostDir, { recursive: true, force: true });
    rmSync(pluginDir, { recursive: true, force: true });
  });

  /** Same call against both; plugin gets NO ?path (its root is its own). */
  async function both(
    route: string, init?: RequestInit, hostQuery = '',
  ): Promise<{ host: string; plugin: string; status: [number, number] }> {
    const q = route.includes('?') ? '&' : '?';
    const h = await fetch(`${hostUrl}${route}${q}path=${encodeURIComponent(hostDir)}${hostQuery}`, init);
    const p = await fetch(`${pluginUrl}${route}`, init);
    return { host: await h.text(), plugin: await p.text(), status: [h.status, p.status] };
  }

  it('GET pages', async () => {
    const r = await both('/__sq/local/pages');
    expect(r.status).toEqual([200, 200]);
    expect(r.plugin).toBe(r.host);
    expect(JSON.parse(r.plugin).pages.map((p: { route: string }) => p.route)).toEqual(['/', '/about', '/blog/[slug]']);
  });

  it('POST page-plan (query root vs own root) → same plan, nothing written', async () => {
    const r = await both('/__sq/local/page-plan', { method: 'POST', body: JSON.stringify({ action: 'create', name: 'Contact Us' }) });
    expect(r.status).toEqual([200, 200]);
    expect(r.plugin).toBe(r.host);
    expect(JSON.parse(r.plugin)).toMatchObject({ route: '/contact-us', file: 'src/pages/contact-us.astro', editable: true,
      files: [{ file: 'src/pages/contact-us.astro', beforeSource: null }] });
    expect(existsSync(join(pluginDir, 'src/pages/contact-us.astro'))).toBe(false);
  });

  it('GET content', async () => {
    const r = await both('/__sq/local/content');
    expect(r.plugin).toBe(r.host);
    expect(JSON.parse(r.plugin).files).toEqual({ 'src/content/posts/hello.md': '---\ntitle: Hello\n---\nHi' });
  });

  it('GET assets / GET scan-components / GET scan-layouts', async () => {
    for (const route of ['/__sq/local/assets', '/__sq/local/scan-components', '/__sq/local/scan-layouts']) {
      const r = await both(route);
      expect(r.status, route).toEqual([200, 200]);
      expect(r.plugin, route).toBe(r.host);
    }
    const scanned = JSON.parse((await both('/__sq/local/scan-components')).plugin);
    expect(scanned.map((c: { path: string }) => c.path)).toEqual(['src/components/Card.astro', 'src/pages/blog/[slug].astro']);
  });

  it('component-create / component-delete round-trip', async () => {
    const create = { method: 'POST', body: JSON.stringify({ path: hostDir, name: 'Hero', astroContent: '<section/>' }) };
    const r1 = await both('/__sq/local/component-create', create);
    expect(r1.status).toEqual([200, 200]);
    expect(r1.plugin).toBe(r1.host);
    const del = { method: 'POST', body: JSON.stringify({ path: hostDir, componentPath: 'src/components/Hero.astro' }) };
    const r2 = await both('/__sq/local/component-delete', del);
    expect(r2.plugin).toBe(r2.host);
    expect(JSON.parse(r2.plugin)).toEqual({ success: true, content: '<section/>' });
  });

  it('responses carry the cross-origin headers the editor needs', async () => {
    const p = await fetch(`${pluginUrl}/__sq/local/pages`);
    expect(p.headers.get('access-control-allow-origin')).toBe('*');
    expect(p.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
  });

  it('host: unknown root → 400 (plugin never needs a path)', async () => {
    const h = await fetch(`${hostUrl}/__sq/local/pages?path=/definitely/not/here`);
    expect(h.status).toBe(200); // pages tolerates a missing src/pages → []
    expect(await h.json()).toEqual({ pages: [] });
    const c = await fetch(`${hostUrl}/__sq/local/content?path=/definitely/not/here`);
    expect(c.status).toBe(400);
  });
});

describe('sqSourcePlugin wiring', () => {
  it('registers the /__sq/local/* table only when bridgeJsPath is set', () => {
    const bridgeJsPath = join(repoRoot, 'preview-template', 'public', 'scripts', 'bridge.js');
    const armed = fakeServer();
    const p = sqSourcePlugin({ bridgeJsPath });
    p.configResolved({ root: '/tmp/x' });
    p.configureServer(armed);
    const armedRoutes = armed.routes.map(r => r.route);
    expect(armedRoutes).toContain('/__sq/local/pages');
    expect(armedRoutes).toContain('/__sq/local/source-command');
    expect(armedRoutes).toContain('/__sq/local/component-create');
    expect(armedRoutes).toContain('/__sq/local/folders');
    expect(armedRoutes).not.toContain('/__sq/local-proxy'); // proxy page removed (desktop IPC)

    const bare = fakeServer();
    const q = sqSourcePlugin({});
    q.configResolved({ root: '/tmp/x' });
    q.configureServer(bare);
    expect(bare.routes.filter(r => r.route.startsWith('/__sq/local/'))).toEqual([]);
  });
});

describe('JS copies of client rules match app/src/utils', () => {
  it('slugify', () => {
    for (const s of ['Contact Us', 'Q&A', '  hello--world ', '!!!', 'Über']) expect(jsSlugify(s)).toBe(slugify(s));
  });
  it('localPageId', () => {
    for (const r of ['/', '/about', '/blog/[slug]', '/a b/c']) expect(jsLocalPageId(r)).toBe(localPageId(r));
  });
  it('resolveLocalPageDeletion', () => {
    const pages = [
      { route: '/', file: 'src/pages/index.astro' },
      { route: '/about', file: 'src/pages/about.astro' },
      { route: '/blog/[slug]', file: 'src/pages/blog/[slug].astro', dynamic: true },
      { route: '/notes', file: 'src/pages/notes.md' },
    ];
    for (const id of ['index', 'about', 'blog-[slug]', 'notes', 'missing']) {
      expect(jsResolveDeletion(pages, id)).toEqual(resolveLocalPageDeletion(pages, id));
    }
    expect(jsResolveDeletion([pages[0]], 'index')).toEqual(resolveLocalPageDeletion([pages[0]], 'index'));
  });
});

describe('files-truth write-through: the change journal + raw file reads', () => {
  let dir: string;
  let url: string;
  let srv: Server;
  beforeAll(async () => {
    dir = scaffold();
    const s = fakeServer();
    registerProjectFsRoutes(s, { resolveRoot: () => dir, sqComponentsDir });
    srv = s.http;
    url = await listen(srv);
  });
  afterAll(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });

  it('every mutating route records what it touched; /changes replays since a seq; /file reads bytes', async () => {
    // `epoch` names this journal: a restart starts a new one (filesTruthSync replays it from 0).
    const fresh = await (await fetch(`${url}/__sq/local/changes?since=0`)).json() as { epoch: string };
    expect(fresh).toEqual({ epoch: expect.any(String), seq: 0, entries: [] });
    await fetch(`${url}/__sq/local/write-file`, { method: 'POST', body: JSON.stringify({ file: 'src/pages/journal.astro', content: '<h1>Journal</h1>' }) });
    await fetch(`${url}/__sq/local/component-create`, { method: 'POST', body: JSON.stringify({ name: 'J', astroContent: '<j/>' }) });
    await fetch(`${url}/__sq/local/component-delete`, { method: 'POST', body: JSON.stringify({ componentPath: 'src/components/J.astro' }) });
    await fetch(`${url}/__sq/local/folders`, { method: 'POST', body: JSON.stringify({ manifest: { version: 1, roots: [], folders: {} } }) });
    const { seq, entries } = await (await fetch(`${url}/__sq/local/changes?since=0`)).json() as { seq: number; entries: Array<{ file: string; kind: string }> };
    expect(seq).toBe(4);
    expect(entries.map((e) => `${e.kind} ${e.file}`)).toEqual([
      'change src/pages/journal.astro',
      'change src/components/J.astro',
      'unlink src/components/J.astro',
      'change .starquix/folders.json',
    ]);
    const later = await (await fetch(`${url}/__sq/local/changes?since=2`)).json() as { epoch: string; entries: Array<{ seq: number }> };
    expect(later.entries.map((e) => e.seq)).toEqual([3, 4]);
    expect(later.epoch).toBe(fresh.epoch);

    // write-file: text into src/ or public/, plus the root astro.config / package.json (SEO site settings,
    // task-248), journaled; refuses elsewhere
    const wf = await fetch(`${url}/__sq/local/write-file`, { method: 'POST', body: JSON.stringify({ file: 'src/styles/sq-variables.css', content: ':root{--a:1}' }) });
    expect(await wf.json()).toEqual({ ok: true, file: 'src/styles/sq-variables.css' });
    expect(readFileSync(join(dir, 'src/styles/sq-variables.css'), 'utf8')).toBe(':root{--a:1}');
    const pkg = await fetch(`${url}/__sq/local/write-file`, { method: 'POST', body: JSON.stringify({ file: 'package.json', content: '{}\n' }) });
    expect(await pkg.json()).toEqual({ ok: true, file: 'package.json' });
    for (const bad of ['tsconfig.json', 'src/../.env', 'nested/package.json', '../x.css', 'node_modules/x.css', '.sq/x.css']) {
      expect((await fetch(`${url}/__sq/local/write-file`, { method: 'POST', body: JSON.stringify({ file: bad, content: 'x' }) })).status, bad).toBe(400);
    }
    const afterWrite = await (await fetch(`${url}/__sq/local/changes?since=4`)).json() as { entries: Array<{ file: string }> };
    expect(afterWrite.entries.map((e) => e.file)).toEqual(['src/styles/sq-variables.css', 'package.json']);

    const bytes = await (await fetch(`${url}/__sq/local/file?file=src/pages/journal.astro`)).text();
    expect(bytes).toBe(readFileSync(join(dir, 'src/pages/journal.astro'), 'utf8'));
    expect((await fetch(`${url}/__sq/local/file?file=../etc/passwd`)).status).toBe(400);
    expect((await fetch(`${url}/__sq/local/file?file=node_modules/x.js`)).status).toBe(400);
    expect((await fetch(`${url}/__sq/local/file?file=.sq/x.js`)).status).toBe(400);
    expect((await fetch(`${url}/__sq/local/file?file=src/pages/nope.astro`)).status).toBe(404);
    // Existence probes opt into a quiet answer (no red 404 in the browser console).
    const probe = await fetch(`${url}/__sq/local/file?file=src/pages/nope.astro&probe=1`);
    expect(probe.status).toBe(200);
    expect(probe.headers.get('x-sq-missing')).toBe('1');
    expect(await probe.text()).toBe('');
    expect((await fetch(`${url}/__sq/local/file?file=src/pages/journal.astro&probe=1`)).headers.get('x-sq-missing')).toBeNull();
  });
});
