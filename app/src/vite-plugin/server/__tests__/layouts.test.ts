import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

let base: string;       // container so "../preview-template" resolves inside the tmp dir
let root: string;       // app project root passed to the plugin
let layoutsDir: string;
let pagesDir: string;
let server: MockServer;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-layouts-'));
  root = path.join(base, 'app');
  layoutsDir = path.join(base, 'preview-template', 'src', 'layouts');
  pagesDir = path.join(base, 'preview-template', 'src', 'pages');
  await mkdir(root, { recursive: true });
  await mkdir(layoutsDir, { recursive: true });
  await mkdir(pagesDir, { recursive: true });
  server = configureMockServer(root);
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

async function call(route: string, body: unknown) {
  const handler = findRouteHandler(server, route);
  const captured = makeCapturedResponse();
  await handler(makeJsonRequest('POST', body), captured.res, () => {});
  await captured.done;
  return captured;
}

describe('layout endpoints', () => {
  it('save-layout writes the file ON DISK and notifies sq:layouts-changed', async () => {
    const r = await call('/__sq/save-layout', { name: 'Main', astroContent: '<slot />' });
    expect(r.status()).toBe(200);
    expect(await readFile(path.join(layoutsDir, 'Main.astro'), 'utf-8')).toBe('<slot />');
    expect(server.ws.send).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'sq:layouts-changed' }),
    );
  });

  it('save-layout rejects invalid names', async () => {
    const r = await call('/__sq/save-layout', { name: '../evil', astroContent: 'x' });
    expect(r.status()).toBe(400);
  });

  it('delete-layout refuses with 409 when a page imports the layout', async () => {
    await writeFile(path.join(layoutsDir, 'Main.astro'), '<slot />', 'utf-8');
    await writeFile(
      path.join(pagesDir, 'index.astro'),
      `---\nimport Main from '../layouts/Main.astro';\n---\n<Main />`,
      'utf-8',
    );
    const r = await call('/__sq/delete-layout', { name: 'Main' });
    expect(r.status()).toBe(409);
    expect(existsSync(path.join(layoutsDir, 'Main.astro'))).toBe(true);
  });

  it('delete-layout removes an unreferenced layout and returns its content', async () => {
    await writeFile(path.join(layoutsDir, 'Spare.astro'), '<slot name="x" />', 'utf-8');
    const r = await call('/__sq/delete-layout', { name: 'Spare' });
    expect(r.status()).toBe(200);
    expect((r.json() as { content: string }).content).toBe('<slot name="x" />');
    expect(existsSync(path.join(layoutsDir, 'Spare.astro'))).toBe(false);
  });

  it('rename-layout renames the file and rewrites page imports/tags', async () => {
    await writeFile(path.join(layoutsDir, 'Old.astro'), '<slot />', 'utf-8');
    const page = path.join(pagesDir, 'index.astro');
    await writeFile(page, `---\nimport Old from '../layouts/Old.astro';\n---\n<Old><p>x</p></Old>`, 'utf-8');
    const r = await call('/__sq/rename-layout', { oldName: 'Old', newName: 'Fresh' });
    expect(r.status()).toBe(200);
    expect(existsSync(path.join(layoutsDir, 'Fresh.astro'))).toBe(true);
    expect(existsSync(path.join(layoutsDir, 'Old.astro'))).toBe(false);
    const rewritten = await readFile(page, 'utf-8');
    expect(rewritten).toContain(`import Fresh from '../layouts/Fresh.astro'`);
    expect(rewritten).toContain('<Fresh>');
    expect(rewritten).toContain('</Fresh>');
  });

  it('layout-prop adds a prop to the layout frontmatter on disk', async () => {
    await writeFile(path.join(layoutsDir, 'Main.astro'), `---\nconst { title } = Astro.props;\n---\n<slot />`, 'utf-8');
    const r = await call('/__sq/layout-prop', { layoutName: 'Main', op: 'add', propName: 'subtitle' });
    expect(r.status()).toBe(200);
    expect(await readFile(path.join(layoutsDir, 'Main.astro'), 'utf-8')).toContain('subtitle');
  });
});
