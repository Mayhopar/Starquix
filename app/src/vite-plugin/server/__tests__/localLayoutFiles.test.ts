/**
 * A local project's layouts are planned against ITS OWN src/layouts — never the
 * shared preview-template. /__sq/local/layout-plan only reads: it answers the
 * exact file group the editor journals and source-command writes, so every
 * test here also proves the disk is untouched.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { configureMockServer, findRouteHandler, makeJsonRequest, makeCapturedResponse, type MockServer } from './mockServer';

let base: string, root: string, userDir: string, server: MockServer;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sq-locallayouts-'));
  root = path.join(base, 'app');
  userDir = path.join(base, 'their-site');
  await mkdir(root, { recursive: true });
  await mkdir(path.join(userDir, 'src', 'layouts'), { recursive: true });
  server = configureMockServer(root);
});
afterEach(async () => { await rm(base, { recursive: true, force: true }); });

type Plan = { files: Array<{ file: string; beforeSource: string | null; afterSource: string | null }> };

async function plan(body: Record<string, unknown>) {
  const route = '/__sq/local/layout-plan';
  const captured = makeCapturedResponse();
  await findRouteHandler(server, route)(makeJsonRequest('POST', { path: userDir, ...body }, route), captured.res, () => {});
  await captured.done;
  return captured;
}

describe('/__sq/local/layout-plan create', () => {
  it('plans the file under the project src/layouts and writes nothing', async () => {
    const res = await plan({ action: 'create', name: 'Layout1', astroContent: '<slot />' });
    expect(res.status()).toBe(200);
    expect(res.json()).toEqual({ files: [{ file: 'src/layouts/Layout1.astro', beforeSource: null, afterSource: '<slot />' }] });
    expect(existsSync(path.join(userDir, 'src', 'layouts', 'Layout1.astro'))).toBe(false);
  });

  // The scaffold carries preview-template's `import '../styles/global.css'`.
  // A user's own project usually has no src/styles — Astro then fails the whole
  // route with "Failed to load url ../styles/global.css", so the brand-new
  // layout renders as a red error instead of a page.
  it('drops a bare CSS import the project cannot resolve, keeps one it has', async () => {
    const scaffold = "---\nimport '../styles/global.css';\ninterface Props { title?: string; }\n---\n<slot />\n";
    const dropped = (await plan({ action: 'create', name: 'Layout1', astroContent: scaffold })).json() as Plan;
    expect(dropped.files[0].afterSource).toBe("---\ninterface Props { title?: string; }\n---\n<slot />\n");
    await mkdir(path.join(userDir, 'src', 'styles'), { recursive: true });
    await writeFile(path.join(userDir, 'src', 'styles', 'global.css'), 'body{}', 'utf-8');
    const kept = (await plan({ action: 'create', name: 'Layout1', astroContent: scaffold })).json() as Plan;
    expect(kept.files[0].afterSource).toBe(scaffold);
  });

  it('refuses an unknown project folder', async () => {
    const res = await plan({ path: path.join(base, 'nope'), action: 'create', name: 'Layout1', astroContent: '<slot />' });
    expect(res.status()).toBe(400);
  });

  // The name is interpolated into a path — a traversing name must never escape.
  it('refuses a name that escapes the layouts root', async () => {
    const res = await plan({ action: 'create', name: '../../pwned', astroContent: 'x' });
    expect(res.status()).toBe(400);
  });
});

// ── task-209: delete a layout the user's own pages import ────────────────

const LAYOUT_SRC = `---
import '../styles/global.css';
const { title = 'L' } = Astro.props;
---
<!doctype html>
<html><head><title>{title}</title></head>
<body><slot /><script is:inline src="/scripts/bridge.js"></script></body></html>
`;

async function writeTree(files: Record<string, string>) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(userDir, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf-8');
  }
}

describe('/__sq/local/layout-plan inline-delete', () => {
  it('plans every direct importer standing on its own, then the layout unlink', async () => {
    const tree = {
      'src/layouts/Foo.astro': LAYOUT_SRC,
      'src/styles/global.css': 'body{}',
      'src/pages/index.astro': "---\nimport Foo from '../layouts/Foo.astro';\n---\n<Foo title=\"Home\"><h1>Hi</h1></Foo>\n",
      'src/pages/blog/index.astro': "---\nimport Foo from '../../layouts/Foo.astro';\n---\n<Foo><p>b</p></Foo>\n",
      // C4: a layout importing the layout is a direct importer too.
      'src/layouts/Wrap.astro': "---\nimport Foo from './Foo.astro';\n---\n<Foo><slot /></Foo>\n",
    };
    await writeTree(tree);

    const res = await plan({ action: 'inline-delete', name: 'Foo' });
    expect(res.status()).toBe(200);
    const { files } = res.json() as Plan;
    expect(files.map((f) => f.file)).toEqual([
      'src/layouts/Wrap.astro', 'src/pages/blog/index.astro', 'src/pages/index.astro', 'src/layouts/Foo.astro',
    ]);
    expect(files[3]).toEqual({ file: 'src/layouts/Foo.astro', beforeSource: LAYOUT_SRC, afterSource: null });
    const [wrap, nested, home] = files.map((f) => f.afterSource ?? '');
    expect(home).toContain('<!doctype html>');
    expect(home).toContain('/scripts/bridge.js');
    expect(home).toContain('<h1>Hi</h1>');
    expect(home).toContain("import '../styles/global.css';");
    expect(home).not.toContain('layouts/Foo.astro');
    // C9: the nested page's CSS import moved with it.
    expect(nested).toContain("import '../../styles/global.css';");
    expect(wrap).not.toContain('./Foo.astro');
    // A plan, not a write: source-command writes the group once it is accepted.
    for (const [file, content] of Object.entries(tree)) {
      expect(await readFile(path.join(userDir, file), 'utf-8')).toBe(content);
    }
  });

  it('refuses when one file uses the layout twice (C7)', async () => {
    await writeTree({
      'src/layouts/Foo.astro': LAYOUT_SRC,
      'src/pages/twice.astro': "---\nimport Foo from '../layouts/Foo.astro';\n---\n<Foo><p>a</p></Foo>\n<Foo><p>b</p></Foo>\n",
      'src/pages/ok.astro': "---\nimport Foo from '../layouts/Foo.astro';\n---\n<Foo><p>c</p></Foo>\n",
    });
    expect((await plan({ action: 'inline-delete', name: 'Foo' })).status()).toBe(409);
  });

  // `delete` is the reverse of create: it never inlines.
  it.each(['delete', 'inline-delete'])('%s of a layout nobody imports plans only the unlink (C1)', async (action) => {
    await writeTree({ 'src/layouts/Foo.astro': LAYOUT_SRC });
    const res = await plan({ action, name: 'Foo' });
    expect(res.status()).toBe(200);
    expect(res.json()).toEqual({ files: [{ file: 'src/layouts/Foo.astro', beforeSource: LAYOUT_SRC, afterSource: null }] });
  });

  it('404s on a layout that is not there', async () => {
    expect((await plan({ action: 'inline-delete', name: 'Nope' })).status()).toBe(404);
  });
});
