// Owner 2026-11-11: a new collection's posts never showed in a Blog slot until the
// project was closed and reopened. Astro 7 dev, proven on the real runtime:
// - config EDITED while dev runs: the reload reads the cached old module with the new
//   file's digest → the store is resynced WITHOUT the new collection, and the later
//   correct reload has the same digest, so Astro never syncs again;
// - NO config at boot: Astro creates its content layer only at boot (core/dev/dev.js),
//   so a config written later is never synced at all.
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInstance } from '../src/supervisor.mjs';
import { ensureContentConfig } from '../src/astro-upgrade.mjs';

const templateDir = path.resolve(import.meta.dirname, '../../preview-template');
const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const roots = []; const instances = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map(i => i.stop()));
  await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true })));
});

const loader = name => `${name}: defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/${name}' }) })`;
const config = (...names) => `import { defineCollection } from 'astro:content';\nimport { glob } from 'astro/loaders';\nexport const collections = {\n  ${names.map(loader).join(',\n  ')},\n};\n`;
const page = (...names) => `---\nimport { getCollection } from 'astro:content';\n${names.map((n, i) => `const p${i} = await getCollection('${n}');`).join('\n')}\n---\n<html><body><p>${names.map((n, i) => `${n}={p${i}.length}`).join(' ')}</p></body></html>\n`;

async function open(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-collection-')); roots.push(dir);
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await fs.writeFile(path.join(dir, file), text); };
  for (const [file, text] of Object.entries({ 'package.json': '{"type":"module","dependencies":{"astro":"^7.4.5"}}', 'astro.config.mjs': 'export default {};\n', ...files })) await write(file, text);
  const inst = createInstance({ projectId: path.basename(dir), lease: crypto.randomUUID(), projectDir: dir, templateDir, depsDir });
  instances.push(inst); await inst.ready;
  const home = async () => (await (await inst.request('/')).text()).match(/<p[^>]*>([^<]*)<\/p>/)?.[1];
  /** What the canvas shows within `ms` (it reloads on every change). */
  const shows = async (expected, ms = 8000) => {
    let last;
    for (const deadline = Date.now() + ms; Date.now() < deadline; await new Promise(r => setTimeout(r, 200))) {
      last = await home().catch(() => last);
      if (last === expected) break;
    }
    return last;
  };
  return { dir, write, home, shows };
}

/** The editor's create-collection + bind order (localBlogScaffold.createLocalCollection, then the slot bind). */
async function createWorks({ write }, existing) {
  await write('src/content.config.ts', config(...existing, 'works'));
  await write('src/content/works/untitled-1.md', '---\ntitle: Untitled\n---\n');
  await write('src/pages/index.astro', page(...existing, 'works'));
}

it('a collection added to an existing content config shows its posts without a reopen', async () => {
  const site = await open({ 'src/content.config.ts': config('blog'), 'src/content/blog/a.md': '---\ntitle: A\n---\n', 'src/pages/index.astro': page('blog') });
  expect(await site.home()).toBe('blog=1');
  await createWorks(site, ['blog']);
  expect(await site.shows('blog=1 works=1')).toBe('blog=1 works=1');
  await site.write('src/content/works/second.md', '---\ntitle: Second\n---\n');
  expect(await site.shows('blog=1 works=2')).toBe('blog=1 works=2');
}, 120_000);

it("a project's FIRST collection (no content config at boot) shows its posts without a reopen", async () => {
  const site = await open({ 'src/pages/index.astro': '<html><body><p>home</p></body></html>\n' });
  expect(await site.home()).toBe('home');
  await createWorks(site, []);
  expect(await site.shows('works=1')).toBe('works=1');
}, 120_000);

it('ensureContentConfig: written only for a content-layer site without any content config', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-ensure-')); roots.push(dir);
  const put = async (file, text) => { await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await fs.writeFile(path.join(dir, file), text); };
  const has = () => fs.readFile(path.join(dir, 'src/content.config.ts'), 'utf8').catch(() => null);
  await put('package.json', '{"dependencies":{"astro":"^4.16.0"}}'); // legacy: Astro 4 reads src/content/config.*
  expect(await ensureContentConfig(dir)).toBe(false); expect(await has()).toBe(null);
  await put('package.json', '{"dependencies":{"astro":"^7.4.7"}}'); await put('src/content/config.ts', 'export const collections = {};\n');
  expect(await ensureContentConfig(dir)).toBe(false); expect(await has()).toBe(null); // a legacy-location config counts
  await fs.rm(path.join(dir, 'src/content'), { recursive: true }); await put('src/content.config.mjs', 'export const collections = {};\n');
  expect(await ensureContentConfig(dir)).toBe(false); expect(await has()).toBe(null); // any extension counts
  await fs.rm(path.join(dir, 'src/content.config.mjs'));
  expect(await ensureContentConfig(dir)).toBe(true); expect(await has()).toBe('export const collections = {};\n');
  expect(await ensureContentConfig(dir)).toBe(false); // idempotent
});
