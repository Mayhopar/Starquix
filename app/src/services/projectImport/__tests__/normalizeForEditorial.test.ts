import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { normalizeImportedEntries, mdToMdxSource, SQ_UTILITIES_CSS } from '../normalizeForEditorial';
import { postCompiles } from '@/postmodel/compileGate';
import type { ImportEntry } from '../processFolder';
import { INDEX_PAGE, OWNER_FILES, WORK_LIST } from '@/utils/__tests__/fixtures/lists';

const DIR = join(__dirname, 'fixtures', 'md-site');
const enc = new TextEncoder();
const dec = new TextDecoder();

/** fixture files; `.fixture` suffix keeps tsc off them */
function fixture(root = DIR): ImportEntry[] {
  const out: ImportEntry[] = [];
  const walk = (d: string) => readdirSync(d).forEach(n => {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else out.push({ path: relative(root, p).replace(/\.fixture$/, ''), content: readFileSync(p) });
  });
  walk(root);
  return out;
}
const asMap = (es: ImportEntry[]) => Object.fromEntries(es.map(e => [e.path, dec.decode(e.content)]));
const withFile = (es: ImportEntry[], path: string, value: string) => [...es.filter(e => e.path !== path), { path, content: enc.encode(value) }];

describe('normalizeImportedEntries', () => {
  it('md site → mdx dep + integration, fixable posts become .mdx, unfixable stays .md, pages untouched', async () => {
    const out = asMap(await normalizeImportedEntries(fixture()));
    const pkg = JSON.parse(out['package.json']);
    expect(pkg.dependencies['@astrojs/mdx']).toBe('^3.1.9');
    expect(out['astro.config.mjs']).toContain("import mdx from '@astrojs/mdx';");
    expect(out['astro.config.mjs']).toMatch(/integrations: \[[^\]]*mdx\(\)/);
    expect(out['src/content/blog/a.mdx']).toBeDefined();
    expect(out['src/content/blog/a.md']).toBeUndefined();
    expect((await postCompiles(out['src/content/blog/a.mdx'], 'mdx')).ok).toBe(true);
    expect(out['src/content/blog/b.md']).toBe(readFileSync(join(DIR, 'src/content/blog/b.md'), 'utf8'));
    expect(out['src/content/blog/b.mdx']).toBeUndefined();
    expect(out['src/pages/notes.md']).toBeDefined();
  });

  it('keeps Astro.glob routes connected to converted and unconverted content posts', async () => {
    const route = `---
// Astro.glob('../../content/blog/*.md') remains a comment.
const example = "Astro.glob('../../content/blog/*.md')";
const posts = await Astro.glob('../../content/blog/*.md');
const pages = await Astro.glob('../*.md');
---
<p>Astro.glob('../../content/blog/*.md')</p>
`;
    const input = withFile(fixture(), 'src/pages/posts/[slug].astro', route);
    const result = await normalizeImportedEntries(input);
    const out = asMap(result);
    expect(out['src/content/blog/a.mdx']).toBeDefined();
    expect(out['src/content/blog/b.md']).toBeDefined();
    expect(out['src/pages/posts/[slug].astro']).toBe(route.replace(
      "const posts = await Astro.glob('../../content/blog/*.md')",
      "const posts = await Astro.glob('../../content/blog/*.{md,mdx}')",
    ));
    expect(asMap(await normalizeImportedEntries(result))).toEqual(out);
  });

  it('normalizes the release import fixture without losing the dynamic post loader', async () => {
    const input = fixture(resolve('e2e/fixtures/release-project'));
    const before = asMap(input);
    const out = asMap(await normalizeImportedEntries(input));
    expect(out['src/content/posts/hello.md']).toBeUndefined();
    expect(out['src/content/posts/hello.mdx']).toBe(before['src/content/posts/hello.md']);
    expect(out['src/pages/posts/[slug].astro']).toBe(
      before['src/pages/posts/[slug].astro'].replace('posts/*.md', 'posts/*.{md,mdx}'),
    );
    expect(out['src/pages/products/[slug].astro']).toBe(before['src/pages/products/[slug].astro']);
  });

  it('an Astro 7 site gets the MDX and Tailwind integrations for 7, with the override hosts need for @astrojs/tailwind', async () => {
    const seven = withFile(fixture(), 'package.json', JSON.stringify({ dependencies: { astro: '^7.4.5' } }));
    const pkg = JSON.parse(asMap(await normalizeImportedEntries(seven))['package.json']);
    expect(pkg.dependencies).toMatchObject({ '@astrojs/mdx': '^8.1.2', '@astrojs/tailwind': '^6.0.2', tailwindcss: '^3.4.0' });
    expect(pkg.overrides).toEqual({ '@astrojs/tailwind': { astro: '$astro' } });
  });

  it('no Tailwind → utilities only (no preflight, no base styles) + sq-utilities.css', async () => {
    const out = asMap(await normalizeImportedEntries(fixture()));
    const pkg = JSON.parse(out['package.json']);
    expect(pkg.dependencies['@astrojs/tailwind']).toBe('^5.0.0');
    expect(pkg.dependencies.tailwindcss).toBe('^3.4.0');
    expect(out['astro.config.mjs']).toContain('tailwind({ applyBaseStyles: false })');
    expect(out['tailwind.config.mjs']).toContain('preflight: false');
    expect(out['tailwind.config.mjs']).toContain('mdx');
    expect(out[SQ_UTILITIES_CSS]).toBe('@tailwind base;\n@tailwind utilities;\n');
  });

  it('idempotent', async () => {
    const once = await normalizeImportedEntries(fixture());
    const twice = await normalizeImportedEntries(once);
    expect(asMap(twice)).toEqual(asMap(once));
  });

  it('unknown Astro major → nothing changes', async () => {
    const es = withFile(fixture(), 'package.json', JSON.stringify({ dependencies: { astro: 'latest' } }));
    expect(asMap(await normalizeImportedEntries(es))).toEqual(asMap(es));
  });

  it('Astro 5 glob loaders match mdx', async () => {
    const es = withFile(withFile(fixture(), 'package.json', JSON.stringify({ dependencies: { astro: '^5.1.0' } })),
      'src/content.config.ts', "const blog = defineCollection({ loader: glob({ pattern: '**/*.md', base: './src/content/blog' }) });\n");
    const out = asMap(await normalizeImportedEntries(es));
    expect(out['src/content.config.ts']).toContain("pattern: '**/*.{md,mdx}'");
    expect(JSON.parse(out['package.json']).dependencies['@astrojs/mdx']).toBe('^4.0.0');
  });

  it('Tailwind v3 site: content globs gain mdx; v4: untouched', async () => {
    const v3 = withFile(withFile(fixture(), 'package.json', JSON.stringify({ dependencies: { astro: '^4.0.0', tailwindcss: '^3.4.0', '@astrojs/tailwind': '^5.0.0' } })),
      'tailwind.config.mjs', "export default { content: ['./src/**/*.{astro,md}'] };\n");
    const out3 = asMap(await normalizeImportedEntries(v3));
    expect(out3['tailwind.config.mjs']).toContain("'./src/**/*.mdx'");
    expect(out3[SQ_UTILITIES_CSS]).toBeUndefined();
    const v4 = withFile(fixture(), 'package.json', JSON.stringify({ dependencies: { astro: '^5.0.0', tailwindcss: '^4.0.0' } }));
    const out4 = asMap(await normalizeImportedEntries(v4));
    expect(out4['tailwind.config.mjs']).toBeUndefined();
  });
});

describe('mdToMdxSource', () => {
  it('fixes comments, void tags, braces and stray <; code untouched', () => {
    const out = mdToMdxSource('<!-- c -->\n\nA<br>B {x} 1 < 2\n\n`{y}`\n');
    expect(out).toBe('{/* c */}\n\nA<br />B \\{x\\} 1 &lt; 2\n\n`{y}`\n');
  });
});

describe('lists → BlogSlots on import (task-244)', () => {
  const owner = (): ImportEntry[] => Object.entries(OWNER_FILES).reduce((es, [path, value]) => withFile(es, path, value), fixture());

  it('the imported owner site lands with its two lists as BlogSlots', async () => {
    const out = asMap(await normalizeImportedEntries(owner(), { blogSlotLibrary: 'LIB' }));
    expect(out['src/pages/index.astro']).toContain('{posts2.map((post) => <div class="contents" data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}');
    expect(out['src/components/BlogSlot.astro']).toContain('Astro.props.postsClass');
    expect(out['src/components/WorkList.astro']).toBeUndefined(); // converted and imported by nothing → deleted
  });

  it('no library source → lists untouched', async () => {
    expect(asMap(await normalizeImportedEntries(owner()))['src/pages/index.astro']).toBe(INDEX_PAGE);
  });
});

