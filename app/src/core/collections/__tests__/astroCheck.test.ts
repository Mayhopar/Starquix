// An imported site whose build runs `astro check && astro build` fails its
// deploy on ANY type error in code we ship into it (owner 2026-10-20: Netlify
// rejected personal-site on the card's `post.collection` and the numbered
// pagination's untyped `(n)`). Same pipeline as `astro check`: the compiler's
// TSX + TypeScript strict. Astro's own modules are stubbed permissive, so only
// the component's own code is judged; scripts are left out (an is:inline
// script is never type-checked).
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { convertToTSX } from '@astrojs/compiler';
import ts from 'typescript';
import { DEFAULT_CARD } from '../../../utils/cardFields';
import { assignCard, setCardCollection } from '../../../utils/cardSetup';

const LIB = resolve(__dirname, '../../../../../preview-template/src/components/library');

const STUBS = `
declare module 'astro' { export type AstroGlobal<P, _C = unknown, _Params = unknown> = { props: P } & Record<string, any>; }
declare module 'astro:content' { export type CollectionEntry<C extends string> = { id: string; slug: string; body: string; collection: C; data: Record<string, any> }; }
declare module 'astro/jsx-runtime' { export namespace JSX { type Element = any; interface IntrinsicElements { [k: string]: any } } }
declare module '*.astro';
declare const Fragment: any;
declare const Astro: { props: Record<string, any> } & Record<string, any>;
`;
const OPTIONS: ts.CompilerOptions = {
  strict: true, noEmit: true, skipLibCheck: true, types: [],
  jsx: ts.JsxEmit.Preserve, jsxImportSource: 'astro',
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
};

/** `astro check` errors per component (one program for all of them). */
async function astroCheck(sources: Record<string, string>): Promise<Record<string, string[]>> {
  const files = new Map([['/p/stubs.d.ts', STUBS]]);
  for (const [name, src] of Object.entries(sources)) {
    files.set(`/p/${name}.tsx`, (await convertToTSX(src, { filename: `/p/${name}.astro`, includeScripts: false, includeStyles: false })).code);
  }
  const host = ts.createCompilerHost(OPTIONS);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (f, v) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, v) : read(f, v));
  host.fileExists = (f) => files.has(f) || ts.sys.fileExists(f);
  host.readFile = (f) => files.get(f) ?? ts.sys.readFile(f);
  const out: Record<string, string[]> = Object.fromEntries(Object.keys(sources).map((n) => [n, []]));
  for (const d of ts.getPreEmitDiagnostics(ts.createProgram([...files.keys()], OPTIONS, host))) {
    const name = d.file?.fileName.match(/^\/p\/(.+)\.tsx$/)?.[1];
    if (name) out[name].push(`TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
  }
  return out;
}

const FIELDS = [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }];
// A card with its own standalone fallback that has no `collection` (personal-site's BlogCard).
const OWN_FALLBACK = `---
const { post: postProp } = Astro.props;
const post = postProp ?? { data: { title: 'Sample post', date: '2026-01-01' } };
---
<article><h3>{post.data.title}</h3><time>{post.data.date}</time></article>
`;

describe('astro check (strict) passes on code Starquix ships into a project', () => {
  it('every library component', async () => {
    const names = (readdirSync(LIB, { recursive: true }) as string[]).filter((f) => f.endsWith('.astro'));
    const errors = await astroCheck(Object.fromEntries(names.map((f) => [f.replace(/\.astro$/, ''), readFileSync(resolve(LIB, f), 'utf8')])));
    expect(Object.entries(errors).filter(([, e]) => e.length)).toEqual([]);
  }, 60_000);

  it('the blog card in every state the fields setup writes', async () => {
    const promoted = assignCard(DEFAULT_CARD, 'blog', FIELDS, null);
    expect(await astroCheck({
      plain: DEFAULT_CARD,
      typed: setCardCollection(DEFAULT_CARD, 'blog'),
      promoted,
      twoCollections: assignCard(promoted, 'works', FIELDS, null),
      ownFallback: assignCard(OWN_FALLBACK, 'blog', FIELDS, null),
    })).toEqual({ plain: [], typed: [], promoted: [], twoCollections: [], ownFallback: [] });
  }, 60_000);
});
