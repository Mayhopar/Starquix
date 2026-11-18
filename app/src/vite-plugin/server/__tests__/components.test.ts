import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

let base: string;
let root: string;
let libDir: string;
let server: MockServer;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-components-'));
  root = path.join(base, 'app');
  libDir = path.join(base, 'preview-template', 'src', 'components', 'library');
  await mkdir(root, { recursive: true });
  await mkdir(libDir, { recursive: true });
  server = configureMockServer(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function post(route: string, body: unknown) {
  const handler = findRouteHandler(server, route);
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest('POST', body), captured.res, () => {});
  await captured.done;
  return captured;
}

describe('component endpoints', () => {
  it('save-component writes the .astro file ON DISK under the category dir', async () => {
    const r = await post('/__sq/save-component', {
      name: 'Hero', category: 'Marketing', astroContent: '<section>hi</section>', targetDir: 'built-in',
    });
    expect(r.status()).toBe(200);
    const file = path.join(libDir, 'marketing', 'Hero.astro');
    expect(await readFile(file, 'utf-8')).toBe('<section>hi</section>');
    expect(server.ws.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sq:components-changed' }),
    );
  });

  it('component-html strips frontmatter and serves the template', async () => {
    await writeFile(path.join(libDir, 'CTA.astro'), `---\nconst x = 1;\n---\n<button>Go</button>`, 'utf-8');
    const handler = findRouteHandler(server, '/__sq/component-html');
    const req = makeJsonRequest('GET');
    req.url = '/?path=library%2FCTA.astro';
    const captured = makeCapturedResponse();
    await handler(req, captured.res, () => {});
    await captured.done;
    expect(captured.body()).toBe('<button>Go</button>');
  });

  it('delete-component removes the file and returns its content for undo', async () => {
    const file = path.join(libDir, 'Old.astro');
    await writeFile(file, '<div>bye</div>', 'utf-8');
    const r = await post('/__sq/delete-component', { componentPath: 'library/Old.astro' });
    expect(r.status()).toBe(200);
    expect((r.json() as { content: string }).content).toBe('<div>bye</div>');
    expect(existsSync(file)).toBe(false);
  });
});

// Post-design surface (owner ask 2026-08-14): dynamic page routes ([slug].astro)
// are listed by the local scan so the Assets panel offers "design this page
// against fake data". Static pages stay out — they are already real pages.
describe('scan-components source=local lists dynamic page routes', () => {
  it('emits a Page designs entry per [param] page, skips static pages', async () => {
    const proj = path.join(base, 'user-proj');
    await mkdir(path.join(proj, 'src', 'components'), { recursive: true });
    await mkdir(path.join(proj, 'src', 'pages', 'works'), { recursive: true });
    await writeFile(path.join(proj, 'src', 'components', 'Foo.astro'), '<div>foo</div>');
    await writeFile(path.join(proj, 'src', 'pages', 'index.astro'), '<html></html>');
    await writeFile(path.join(proj, 'src', 'pages', 'works', '[slug].astro'), '<html></html>');

    const handler = findRouteHandler(server, '/__sq/scan-components');
    const captured = makeCapturedResponse();
    await handler(
      makeJsonRequest('GET', undefined, `/?source=local&path=${encodeURIComponent(proj)}`),
      captured.res,
      () => {},
    );
    await captured.done;
    const list = JSON.parse(captured.body()) as Array<{ path: string; category?: string; name: string }>;

    expect(list.some(c => c.path === 'src/components/Foo.astro')).toBe(true);
    const page = list.find(c => c.path === 'src/pages/works/[slug].astro');
    expect(page).toBeTruthy();
    expect(page?.category).toBe('Page designs');
    expect(page?.name).toBe('works/[slug]');
    expect(list.some(c => c.path === 'src/pages/index.astro')).toBe(false);
  });
});
