// The content editor's surface (/__sq_post_view/<collection>/<file>,
// preview-template/src/components/SqPostView.astro) must answer for a post
// created after the first post view. Same Astro 7 trap as the component view
// (HN report 2026-11-09): a getStaticPaths allowlist computed once and cached.
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
  'astro.config.mjs': "import mdx from '@astrojs/mdx';\nexport default { integrations: [mdx()] };\n",
  'src/content/config.ts': "import { defineCollection, z } from 'astro:content';\nconst blog = defineCollection({ type: 'content', schema: z.object({ title: z.string() }) });\nexport const collections = { blog };\n",
  'src/content/blog/first.md': '---\ntitle: First\n---\n# First heading\n',
  'src/pages/index.astro': '<html><body><h1>Home</h1></body></html>\n',
};

it('a post created after the first post view opens', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-post-view-')); roots.push(dir);
  for (const [file, text] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
  const inst = createInstance({ projectId: path.basename(dir), lease: crypto.randomUUID(), projectDir: dir, templateDir, depsDir });
  instances.push(inst); await inst.ready;
  const view = async key => { const res = await inst.request(`/__sq_post_view/${key}`); return { status: res.status, body: await res.text() }; };
  expect((await view('blog/first')).body).toContain('First heading'); // the first view computes the route
  await fs.writeFile(path.join(dir, 'src/content/blog/second.md'), '---\ntitle: Second\n---\n# Second heading\n');
  let last = { status: 0, body: '' };
  for (const deadline = Date.now() + 5000; Date.now() < deadline;) {
    last = await view('blog/second');
    if (last.status === 200 && last.body.includes('Second heading')) break;
    await new Promise(r => setTimeout(r, 150));
  }
  expect(last.status).toBe(200);
  expect(last.body).toContain('Second heading');
  expect((await view('blog/missing')).status).toBe(404);
}, 120_000);
