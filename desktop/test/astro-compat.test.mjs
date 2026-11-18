// An Astro 4 site on the shared Astro 6 runtime, files untouched (preview-template/src/plugins/sq-astro-compat.js):
// the canvas (real instance through the wrapper config) and the publish build (never the wrapper) must both render it.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInstance } from '../src/supervisor.mjs';
import { buildSite, checkSite } from '../src/site-build.mjs';
import { sqAstroCompat } from '../../preview-template/src/plugins/sq-astro-compat.js';

const templateDir = path.resolve(import.meta.dirname, '../../preview-template');
const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const roots = []; const instances = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map(i => i.stop()));
  await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true })));
});
const FILES = {
  'package.json': '{"type":"module"}',
  'astro.config.mjs': "import tailwind from '@astrojs/tailwind';\nimport mdx from '@astrojs/mdx';\nexport default { integrations: [tailwind(), mdx()] };\n",
  'tailwind.config.mjs': "export default { content: ['./src/**/*.{astro,md,mdx}'] };\n",
  'src/content/config.ts': "import { defineCollection, z } from 'astro:content';\nconst blog = defineCollection({ type: 'content', schema: z.object({ title: z.string() }) });\nexport const collections = { blog };\n",
  'src/content/blog/hello-post.md': '---\ntitle: Hello\n---\n# Hello heading\n',
  'src/content/blog/world.mdx': '---\ntitle: World\n---\n# World heading\n',
  'src/pages/index.astro': "---\nimport { getCollection } from 'astro:content';\nconst posts = await getCollection('blog');\n---\n<html><body><h1 class=\"text-red-500\">Home</h1>{posts.map(p => <a href={`/blog/${p.slug}`}>{p.data.title}</a>)}</body></html>\n",
  'src/pages/blog/[...slug].astro': "---\nimport { getCollection } from 'astro:content';\nexport async function getStaticPaths() { const posts = await getCollection('blog'); return posts.map(entry => ({ params: { slug: entry.slug }, props: { entry } })); }\nconst { entry } = Astro.props;\nconst { Content } = await entry.render();\n---\n<html><body><Content /></body></html>\n",
  'src/pages/lookups.astro': "---\nimport { getEntry, getEntryBySlug, getCollection } from 'astro:content';\nconst a = await getEntry('blog', 'hello-post');\nconst b = await getEntryBySlug('blog', 'world');\nconst c = await getCollection('blog', e => e.slug === 'world');\n---\n<html><body><p>lookups:{a.slug}|{a.id}|{b.slug}|{c.length}</p></body></html>\n",
  'src/pages/globbed.astro': "---\nconst posts = await Astro.glob('../content/blog/*.md');\n---\n<html><body><p>globbed:{posts.length}:{posts[0].frontmatter.title}</p></body></html>\n",
  'src/pages/from-glob/[slug].astro': "---\nexport async function getStaticPaths() { const posts = await Astro.glob<any>(\"../../content/blog/*.md\"); return posts.map(p => ({ params: { slug: p.frontmatter.title } })); }\n---\n<html><body><p>from-glob:{Astro.params.slug}</p></body></html>\n",
  'src/pages/transitions.astro': "---\nimport { ViewTransitions } from 'astro:transitions';\n---\n<html><head><ViewTransitions /></head><body><h1>Transitions page</h1></body></html>\n",
};
async function site() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-compat-')); roots.push(dir);
  for (const [file, text] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
  return dir;
}

it('leaves a project on its own Astro 4 alone: the module already has ViewTransitions, no ClientRouter exists', () => {
  const transform = sqAstroCompat().find(p => p.name === 'sq-astro-compat-modules').transform;
  expect(transform('export { default as ViewTransitions } from "astro/components/ViewTransitions.astro";', '\0astro:transitions')).toBeNull();
  expect(transform('export { default as ClientRouter } from "astro/components/ClientRouter.astro";', '\0astro:transitions').code).toContain('as ViewTransitions');
});

it('a site with src/content/<dir> and no content config still gets its collection, as Astro 4 auto-generated it', async () => {
  const dir = await site();
  await fs.rm(path.join(dir, 'src/content/config.ts'));
  const inst = createInstance({ projectId: path.basename(dir), lease: crypto.randomUUID(), projectDir: dir, templateDir, depsDir });
  instances.push(inst); await inst.ready;
  expect(await (await inst.request('/')).text()).toContain('href="/blog/hello-post"');
  expect(await fs.readFile(path.join(dir, 'src/content/config.ts'), 'utf8')).toBe('export const collections = {};\n');
}, 120_000);

it('the canvas renders an Astro 4 site: collections, entry.slug/render(), slug lookups, ViewTransitions, tags, Tailwind', async () => {
  const dir = await site();
  const inst = createInstance({ projectId: path.basename(dir), lease: crypto.randomUUID(), projectDir: dir, templateDir, depsDir });
  instances.push(inst); await inst.ready;
  const page = async route => { const res = await inst.request(route); return { status: res.status, body: await res.text() }; };
  const home = await page('/');
  expect(home.body).toContain('href="/blog/hello-post"');
  expect(home.body).toContain('data-sq-source=');
  expect(home.body).toMatch(/\.text-red-500\s*\{/);
  expect((await page('/blog/hello-post')).body).toContain('Hello heading');
  expect((await page('/blog/world')).body).toContain('World heading');
  expect((await page('/lookups')).body).toContain('lookups:hello-post|hello-post.md|world|1');
  expect((await page('/transitions')).body).toContain('Transitions page');
  expect((await page('/globbed')).body).toContain('globbed:1:Hello');
  expect((await page('/from-glob/Hello')).body).toContain('from-glob:Hello');
  expect((await page('/__sq_post_view/blog/hello-post')).body).toContain('Hello heading');
}, 120_000);

it('the publish build renders the same site, the project folder keeps its Astro 4 files', async () => {
  const dir = await site();
  await fs.symlink(depsDir, path.join(dir, 'node_modules'), 'junction');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-compat-tmp-')); roots.push(tmpRoot);
  const built = Object.fromEntries((await buildSite(dir, { tmpRoot })).map(f => [f.path, f.bytes.toString()]));
  expect(built['/index.html']).toContain('href="/blog/hello-post"');
  expect(built['/blog/hello-post/index.html']).toContain('Hello heading');
  expect(built['/blog/world/index.html']).toContain('World heading');
  expect(built['/lookups/index.html']).toContain('lookups:hello-post|hello-post.md|world|1');
  expect(built['/transitions/index.html']).toContain('Transitions page');
  expect(built['/globbed/index.html']).toContain('globbed:1:Hello');
  expect(built['/from-glob/Hello/index.html']).toContain('from-glob:Hello');
  expect(await fs.readFile(path.join(dir, 'src/content/config.ts'), 'utf8')).toBe(FILES['src/content/config.ts']);
}, 120_000);

it('the pre-publish check runs on an Astro 4 site instead of failing on its content config', async () => {
  const dir = await site();
  await fs.symlink(depsDir, path.join(dir, 'node_modules'), 'junction');
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module","scripts":{"build":"astro check && astro build"},"dependencies":{"@astrojs/check":"*","typescript":"*"}}');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-compat-tmp-')); roots.push(tmpRoot);
  const check = await checkSite(dir, { tmpRoot });
  expect(check.ran).toBe(true);
  // The restored API is no type error at publish either (nor the implicit any of untyped legacy entries on Astro 7).
  expect(check.errors.map(e => e.message)).toEqual([]);
  await fs.writeFile(path.join(dir, 'src/pages/broken.astro'), "---\nconst n: number = 'text';\n---\n<p>{n}</p>\n");
  expect((await checkSite(dir, { tmpRoot })).errors.map(e => e.message)).toEqual(["Type 'string' is not assignable to type 'number'."]); // a real error still shows
}, 120_000);
