// Assets → a library component is COPIED into src/components, then opened at
// /__sq_component_view/<file> (preview-template/src/components/SqComponentView.astro).
// HN report 2026-11-09: "404 on almost all of the Assets". Astro 7 dev caches a
// route's getStaticPaths() until that route module reloads, so an allowlist
// computed from the disk never saw a file copied in after the first view.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInstance } from '../src/supervisor.mjs';

const templateDir = path.resolve(import.meta.dirname, '../../preview-template');
const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const roots = []; const instances = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map(i => i.stop()));
  await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true })));
});

const FILES = {
  'package.json': '{"type":"module"}',
  'astro.config.mjs': 'export default {};\n',
  'src/pages/index.astro': '<html><body><h1>Home</h1></body></html>\n',
  'src/pages/about.astro': '<html><body><h1>About</h1></body></html>\n',
  'src/pages/blog/[slug].astro': "---\nexport function getStaticPaths() { return [{ params: { slug: 'a' } }]; }\n---\n<html><body><h1>Post</h1></body></html>\n",
  'src/components/Existing.astro': '<section><h2>Existing</h2></section>\n',
  'src/layouts/Base.astro': '<html><body><slot /></body></html>\n',
};
async function open() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-view-')); roots.push(dir);
  for (const [file, text] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
  const inst = createInstance({ projectId: path.basename(dir), lease: crypto.randomUUID(), projectDir: dir, templateDir, depsDir });
  instances.push(inst); await inst.ready;
  const view = async file => { const res = await inst.request(`/__sq_component_view/${file}`); return { status: res.status, body: await res.text() }; };
  // What the editor does (waitForComponentView): ask every 150 ms for up to `ms`.
  // A request that outlives the proxy's own 10 s timeout (a first compile on a
  // loaded machine) counts as "not yet", not as a failure.
  const opens = async (file, ms = 5000) => {
    let last = { status: 0, body: '' };
    for (const deadline = Date.now() + ms; Date.now() < deadline;) {
      last = await view(file).catch(() => last);
      if (last.status === 200) break;
      await new Promise(r => setTimeout(r, 150));
    }
    return last;
  };
  return { dir, view, opens };
}

it('a component copied in AFTER the first component view opens — no 404 (HN 2026-11-09)', async () => {
  const { dir, view, opens } = await open();
  expect((await view('src/components/Existing.astro')).status).toBe(200); // the first view computes the route
  await fs.writeFile(path.join(dir, 'src/components/Hero3.astro'), '<section><h1>Hero3 copied</h1></section>\n');
  const last = await opens('src/components/Hero3.astro');
  expect(last.status).toBe(200);
  expect(last.body).toContain('Hero3 copied');
  expect(last.body).toContain('data-sq-source="src/components/Hero3.astro'); // tagged: selectable + writable
}, 120_000);

it('only real component/layout/dynamic-page files open; everything else is a 404', async () => {
  const { view } = await open();
  expect((await view('src/layouts/Base.astro')).status).toBe(200);
  expect((await view('src/pages/blog/[slug].astro')).status).toBe(200);
  for (const file of [
    'src/components/Missing.astro', // not on disk
    'src/pages/about.astro', // a static page is edited as a page, not here
    'src/components', // a folder
    'astro.config.mjs', // outside the editable roots
    'src/components/../pages/about.astro',
    'src/components/%2e%2e/pages/about.astro',
    'src/components/.hidden.astro',
  ]) expect([file, (await view(file)).status]).toEqual([file, 404]);
}, 120_000);

it('after the first view, a rename, a new layout and a new dynamic page each open (all 404 on the 0.3.0 runtime)', async () => {
  const { dir, view, opens } = await open();
  expect((await view('src/components/Existing.astro')).status).toBe(200);
  await fs.rename(path.join(dir, 'src/components/Existing.astro'), path.join(dir, 'src/components/Renamed.astro'));
  const renamed = (await opens('src/components/Renamed.astro')).status;
  const oldName = (await view('src/components/Existing.astro')).status; // never a stale render of a file that is gone
  await fs.writeFile(path.join(dir, 'src/layouts/Fresh.astro'), '<html><body><main>Fresh layout</main><slot /></body></html>\n');
  const layout = (await opens('src/layouts/Fresh.astro')).status;
  // Last: on the old runtime a new ROUTE file could refresh the cache for everything after it.
  await fs.mkdir(path.join(dir, 'src/pages/docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/pages/docs/[slug].astro'), "---\nexport function getStaticPaths() { return [{ params: { slug: 'x' } }]; }\n---\n<html><body><h1>Doc</h1></body></html>\n");
  const page = (await opens('src/pages/docs/[slug].astro')).status;
  expect({ renamed, oldName, layout, page }).toEqual({ renamed: 200, oldName: 404, layout: 200, page: 200 });
}, 120_000);

// The copier-level catalog test (app) cannot see a component that copies fine
// but renders nothing on its own (BlogPaginationNumbered threw on the view's
// stub props: "Cannot read properties of undefined (reading 'current')").
it('every listed top-level library component renders at least one selectable element on its own', async () => {
  const { dir, opens } = await open();
  const library = path.join(templateDir, 'src/components/library');
  await fs.cp(library, path.join(dir, 'src/components/library'), { recursive: true });
  const blank = [];
  for (const name of (await fs.readdir(library)).filter(f => f.endsWith('.astro')).sort()) {
    if (/@page-template/.test(await fs.readFile(path.join(library, name), 'utf8'))) continue; // never listed (BlogPost)
    const { status, body } = await opens(`src/components/library/${name}`, 30_000); // render, not speed, is the question
    if (status !== 200 || !body.includes(`data-sq-source="src/components/library/${name}:`)) blank.push(`${name} (${status})`);
  }
  expect(blank).toEqual([]);
}, 300_000);
