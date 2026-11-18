/**
 * Import normalization for editorial layouts (design D5, plan Phase 4): an
 * imported Astro folder becomes MDX + Tailwind-utility capable so `<Stack>`
 * works in its posts. Pure over the entry list (async only for the MDX compile
 * gate); running it twice changes nothing.
 *
 *  1. `@astrojs/mdx` dependency for the site's Astro major (unknown major →
 *     every MDX step is skipped; posts stay `.md`).
 *  2. `mdx()` in astro.config (an unrecognized config shape → MDX skipped).
 *  3. Astro.glob content routes and Astro-5 glob loaders match `*.{md,mdx}`.
 *  4. Posts under src/content/** : known MD→MDX incompatibilities auto-fixed
 *     (comments, void tags, stray `{` `}` `<`), then compile-gated; a post that
 *     still fails stays `.md`, byte-identical.
 *  5. Tailwind utilities (P8): none → `@astrojs/tailwind` with base styles and
 *     preflight OFF + `src/components/sq/sq-utilities.css` — the site's look
 *     does not change. v3 → content globs cover mdx + src/components. v4 →
 *     nothing (automatic source detection).
 *  6. Simple imported list components become BlogSlots (task-244,
 *     utils/listToBlogSlot) — only when the library BlogSlot source is given.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import type { Root, RootContent } from 'mdast';
import { postCompiles } from '@/postmodel/compileGate';
import type { ImportEntry } from './processFolder';
import { UTILITIES_FILE } from '@/core/post/postLayoutSource';
import { convertListsToBlogSlots } from '@/utils/listToBlogSlot';

const dec = new TextDecoder();
const enc = new TextEncoder();
const text = (e: ImportEntry) => dec.decode(e.content);

const MDX_RANGE: Record<number, string> = { 3: '^1.1.0', 4: '^3.1.9', 5: '^4.0.0', 6: '^5.0.6', 7: '^8.1.2' };
const TAILWIND_RANGE: Record<number, string> = { 3: '^5.0.0', 4: '^5.0.0', 5: '^6.0.0', 6: '^6.0.2', 7: '^6.0.2' };
const CONFIGS = ['astro.config.mjs', 'astro.config.js', 'astro.config.ts', 'astro.config.mts'];
const TW_CONFIGS = ['tailwind.config.mjs', 'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.ts'];
/** Kept as an export for callers/tests; THE path is postLayoutSource's UTILITIES_FILE. */
export const SQ_UTILITIES_CSS = UTILITIES_FILE;

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; overrides?: Record<string, unknown> };
const dep = (pkg: Pkg, name: string) => pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
const major = (range: string | undefined) => {
  const m = range ? /(\d+)/.exec(range) : null;
  return m ? Number(m[1]) : null;
};

/** Add `import x from 'y';` after the config's last import line. */
function addImport(src: string, line: string): string {
  const lines = src.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (/^import\s/.test(l)) last = i; });
  lines.splice(last + 1, 0, line);
  return lines.join('\n');
}

/** Put `call` into `integrations: [` — or add the key. null = unrecognized shape. */
function addIntegration(src: string, call: string): string | null {
  const m = /integrations\s*:\s*\[\s*/.exec(src);
  if (m) {
    const after = src.slice(m.index + m[0].length);
    return `${src.slice(0, m.index)}integrations: [${call}${after.startsWith(']') ? '' : ', '}${after}`;
  }
  if (/defineConfig\(\s*\{/.test(src)) return src.replace(/defineConfig\(\s*\{/, m => `${m}\n  integrations: [${call}],`);
  return null;
}

const VOID = /<(br|hr|img|input|meta|link|source|wbr)\b([^>]*?)\s*\/?>/gi;

/** Known MD→MDX fixes over the md parse's own offsets (never a whole-file regex). */
export function mdToMdxSource(src: string): string {
  const root = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ['yaml', 'toml']).parse(src) as Root;
  const edits: Array<{ start: number; end: number; value: string }> = [];
  const visit = (node: RootContent | Root) => {
    const pos = (node as RootContent).position;
    if (node.type === 'html' && pos) {
      const raw = src.slice(pos.start.offset!, pos.end.offset!);
      const fixed = raw.replace(/<!--([\s\S]*?)-->/g, (_, c: string) => `{/*${c.replace(/\*\//g, '* /')}*/}`)
        .replace(VOID, (_, tag: string, attrs: string) => `<${tag}${attrs} />`);
      if (fixed !== raw) edits.push({ start: pos.start.offset!, end: pos.end.offset!, value: fixed });
      return;
    }
    if (node.type === 'text' && pos) {
      const raw = src.slice(pos.start.offset!, pos.end.offset!);
      const fixed = raw.replace(/(?<!\\)([{}])/g, '\\$1').replace(/<(?![A-Za-z/!])/g, '&lt;');
      if (fixed !== raw) edits.push({ start: pos.start.offset!, end: pos.end.offset!, value: fixed });
      return;
    }
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'yaml' || node.type === 'toml' as string) return;
    for (const child of (node as { children?: RootContent[] }).children ?? []) visit(child);
  };
  visit(root);
  let out = src;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.value + out.slice(e.end);
  return out;
}

/** Static content globs in Astro frontmatter must survive the MD→MDX rename.
 * Skip comments/quoted examples and leave non-content globs and markup alone.
 */
function normalizeAstroContentGlobs(path: string, source: string): string {
  return source.replace(/^(---[^\S\r\n]*\r?\n)([\s\S]*?)(^---[^\S\r\n]*(?:\r?\n|$))/m, (_, open: string, script: string, close: string) => {
    const next = script.replace(
      /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/(?:\\.|[^/\\\r\n])+\/[gimsuy]*|\bAstro\s*\.\s*glob\s*\(\s*(['"])([^'"\\\r\n]+)\1\s*\)/g,
      (call: string, quote: string | undefined, glob: string | undefined) => {
        if (!quote || !glob || !glob.endsWith('*.md')) return call;
        const parts = glob.startsWith('/') ? [] : path.split('/').slice(0, -1);
        for (const segment of glob.split('/')) {
          if (segment === '..') parts.pop();
          else if (segment && segment !== '.') parts.push(segment);
        }
        if (!parts.join('/').startsWith('src/content/')) return call;
        return call.replace(`${quote}${glob}${quote}`, `${quote}${glob.slice(0, -3)}.{md,mdx}${quote}`);
      },
    );
    return open + next + close;
  });
}

export async function normalizeImportedEntries(entries: ImportEntry[], opts: { blogSlotLibrary?: string } = {}): Promise<ImportEntry[]> {
  const files = new Map(entries.map(e => [e.path, e]));
  const put = (path: string, value: string) => files.set(path, { path, content: enc.encode(value) });
  const pkgEntry = files.get('package.json');
  if (!pkgEntry) return entries;
  let pkg: Pkg & Record<string, unknown>;
  try { pkg = JSON.parse(text(pkgEntry)); } catch { return entries; }
  const astroMajor = major(dep(pkg, 'astro'));
  const configPath = CONFIGS.find(p => files.has(p));
  let config = configPath ? text(files.get(configPath)!) : null;
  let pkgChanged = false;

  // 1–2: MDX integration
  let mdx = Boolean(dep(pkg, '@astrojs/mdx')) && Boolean(config?.includes('@astrojs/mdx'));
  if (!mdx && astroMajor !== null && MDX_RANGE[astroMajor] && config !== null) {
    const next = config.includes('@astrojs/mdx') ? config : addIntegration(config, 'mdx()');
    if (next !== null) {
      config = next.includes("from '@astrojs/mdx'") ? next : addImport(next, "import mdx from '@astrojs/mdx';");
      if (!dep(pkg, '@astrojs/mdx')) { pkg.dependencies = { ...pkg.dependencies, '@astrojs/mdx': MDX_RANGE[astroMajor] }; pkgChanged = true; }
      mdx = true;
    }
  }

  if (mdx) {
    // 3: Astro-5 glob loaders
    for (const p of ['src/content/config.ts', 'src/content/config.js', 'src/content/config.mjs', 'src/content.config.ts', 'src/content.config.js', 'src/content.config.mjs']) {
      const e = files.get(p);
      if (!e) continue;
      const src = text(e);
      const next = src.replace(/(pattern\s*:\s*['"`][^'"`]*\*\.)md(['"`])/g, '$1{md,mdx}$2');
      if (next !== src) put(p, next);
    }
    for (const e of files.values()) {
      if (!e.path.startsWith('src/') || !e.path.endsWith('.astro')) continue;
      const src = text(e);
      const next = normalizeAstroContentGlobs(e.path, src);
      if (next !== src) put(e.path, next);
    }
    // 4: posts
    for (const e of [...files.values()]) {
      if (!e.path.startsWith('src/content/') || !e.path.endsWith('.md')) continue;
      const target = `${e.path}x`;
      if (files.has(target)) continue;
      const fixed = mdToMdxSource(text(e));
      if ((await postCompiles(fixed, 'mdx')).ok) {
        files.delete(e.path);
        put(target, fixed);
      }
    }
  }

  // 5: Tailwind utilities
  const twMajor = major(dep(pkg, 'tailwindcss'));
  if (twMajor === null && !dep(pkg, '@tailwindcss/vite') && astroMajor !== null && TAILWIND_RANGE[astroMajor] && config !== null) {
    const next = config.includes('@astrojs/tailwind') ? config : addIntegration(config, 'tailwind({ applyBaseStyles: false })');
    if (next !== null) {
      config = next.includes("from '@astrojs/tailwind'") ? next : addImport(next, "import tailwind from '@astrojs/tailwind';");
      pkg.dependencies = { ...pkg.dependencies, '@astrojs/tailwind': TAILWIND_RANGE[astroMajor], tailwindcss: '^3.4.0' };
      // Its peer range stops at Astro 5: a host's npm install refuses it on 6+ without this.
      if (astroMajor >= 6) pkg.overrides = { ...pkg.overrides, '@astrojs/tailwind': { astro: '$astro' } };
      pkgChanged = true;
      if (!TW_CONFIGS.some(p => files.has(p))) {
        put('tailwind.config.mjs', [
          '/** @type {import("tailwindcss").Config} */',
          'export default {',
          "  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,ts,tsx}'],",
          '  // utilities only: the site keeps its own base styles (no reset)',
          '  corePlugins: { preflight: false },',
          '};',
          '',
        ].join('\n'));
      }
      // base: with preflight off it emits ONLY the --tw-* defaults (translate
      // is inert without them) — never a reset.
      put(SQ_UTILITIES_CSS, '@tailwind base;\n@tailwind utilities;\n');
    }
  } else if (twMajor === 3) {
    const twPath = TW_CONFIGS.find(p => files.has(p));
    if (twPath) {
      const src = text(files.get(twPath)!);
      const extra: string[] = [];
      if (!/mdx/.test(src)) extra.push("'./src/**/*.mdx'");
      if (!/src\/\*\*|src\/components/.test(src)) extra.push("'./src/components/**/*.astro'");
      if (extra.length) {
        const next = src.replace(/content\s*:\s*\[/, m => `${m}${extra.join(', ')}, `);
        if (next !== src) put(twPath, next);
      }
    }
  }

  if (configPath && config !== null && config !== text(files.get(configPath)!)) put(configPath, config);
  if (pkgChanged) put('package.json', JSON.stringify(pkg, null, 2) + '\n');

  // 6: lists → BlogSlots (the converted project lands ready; unusual lists stay as they are)
  if (opts.blogSlotLibrary) {
    const astro = Object.fromEntries([...files.values()].filter(e => e.path.startsWith('src/') && e.path.endsWith('.astro')).map(e => [e.path, text(e)]));
    const { writes, skipped } = convertListsToBlogSlots(astro, { blogSlotLibrary: opts.blogSlotLibrary });
    for (const [path, value] of Object.entries(writes)) { if (value === null) files.delete(path); else put(path, value); }
    if (skipped.length) console.debug('[import] lists left as they are', skipped);
  }
  return [...files.values()];
}
