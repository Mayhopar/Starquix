/**
 * A collection card's fields, read from and written to the card FILE — the
 * only truth for what a card shows (design 2026-10-08, D2). A field is "in the
 * card" when one element renders it directly:
 *   <tag …>{post.data.f}</tag>
 *   {post.data.f && <tag …>…</tag>}          (guarded: no empty box, no error)
 *   {show.f && …any of the above…}           (the field's EYE — owner 2026-10-09)
 *   <img … src={post.data.f?.src ?? post.data.f} … />   (or Astro's <Image …>…</Image>)
 * Any other `post.data.f` use is custom code: never rewritten (D8).
 * `post` is whatever the card calls its entry — an imported card reads
 * `work.data.f` (entryVarOf); every rule below takes that name.
 */
import { FRONTMATTER_RE } from '@/utils/blogBinding';

export type CardFieldState = 'on-card' | 'hidden' | 'custom';
export const isFieldIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);

const ID = String.raw`[A-Za-z_$][\w$]*`;
const templateStart = (src: string) => src.match(FRONTMATTER_RE)?.[0].length ?? 0;
const TAG = String.raw`[a-zA-Z][\w-]*`;
const ATTRS = String.raw`(?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*`;
/** The Starquix-managed per-collection fields block (utils/cardSetup — kept here so cardSetup can import us without a cycle). */
export const SETUP_MARK = '// sq:fields';
export const hasSetupBlock = (src: string): boolean => src.includes(SETUP_MARK);

/** How a field element reads its value: plain `<v>.data.<field>`, block form `f('<slot>')`. */
export interface FieldReader { open: string; close: string }
export const readerOf = (src: string, v = entryVarOf(src)): FieldReader =>
  hasSetupBlock(src) ? { open: String.raw`f\('`, close: String.raw`'\)` } : { open: String.raw`${v}\.data\.`, close: '' };
const res = new Map<string, { guarded: RegExp; plain: RegExp; img: RegExp; any: RegExp }>();
function regexesFor({ open: o, close: c }: FieldReader) {
  let r = res.get(o);
  if (!r) {
    r = {
      guarded: new RegExp(String.raw`\{\s*(?:show\.${ID}\s*&&\s*)?${o}(${ID})${c}\s*&&\s*(<(${TAG})\b${ATTRS}?(?:\/>|>[\s\S]*?<\/\3\s*>))\s*\}`, 'g'),
      // A date shown in a format (utils/fieldBinding DATE_FORMATS) is the same field element.
      plain: new RegExp(String.raw`<(${TAG})\b(${ATTRS})>\s*\{\s*${o}(${ID})${c}(?:\s*&&\s*new Date\(\s*${o}\3${c}\s*\)\.toLocaleDateString\([^()]*\))?\s*\}\s*<\/\1\s*>`, 'g'),
      img: new RegExp(String.raw`<(img|Image|Picture)\b${ATTRS}?\bsrc=\{\s*${o}(${ID})${c}(?:\??\.src\s*\?\?\s*${o}\2${c})?\s*\}${ATTRS}(?:\/>|>\s*<\/\1\s*>)`, 'g'),
      any: new RegExp(String.raw`${o}(${ID})${c}`, 'g'),
    };
    res.set(o, r);
  }
  return r;
}

/** The name the card gives its collection entry (`post`, `work`, …): the most used `X.data.` reader. */
export function entryVarOf(src: string): string {
  const counts = new Map<string, number>();
  for (const m of src.matchAll(new RegExp(String.raw`(?<![\w$.])(${ID})\.(?:data\.${ID}|data as\b|collection\])`, 'g'))) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'post';
}

/** The collection a card is typed for (`CollectionEntry<"works">`), else null (a shared card such as BlogCard). */
export function cardCollectionOf(src: string): string | null {
  return src.match(/CollectionEntry<\s*["']([^"']+)["']\s*>/)?.[1] ?? null;
}

/** The card renders its own post link (`href={`…${x.slug}`}`, `${x.id}` on content-layer sites) — a page must never wrap it in `<a>` (nested anchors, task-244 L11). */
export const cardLinksItself = (src: string): boolean => /href=\{`[^`]*\$\{\s*[A-Za-z_$][\w$]*\.(?:slug|id)\s*\}/.test(src);

/**
 * Is this component a CARD — it renders ONE entry it is handed as a prop
 * (`const { work } = Astro.props`, ours `const { post: postProp } = …`)?
 * Owner 2026-10-09: each collection has its card; a list that fetches the
 * collection itself (getCollection + map — e.g. an imported WorkList) is not
 * one: no eyes, no title lock there.
 */
export function isCardSource(src: string): boolean {
  const fm = src.match(FRONTMATTER_RE)?.[1] ?? '';
  if (/\bgetCollection\s*\(/.test(fm)) return false;
  const v = entryVarOf(src);
  const reads = hasSetupBlock(src) ? /\bf\('/ : new RegExp(String.raw`(?<![\w$.])${v}\.data\.${ID}`);
  if (!reads.test(src.slice(templateStart(src)))) return false;
  return new RegExp(String.raw`\{[^}]*\b${v}\b[^}]*\}\s*=\s*Astro\.props`).test(fm);
}

export interface FieldElement { field: string; start: number; end: number }

/** `reader` defaults to the source's own form — pass the card FILE's when `src` is one element of it. */
export function fieldElements(src: string, v = entryVarOf(src), reader = readerOf(src, v)): FieldElement[] {
  const { guarded: GUARDED, plain: PLAIN, img: IMG } = regexesFor(reader);
  const tpl = templateStart(src);
  const out: FieldElement[] = [];
  const add = (field: string, start: number, end: number) => {
    if (start < tpl || out.some((e) => start < e.end && end > e.start)) return;
    out.push({ field, start, end });
  };
  for (const m of src.matchAll(GUARDED)) add(m[1], m.index!, m.index! + m[0].length);
  for (const m of src.matchAll(PLAIN)) add(m[3], m.index!, m.index! + m[0].length);
  for (const m of src.matchAll(IMG)) add(m[2], m.index!, m.index! + m[0].length);
  return out.sort((a, b) => a.start - b.start);
}

export function scanCardFields(src: string): Map<string, CardFieldState> {
  const v = entryVarOf(src);
  const els = fieldElements(src, v);
  const show = readShow(src);
  const out = new Map<string, CardFieldState>();
  for (const el of els) out.set(el.field, show.get(el.field) === false && eyeOf(src, el).wrapped ? 'hidden' : 'on-card');
  // Blank out the field elements; any post.data.x left in the template is custom code.
  const offset = templateStart(src);
  let rest = src.slice(offset);
  for (const el of [...els].reverse()) rest = rest.slice(0, el.start - offset) + ' '.repeat(el.end - el.start) + rest.slice(el.end - offset);
  for (const m of rest.matchAll(regexesFor(readerOf(src, v)).any)) if (!out.has(m[1])) out.set(m[1], 'custom');
  return out;
}


/** A collection's own card component: `works` → `WorksCard`, `my-posts` → `MyPostsCard` (D1). */
export function cardNameFor(collection: string): string {
  const pascal = collection.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  return `${/^[A-Za-z]/.test(pascal) ? '' : 'C'}${pascal}Card`;
}
export const cardFileFor = (collection: string, name = cardNameFor(collection)) => `src/components/${name}.astro`;

export const postCardFileFor = (collection: string) => cardFileFor(collection, `${cardNameFor(collection).replace(/Card$/, '')}PostCard`);

/** A card copied for a collection: its `@name` doc tag follows the new file (else the library lists two "BlogCard"s). */
export function cardCopy(source: string, cardFile: string): string {
  const name = cardFile.match(/([^/]+)\.astro$/)![1];
  return source.replace(/(@name[ \t]+)[A-Za-z_$][\w$]*/, `$1${name}`);
}

/** `<Name>Card.astro`, or `<Name>PostCard.astro` when the former is someone else's component (no `post.data`). */
export function ownCardFile(collection: string, cards: Record<string, string | null>): string {
  const own = cardFileFor(collection);
  const existing = cards[own];
  return existing != null && !existing.includes('post.data') ? postCardFileFor(collection) : own;
}

/** Byte-identical to preview-template/src/components/library/BlogCard.astro (parity-tested). */
/** The basic card every blog starts with — never deleted (Assets). */
export const CARD_FILE = 'src/components/BlogCard.astro';

export const DEFAULT_CARD = `---
/**
 * @category Blog
 * @name BlogCard
 */
// Standalone safety: BlogSlot's slot fallback renders <BlogCard /> with no
// post prop (crashes any real project the file is copied into otherwise).
// A bound page (task-240) passes \`post\`; the post LINK is the page's own
// \`<a>\` around the card, so this file never links (no nested anchors).
// The image box is bound to the collection's \`image\` field out of the box
// (the scaffold schema declares it); \`?.\` keeps a post without the field —
// and this fallback — from crashing the render. The fallback is \`any\`: once
// the card is typed to a collection, a typed sample would make every field
// it lacks an \`astro check\` error.
const { post: postProp } = Astro.props;
const post = postProp ?? ({
  data: { title: 'Sample post', description: 'A short description of this post.', date: '2026-01-01' },
} as any);
---
<article class="rounded-lg border border-gray-200 overflow-hidden flex flex-col bg-white">
  <div class="aspect-video bg-gray-100 flex items-center justify-center">
    <img src={post.data.image?.src ?? post.data.image} alt="" class="w-full h-full object-cover" />
  </div>
  <div class="p-4 bg-white h-full">
    <h3 class="font-semibold text-lg text-black">{post.data.title}</h3>
    <p class="text-gray-600 text-sm mt-1">{post.data.description}</p>
    <time class="text-gray-400 text-xs mt-2 block">{post.data.date}</time>
  </div>
</article>
`;

// ── Field eyes (owner 2026-10-09, per collection card) ──────────────────
// The card keeps every field element (the master); an eye is a render guard
// `{show.f && …}` + the value in ONE frontmatter line
// `const show = { author: false };`. Astro renders on the server: a false
// guard leaves the element out of the HTML (SEO-clean) while its markup and
// classes stay in the file, so the eye turns it back on intact.

const SHOW_RE = /^const show = \{([^}]*)\};[ \t]*$/m;
const escapeRe = (s: string) => s.replace(/[$]/g, '\\$&');

/** The card's `show` values (absent = visible). */
export function readShow(src: string): Map<string, boolean> {
  const body = src.match(FRONTMATTER_RE)?.[1] ?? '';
  const out = new Map<string, boolean>();
  for (const m of (body.match(SHOW_RE)?.[1] ?? '').matchAll(new RegExp(String.raw`(${ID})\s*:\s*(true|false)`, 'g'))) out.set(m[1], m[2] === 'true');
  return out;
}

/** What one eye guards: the element — or the box an image is the only child of — and whether it is guarded already. */
export function eyeOf(src: string, el: FieldElement): { start: number; end: number; insertAt: number; wrapped: boolean } {
  let start = el.start, end = el.end;
  if (/^<(img|Image|Picture)\b/.test(src.slice(start, start + 8))) {
    const open = src.slice(0, start).match(/<div\b[^>]*>\s*$/);
    const close = src.slice(end).match(/^\s*<\/div\s*>/);
    if (open && close) { start -= open[0].length; end += close[0].length; }
  }
  const guard = new RegExp(String.raw`show\.${escapeRe(el.field)}\s*&&`);
  // A guarded element `{post.data.f && …}` takes the eye INSIDE its braces (`{a && {b}}` is not JSX).
  if (src[start] === '{') return { start, end, insertAt: start + 1, wrapped: guard.test(src.slice(start, start + 1 + 64).split('post.data')[0]) };
  const before = src.slice(Math.max(0, start - 64), start);
  return { start, end, insertAt: start, wrapped: new RegExp(String.raw`\{\s*show\.${escapeRe(el.field)}\s*&&\s*$`).test(before) };
}

function writeShow(src: string, field: string, visible: boolean): string {
  const show = readShow(src).set(field, visible);
  const line = `const show = { ${[...show].map(([k, v]) => `${k}: ${v}`).join(', ')} };`;
  const fm = src.match(FRONTMATTER_RE);
  if (!fm) return `---\n${line}\n---\n${src}`;
  const block = SHOW_RE.test(fm[0]) ? fm[0].replace(SHOW_RE, line) : fm[0].replace(/^---[ \t]*\r?\n?$(?![\s\S]*^---)/m, `${line}\n$&`);
  return block + src.slice(fm[0].length);
}

/** Turn a field's eye on/off in the card. A field with no element of its own (absent / custom code) → unchanged. */
export function setCardFieldVisible(src: string, field: string, visible: boolean, type = 'text'): string {
  const els = fieldElements(src).filter((e) => e.field === field);
  // Owner 2026-10-11: the app never makes up elements — a field shows only
  // through an element the user created and bound.
  if (!els.length) return src;
  let out = src;
  for (const el of els.reverse()) {
    const eye = eyeOf(out, el);
    if (eye.wrapped) continue;
    out = eye.insertAt > eye.start
      ? `${out.slice(0, eye.insertAt)}show.${field} && ${out.slice(eye.insertAt)}`
      : `${out.slice(0, eye.start)}{show.${field} && ${out.slice(eye.start, eye.end)}}${out.slice(eye.end)}`;
  }
  return writeShow(out, field, visible);
}

