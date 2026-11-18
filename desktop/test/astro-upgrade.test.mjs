// desktop/src/astro-upgrade.mjs: an old site's files move to the shared Astro only when the rewrite builds to the same
// pages without the compat shim; anything else leaves the site exactly as it was.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planUpgrade, samePages, upgradeContentConfig, upgradePackage, upgradeSite, upgradeSource } from '../src/astro-upgrade.mjs';
import { createInstance } from '../src/supervisor.mjs';

const templateDir = path.resolve(import.meta.dirname, '../../preview-template');
const depsDir = path.resolve(import.meta.dirname, '../runtime-deps/node_modules');
const RUNTIME_ASTRO = JSON.parse(readFileSync(path.join(depsDir, 'astro/package.json'), 'utf8')).version; // the real site upgrades to whatever the runtime ships
const V = { astro: '7.4.5', '@astrojs/mdx': '8.1.2', '@astrojs/tailwind': '6.0.2', '@astrojs/markdown-remark': '7.3.5' };
const roots = []; const instances = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map(i => i.stop()));
  await Promise.all(roots.splice(0).map(p => fs.rm(p, { recursive: true, force: true })));
});

describe('the rewrite', () => {
  it('content config: loaders for typed, untyped and auto-generated collections; relative imports re-based', () => {
    const out = upgradeContentConfig([
      "import { defineCollection, z } from 'astro:content';",
      "import { site } from '../site';",
      "const blog = defineCollection({ type: 'content', schema: z.object({ title: z.string() }) });",
      "export const collections = { blog, authors: defineCollection({ type: 'data' }), notes: defineCollection({ schema: z.object({}) }) };",
    ].join('\n'), [{ name: 'blog', kind: 'content' }, { name: 'works', kind: 'content' }, { name: 'my-data', kind: 'data' }]);
    expect(out).toContain("import { glob } from 'astro/loaders';");
    expect(out).toContain('from "./site"');
    expect(out).toContain("blog = defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx,markdown}', base: './src/content/blog' }), schema");
    expect(out).toContain("authors: defineCollection({ loader: glob({ pattern: '**/*.{json,yaml,yml}', base: './src/content/authors' }) })");
    expect(out).toContain("notes: defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx,markdown}', base: './src/content/notes' }), schema");
    expect(out).toContain("works: defineCollection({ loader: glob({ pattern: '**/[^_]*.{md,mdx,markdown}', base: './src/content/works' }) })");
    expect(out).toContain(`"my-data": defineCollection({ loader: glob({ pattern: '**/*.{json,yaml,yml}', base: './src/content/my-data' }) })`);
    expect(upgradeContentConfig('export const collections = { ...others };', [])).toBeNull();
  });

  it('pages: entry.slug/render(), getEntryBySlug, ViewTransitions, Astro.glob; route params and frontmatter untouched', () => {
    const page = [
      '---',
      "import { getCollection, getEntryBySlug, } from 'astro:content';",
      "import { ViewTransitions } from 'astro:transitions';",
      "const posts = await getCollection('blog'); const one = await getEntryBySlug('blog', Astro.params.slug);",
      'const { Content } = await one.render(); const { slug } = Astro.params;',
      "const globbed = await Astro.glob<any>('../content/blog/*.md');",
      '---',
      '<ViewTransitions />{posts.map(p => <a href={`/blog/${p.slug}`} data-x={p.data.slug}>{params.slug}</a>)}<Content />',
    ].join('\n');
    const out = upgradeSource(page, 'src/pages/index.astro');
    expect(out).toContain("import { getCollection, getEntry, render } from 'astro:content';");
    expect(out).toContain("getEntry('blog', Astro.params.slug)");
    expect(out).toContain('await render(one)');
    expect(out).toContain("import { ClientRouter } from 'astro:transitions';");
    expect(out).toContain('<ClientRouter />');
    expect(out).toContain("Object.values(import.meta.glob('../content/blog/*.md', { eager: true }))");
    expect(out).toContain('`/blog/${p.id}`');
    expect(out).toContain('p.data.slug'); expect(out).toContain('{params.slug}');
    expect(upgradeSource('---\nconst { post } = Astro.props;\nconst { Content } = await post.render();\n---\n<Content />', 'src/layouts/Post.astro'))
      .toBe("---\nimport { render } from 'astro:content';\nconst { post } = Astro.props;\nconst { Content } = await render(post);\n---\n<Content />");
  });

  it('package.json: astro and @astrojs pins at the runtime versions, tailwind override, unified when the config has remark/rehype plugins', () => {
    const out = JSON.parse(upgradePackage(JSON.stringify({ dependencies: { astro: '^4.0.0', '@astrojs/mdx': '^3.1.9', '@astrojs/tailwind': '^5.0.0', '@astrojs/rss': '^4.0.0', tailwindcss: '^3.4.0' } }), V, { markdownPlugins: true }));
    expect(out.dependencies).toEqual({ astro: '^7.4.5', '@astrojs/mdx': '^8.1.2', '@astrojs/tailwind': '^6.0.2', '@astrojs/rss': '^4.0.0', tailwindcss: '^3.4.0', '@astrojs/markdown-remark': '^7.3.5' });
    expect(out.overrides).toEqual({ '@astrojs/tailwind': { astro: '$astro' } });
  });

  it('plan: a current site is left alone; our empty config becomes a generated one; an unknown config shape skips everything', () => {
    const pkg = v => JSON.stringify({ dependencies: { astro: v } });
    expect(planUpgrade({ 'package.json': pkg('^7.4.5') }, [], V).skip).toBe('astro ^7.4.5');
    const plan = planUpgrade({ 'package.json': pkg('^4.0.0'), 'src/content/config.ts': 'export const collections = {};\n' }, [{ name: 'posts', kind: 'content' }], V);
    expect(plan.removes).toEqual(['src/content/config.ts']);
    expect(plan.writes['src/content.config.ts']).toContain("posts: defineCollection({ loader: glob(");
    expect(planUpgrade({ 'package.json': pkg('^4.0.0'), 'src/content/config.ts': 'export const collections = make();' }, [], V).skip).toMatch(/content config shape/);
  });

  it('pages compare equal across build folders: hashed asset names never count', () => {
    const page = name => [{ path: '/index.html', bytes: Buffer.from(`<img src="/_astro/cover.BFl8LqLr_${name}.webp"><link href="/_astro/index.Cm${name}.css">`) }];
    expect(samePages(page('1aFxQm'), page('Ze2xtC'))).toBeNull();
    expect(samePages(page('1aFxQm'), [{ path: '/index.html', bytes: Buffer.from('<p>other</p>') }])).toBe('/index.html');
  });
});

const SITE = {
  'package.json': JSON.stringify({ type: 'module', dependencies: { astro: '^4.0.0', '@astrojs/mdx': '^3.1.9', '@astrojs/tailwind': '^5.0.0', tailwindcss: '^3.4.0' } }),
  'astro.config.mjs': "import tailwind from '@astrojs/tailwind';\nimport mdx from '@astrojs/mdx';\nexport default { integrations: [tailwind(), mdx()] };\n",
  'tailwind.config.mjs': "export default { content: ['./src/**/*.{astro,md,mdx}'] };\n",
  'src/content/config.ts': "import { defineCollection, z } from 'astro:content';\nconst blog = defineCollection({ type: 'content', schema: z.object({ title: z.string() }) });\nexport const collections = { blog };\n",
  'src/content/blog/hello-post.md': '---\ntitle: Hello\n---\n# Hello heading\n',
  'src/content/blog/world.mdx': '---\ntitle: World\n---\n# World heading\n',
  'src/content/notes/a-note.md': '---\ntitle: Note\n---\nA note body\n',
  'src/pages/index.astro': "---\nimport { getCollection } from 'astro:content';\nimport { ViewTransitions } from 'astro:transitions';\nconst posts = await getCollection('blog');\nconst notes = await getCollection('notes');\n---\n<html><head><ViewTransitions /></head><body><h1 class=\"text-red-500\">Home</h1>{posts.map(p => <a href={`/blog/${p.slug}`}>{p.data.title}</a>)}{notes.map(n => <i>{n.slug}</i>)}</body></html>\n",
  'src/pages/blog/[...slug].astro': "---\nimport { getCollection } from 'astro:content';\nexport async function getStaticPaths() { const posts = await getCollection('blog'); return posts.map(entry => ({ params: { slug: entry.slug }, props: { entry } })); }\nconst { entry } = Astro.props;\nconst { Content } = await entry.render();\n---\n<html><body><Content /></body></html>\n",
  'src/pages/globbed.astro': "---\nconst posts = await Astro.glob('../content/blog/*.md');\n---\n<html><body><p>globbed:{posts.length}:{posts[0].frontmatter.title}</p></body></html>\n",
};
async function site(extra = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sq-upgrade-site-')); roots.push(dir);
  for (const [file, text] of Object.entries({ ...SITE, ...extra })) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), text);
  }
  await fs.symlink(depsDir, path.join(dir, 'node_modules'), 'junction');
  return dir;
}
const resolved = async pkg => ({ pkg, lock: null }); // npm resolution stubbed: tests stay offline

describe('a real site', () => {
  it('upgrades in place once the rewrite builds the same pages without compat, then renders natively on the canvas', async () => {
    const dir = await site();
    const details = [];
    const result = await upgradeSite(dir, { depsDir, verify: resolved, onDetail: d => details.push(d) });
    expect(result.status).toBe('upgraded');
    expect(details).toEqual([`Upgrading the site to Astro ${RUNTIME_ASTRO}`]);
    await expect(fs.access(path.join(dir, 'src/content/config.ts'))).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, 'src/content.config.ts'), 'utf8')).toContain("notes: defineCollection({ loader: glob(");
    expect(JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).dependencies.astro).toBe(`^${RUNTIME_ASTRO}`);
    expect(await fs.readFile(path.join(result.backup, 'package.json'), 'utf8')).toBe(SITE['package.json']); // rollback copy
    expect(await fs.readFile(path.join(result.backup, 'src/content/config.ts'), 'utf8')).toBe(SITE['src/content/config.ts']);
    expect(await fs.readFile(path.join(dir, 'src/pages/blog/[...slug].astro'), 'utf8')).toContain('await render(entry)');
    expect((await upgradeSite(dir, { depsDir, verify: resolved })).status).toBe('skipped'); // current now: one read per open
    const inst = createInstance({ projectId: path.basename(dir), lease: crypto.randomUUID(), projectDir: dir, templateDir, depsDir });
    instances.push(inst); await inst.ready;
    const home = await (await inst.request('/')).text();
    expect(home).toContain('href="/blog/hello-post"'); expect(home).toMatch(/<i[^>]*>a-note<\/i>/); expect(home).toContain('data-sq-source=');
    expect(await (await inst.request('/blog/world')).text()).toContain('World heading');
  }, 240_000);

  it('a rewrite that would change a page is not kept: the site stays as it was and the reason is remembered', async () => {
    // `item.slug` on a plain object is not an entry: the rewrite would empty these links, so the gate refuses it.
    const dir = await site({ 'src/pages/nav.astro': "---\nconst items = [{ slug: 'about' }];\n---\n<html><body>{items.map(item => <a href={`/${item.slug}`}>x</a>)}</body></html>\n" });
    const result = await upgradeSite(dir, { depsDir, verify: resolved });
    expect(result).toMatchObject({ status: 'kept', reason: 'upgraded site renders /nav/index.html differently' });
    expect(await fs.readFile(path.join(dir, 'package.json'), 'utf8')).toBe(SITE['package.json']);
    expect(await fs.readFile(path.join(dir, 'src/content/config.ts'), 'utf8')).toBe(SITE['src/content/config.ts']);
    expect(await upgradeSite(dir, { depsDir, verify: async () => { throw new Error('never re-verified'); } }))
      .toEqual({ status: 'skipped', reason: result.reason });
  }, 240_000);

  it('npm refusing the new pins keeps the site; a network failure only defers it', async () => {
    const dir = await site();
    const refuse = async () => { throw Object.assign(new Error('npm error code ERESOLVE'), { transient: false }); };
    expect(await upgradeSite(dir, { depsDir, verify: refuse })).toMatchObject({ status: 'kept', reason: 'npm: npm error code ERESOLVE' });
    const other = await site();
    const offline = async () => { throw Object.assign(new Error('npm error code ENOTFOUND'), { transient: true }); };
    expect(await upgradeSite(other, { depsDir, verify: offline })).toMatchObject({ status: 'later' });
    await expect(fs.access(path.join(other, '.sq/astro-upgrade.json'))).rejects.toThrow();
  }, 120_000);
});
