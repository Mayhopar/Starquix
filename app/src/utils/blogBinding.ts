/**
 * Files-truth blog binding (task-240, design docs/plans/2026-09-12-files-truth-blog-binding-design.md).
 * The binding IS the page's Astro code. This module is the only place that
 * knows the canonical shape: `parseBlogBinding` reads a page back into a
 * BlogBinding, `emitBlogBinding` writes a BlogBinding into a page. Anything
 * the parser cannot classify is `custom: true` and the UI never rewrites it.
 */
import { siteUsesContentLayer } from '@/utils/siteAstro';
import { escapeRegex } from './regex';
import { importSpecifierFor } from './localStructural';
import { applySplices, attrOf, removeAttr, scanTags, splitFrontmatter, type Span, type Splice, type Tag } from '@/store/seo/astroScan';

export type BlogSort = 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc';
export type Schema = ReadonlyArray<{ name: string; type: string }>;

/** Sort options the schema can honour (date-* need `date`, title-* need `title`). */
export function sortOptionsFor(schema: Schema): BlogSort[] {
  const has = (n: string) => schema.some((f) => f.name === n);
  return [...(has('date') ? (['date-desc', 'date-asc'] as const) : []), ...(has('title') ? (['title-asc', 'title-desc'] as const) : [])];
}

/** Keep `wanted` when the schema supports it, else the schema's default (first option) or none. */
export function sortFor(schema: Schema, wanted: BlogSort | null): BlogSort | null {
  const opts = sortOptionsFor(schema);
  return wanted && opts.includes(wanted) ? wanted : opts[0] ?? null;
}
export type BlogPagination =
  | { kind: 'none' }
  | { kind: 'numbered'; pageSize: number }
  | { kind: 'load-more'; pageSize: number };

export interface BlogBinding {
  /** A `<BlogSlot` tag exists in the template. */
  hasSlot: boolean;
  collection: string | null;
  /** `(p) => p.data.<field>` predicate on getCollection (`(p) => !p.data.<field>` when `not`). */
  filter: { field: string; not?: boolean } | null;
  sort: BlogSort | null;
  limit: number | null;
  pagination: BlogPagination;
  /** The href prefix of the card link template (`/works/` for `/works/${post.slug}`). */
  href: string | null;
  /** The fetch exists but is not the canonical shape — show, never rewrite. */
  custom: boolean;
  /** This slot's order among the page's `<BlogSlot>` tags (0-based; task-244 L18). */
  slot: number;
  /** The const this slot's posts fragment maps (`posts`, `posts2`, …); for an
   *  unbound slot, the name a bind will give it (next free `postsN`, L22). */
  postsVar: string;
  /** How many `<BlogSlot>` tags the page holds (numbered pagination needs exactly one, L17). */
  slotCount: number;
}

export const UNBOUND: BlogBinding = {
  hasSlot: true, collection: null, filter: null, sort: null, limit: null,
  pagination: { kind: 'none' }, href: null, custom: false, slot: 0, postsVar: 'posts', slotCount: 1,
};

/** A page without any `<BlogSlot>`. */
export const NO_SLOT: BlogBinding = { ...UNBOUND, hasSlot: false, slotCount: 0 };

export const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)^---[ \t]*\r?\n?/m;
/** The whole `const posts = …;` statement (or the paginate form): non-greedy to the first `;` at line end. */
export const POSTS_STMT_RE = /(?:^|\n)[ \t]*(?:const posts = |return paginate\()([\s\S]*?);[ \t]*(?=\n|$)/;
const COLLECTION_RE = /getCollection\(\s*'([^']+)'/;
const FILTER_RE = /getCollection\(\s*'[^']+'\s*,\s*\(\s*p\s*\)\s*=>\s*(!?)\s*p\.data\.([A-Za-z_$][\w$]*)\s*\)/;
/** The one spelling of each sort; the parser matches it verbatim (whitespace-normalised). */
export const SORT_CODE: Record<BlogSort, string> = {
  'date-desc': '.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf())',
  'date-asc': '.sort((a, b) => a.data.date.valueOf() - b.data.date.valueOf())',
  'title-asc': '.sort((a, b) => a.data.title.localeCompare(b.data.title))',
  'title-desc': '.sort((a, b) => b.data.title.localeCompare(a.data.title))',
};
const LIMIT_RE = /\.slice\(0, (\d+)\)/;
const HREF_RE = /href=\{`([^`$]*)\$\{post\.(?:slug|id)\}`\}/; // legacy entries link by slug, content-layer ones by id
const PAGINATE_RE = /paginate\(posts, \{ pageSize: (\d+) \}\)/;
const LOAD_MORE_RE = /<BlogPaginationLoadMore\b[^>]*pageSize=\{(\d+)\}/;

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const squash = (s: string): string => s.replace(/\s+/g, '');

/** The whole `const <v> = …;` statement line(s) (non-greedy to the first `;` at line end); group 1 = the expression. */
const constStmtRe = (v: string) => new RegExp(`^[ \\t]*const ${escapeRegex(v)} = ([\\s\\S]*?);[ \\t]*$\\n?`, 'm');
/** The list a posts fragment maps: `{posts.map(` → posts, `{page.data.map(` → page (numbered). */
const FRAGMENT_VAR_RE = /<Fragment slot="posts">\s*\{\s*([A-Za-z_$][\w$]*)(?:\.data)?\.map\(/;

/** Each `<BlogSlot>` of the template, in order: the span from its line start
 *  (indent included) to the end of its tag / `</BlogSlot>`. BlogSlots never nest. */
export function slotSpans(source: string): Array<{ start: number; end: number }> {
  const from = source.match(FRONTMATTER_RE)?.index === 0 ? source.match(FRONTMATTER_RE)![0].length : 0;
  const spans: Array<{ start: number; end: number }> = [];
  const tagRe = /<BlogSlot\b(?:[^>/]|\/(?!>))*?(\s*\/>|>)/g;
  tagRe.lastIndex = from;
  for (let m = tagRe.exec(source); m; m = tagRe.exec(source)) {
    const start = source.lastIndexOf('\n', m.index) + 1;
    const selfClosing = m[1].trim() === '/>';
    const close = selfClosing ? -1 : source.indexOf('</BlogSlot>', tagRe.lastIndex);
    const end = selfClosing ? tagRe.lastIndex : close < 0 ? source.length : close + '</BlogSlot>'.length;
    spans.push({ start, end });
    tagRe.lastIndex = end;
  }
  return spans;
}

/** The name an unbound slot's fetch const gets: `posts` for the first slot when free, else the next free `postsN` (N ≥ 2). */
function freePostsVar(frontmatter: string, slot: number, taken: ReadonlySet<string>): string {
  const used = (v: string) => taken.has(v) || constStmtRe(v).test(frontmatter);
  if (slot === 0 && !used('posts')) return 'posts';
  let n = 2;
  while (used(`posts${n}`)) n++;
  return `posts${n}`;
}

/**
 * Every BlogSlot of a page, in template order (task-244). A slot's fetch is
 * the const its posts fragment maps (`posts` / `postsN`; `page.data` =
 * numbered, first slot only); the first slot with no fragment falls back to
 * `const posts` (the single-slot shape). Consts no fragment maps are never
 * read (L24).
 */
export function parseBlogBindings(source: string): BlogBinding[] {
  const frontmatter = source.match(FRONTMATTER_RE)?.[1] ?? '';
  const spans = slotSpans(source);
  const fragmentVars = spans.map(({ start, end }) => source.slice(start, end).match(FRAGMENT_VAR_RE)?.[1] ?? null);
  const taken = new Set(fragmentVars.filter((v): v is string => !!v));
  return spans.map(({ start, end }, slot) => {
    const block = source.slice(start, end);
    const fragmentVar = fragmentVars[slot];
    const v = fragmentVar ?? (slot === 0 ? 'posts' : null);
    const base = { ...UNBOUND, slot, slotCount: spans.length };
    if (!v) return { ...base, postsVar: freePostsVar(frontmatter, slot, taken) };
    const numberedVar = v === 'page';
    const stmt = v === 'posts' || numberedVar ? frontmatter.match(POSTS_STMT_RE) : frontmatter.match(constStmtRe(v));
    const postsVar = numberedVar ? 'posts' : v;
    if (!stmt) return fragmentVar ? { ...base, postsVar, custom: true } : { ...base, postsVar: freePostsVar(frontmatter, slot, taken) };

    const expr = normalize(stmt[1]);
    const collection = expr.match(COLLECTION_RE)?.[1] ?? null;
    if (!collection) return { ...base, postsVar, custom: true };

    const filterMatch = expr.match(FILTER_RE);
    const filter = filterMatch ? (filterMatch[1] ? { field: filterMatch[2], not: true } : { field: filterMatch[2] }) : null;
    const sort = (Object.keys(SORT_CODE) as BlogSort[]).find((k) => expr.includes(SORT_CODE[k])) ?? null;
    const limitMatch = expr.match(LIMIT_RE);
    const limit = limitMatch ? Number(limitMatch[1]) : null;
    const paginate = postsVar === 'posts' ? frontmatter.match(PAGINATE_RE) : null;
    const loadMore = block.match(LOAD_MORE_RE);
    const pagination: BlogPagination = paginate
      ? { kind: 'numbered', pageSize: Number(paginate[1]) }
      : loadMore ? { kind: 'load-more', pageSize: Number(loadMore[1]) } : { kind: 'none' };
    const href = block.match(HREF_RE)?.[1] ?? null;

    // Canonical = the expression is EXACTLY what emit would produce for these
    // settings, whitespace aside (a hand-squashed chain is still ours) — and a
    // getStaticPaths block is ours only with the canonical paginate call.
    const custom = squash(expr) !== squash(emitPostsExpression({ collection, filter, sort, limit }))
      || (/export async function getStaticPaths/.test(frontmatter) && !(postsVar === 'posts' && paginate))
      || (numberedVar && slot !== 0)
      || isForeignPosts(block);
    return { ...base, collection, filter, sort, limit, pagination, href, custom, postsVar };
  });
}

/** The first BlogSlot's binding (`hasSlot: false` when the page has none). */
export function parseBlogBinding(source: string): BlogBinding {
  return parseBlogBindings(source)[0] ?? NO_SLOT;
}

/** The slot a page line belongs to (the `<BlogSlot>` block containing it), else the number of slots before it; 0 without a line. */
export function slotAtLine(source: string, line: number | null): number {
  if (!line) return 0;
  let at = 0;
  for (let n = 1; n < line && at >= 0; n++) at = source.indexOf('\n', at) + 1 || -1;
  if (at < 0) at = source.length;
  const spans = slotSpans(source);
  const inside = spans.findIndex((sp) => sp.start <= at && at < sp.end);
  return inside >= 0 ? inside : Math.max(0, spans.filter((sp) => sp.start < at).length - 1);
}

/** The filter as one token (`featured` / `!featured`) — Blog Settings' select value and the AI tools' `filter`. */
export const filterToken = (f: BlogBinding['filter']): string => (f ? `${f.not ? '!' : ''}${f.field}` : '');
export const parseFilterToken = (t: string | null | undefined): BlogBinding['filter'] =>
  !t ? null : t.startsWith('!') ? { field: t.slice(1), not: true } : { field: t };

/** The right-hand side of `const posts = …` (no trailing `;`). */
export function emitPostsExpression(b: Pick<BlogBinding, 'collection' | 'filter' | 'sort' | 'limit'>): string {
  const fetch = b.filter
    ? `(await getCollection('${b.collection}', (p) => ${b.filter.not ? '!' : ''}p.data.${b.filter.field}))`
    : `(await getCollection('${b.collection}'))`;
  const sort = b.sort ? `\n  ${SORT_CODE[b.sort]}` : '';
  const limit = b.limit != null ? `\n  .slice(0, ${b.limit})` : '';
  return `${fetch}${sort}${limit}`;
}

/**
 * The card link prefix for `collection` when the project already has a detail
 * route (`/<collection>/[slug]` or `/<collection>/[...slug]`), else null —
 * nothing is created unprompted (design U11).
 */
export function detectPostRoute(collection: string, routes: readonly string[]): string | null {
  const re = new RegExp(`^/${escapeRegex(collection)}/\\[(\\.\\.\\.)?slug\\]$`);
  return routes.some((r) => re.test(r)) ? `/${collection}/` : null;
}

// ---------------------------------------------------------------------------
// Emit: BlogBinding → page source
// ---------------------------------------------------------------------------

export interface EmitOptions {
  /** Import specifier for the collection's card relative to the page
   *  (`../components/WorksCard.astro`); the card's name is its file name; the
   *  pagination chrome imports live next to it. */
  cardImport: string;
  /** The prop the card takes its entry by (`work` for `const { work } = Astro.props`); default `post`. */
  cardProp?: string;
  /** The card links itself (cardFields.cardLinksItself): wrap it in a plain
   *  stamped `<div>`, never `<a>` — no nested anchors (task-244 L11). */
  cardLinks?: boolean;
  /** Content-layer entries (Astro ≥5) are addressed by `post.id`; default: the open site's (utils/siteAstro). */
  contentLayer?: boolean;
}

const GET_COLLECTION_IMPORT = "import { getCollection } from 'astro:content';";
/** getCollection already imported, however spelled (`"astro:content"`, with other names). */
const GET_COLLECTION_IMPORTED = /^\s*import\s*\{[^}]*\bgetCollection\b[^}]*\}\s*from\s*['"]astro:content['"]/m;
/** `<BlogSlot …>` / `<BlogSlot … />` opening tag with its leading indent. */
const SLOT_OPEN_RE = /^([ \t]*)<BlogSlot\b((?:[^>/]|\/(?!>))*?)(\s*\/>|>)/m;
const POSTS_FRAGMENT_RE = /[ \t]*<Fragment slot="posts">[\s\S]*?<\/Fragment>[ \t]*\n?/;
const PAGINATION_FRAGMENT_RE = /[ \t]*<Fragment slot="pagination">[\s\S]*?<\/Fragment>[ \t]*\n?/;
/** The frontmatter fetch REGION: the numbered getStaticPaths block (+ its
 *  `const { page }` line) or the plain `const posts = …;` statement. */
const GSP_BLOCK_RE = /^[ \t]*export async function getStaticPaths\(\{ paginate \}\) \{\n[\s\S]*?\n\}[ \t]*$\n?(?:^[ \t]*const \{ page \} = Astro\.props;[ \t]*$\n?)?/m;
/** The library pagination chrome component each kind imports. */
export const PAGINATION_CHROME: Record<'numbered' | 'load-more', string> = { numbered: 'BlogPaginationNumbered', 'load-more': 'BlogPaginationLoadMore' };
/** A frontmatter `import <name> from '<spec>'` line; group 1 = the specifier. */
export const importStatementRe = (name: string) => new RegExp(`^[ \\t]*import\\s+${name}\\s+from\\s+['"]([^'"]+)['"]`, 'm');
const stripFragments = (inner: string) => inner.replace(POSTS_FRAGMENT_RE, '').replace(PAGINATION_FRAGMENT_RE, '').trim();

/** The card's entry prop: `y={post}` (whitespace aside). */
const entryAttr = (t: Tag) => t.attrs.find((a) => a.kind === 'expression' && a.value.trim() === 'post');
const isCardTag = (t: Tag) => /^[A-Z]/.test(t.name) && !!entryAttr(t);

/** The card tags `src` renders (a page, a slot, a fragment): components taking the entry as `y={post}`, at ANY
 *  attribute position — the editor writes instance override props before it (utils/propOverrides.ts). */
export function cardTagsOf(src: string): string[] {
  return scanTags(src, splitFrontmatter(src)?.templateStart ?? 0).filter(isCardTag).map((t) => t.name);
}

/** `t` renamed to `name`: its open tag and its close tag. */
const renameTag = (src: string, t: Tag, name: string): Splice[] => {
  const at = (start: number): Splice => ({ start, end: start + t.name.length, text: name });
  return t.close ? [at(t.start + 1), at(src.indexOf(t.name, t.close.start))] : [at(t.start + 1)];
};

/**
 * THE card swap (card picker, missing-card heal, re-emit): card tag `t` renamed to `name`, its entry `oldProp={…}` to
 * `prop` — by parsed spans, in any attribute position (null = the `{post}` entry, else the first prop passing a bare
 * identifier). Every other attribute — the page's instance override props — and the formatting stay as written.
 */
function cardTagEdits(src: string, t: Tag, name: string, oldProp: string | null, prop: string): Splice[] {
  const entry = oldProp ? t.attrs.find((a) => a.kind === 'expression' && a.name === oldProp)
    : entryAttr(t) ?? t.attrs.find((a) => a.kind === 'expression' && /^\s*[A-Za-z_$][\w$]*\s*$/.test(a.value));
  const edits = renameTag(src, t, name);
  if (entry && entry.name !== prop) edits.push({ start: entry.start, end: entry.start + entry.name.length, text: prop });
  return edits;
}

/** Every `<tag …>` of `tpl` swapped by cardTagEdits. */
export const renameCardTags = (tpl: string, tag: string, name: string, oldProp: string | null, prop: string): string =>
  applySplices(tpl, scanTags(tpl).filter((t) => t.name === tag).flatMap((t) => cardTagEdits(tpl, t, name, oldProp, prop)));

/**
 * The page markup around one post's card. The post link is PAGE markup (`<a … class="block">`), not a card prop: it
 * works for any card — an imported site's own copy too. A self-linking card (or no detail route) gets a <div>; a
 * self-linking card's has no box (`contents`): the cards lay out exactly as without it (live 2026-10-10: a site
 * styling every element `display: flow-root` lost the cards' margin collapse to a plain div). Either is stamped
 * data-sq-post-slug: the bridge reads the nearest stamp, so every element of the card offers "Go to post" (the editor).
 */
function cardWrapper(href: string | null, cardLinks: boolean, id: string) {
  const kind = href !== null && !cardLinks ? 'a' : 'div';
  const link = `href={\`${href}\${${id}}\`}`, stamp = `data-sq-post-slug={${id}}`;
  const want = kind === 'a' ? 'block' : cardLinks ? 'contents' : null; // the class token the binding owns
  return { kind, link, stamp, want, open: kind === 'a' ? `<a ${link} class="block" ${stamp}>` : `<div${want ? ` class="${want}"` : ''} ${stamp}>` };
}
type CardWrapper = ReturnType<typeof cardWrapper>;

type PostsShape = { list: Span; wrapper?: Tag; card: Tag };

/** The posts fragment as the binding writes it — `{LIST.map((post) => <a|div …><Card … /></a|div>)}`, the wrapper
 *  optional (older pages) — and nothing else; null for any other shape: the page's own markup, so the slot is custom
 *  and never rewritten (a re-emit would otherwise drop what the page added). */
function postsShape(fragment: string): PostsShape | null {
  const head = /^\s*<Fragment slot="posts">\s*\{\s*([A-Za-z_$][\w$]*(?:\.data)?)\.map\(\(\s*post\s*\)\s*=>\s*(\(\s*)?/.exec(fragment);
  if (!head) return null;
  const [, outer, inner, ...extra] = scanTags(fragment); // tag 0 is the head's Fragment; a card outside the wrapper fails the tail
  if (extra.length || outer?.start !== head[0].length) return null;
  const wrapper = inner ? outer : undefined;
  const card = inner ?? outer;
  if (!isCardTag(card) || !card.selfClosing || (wrapper && (!/^(a|div)$/.test(wrapper.name) || !wrapper.close))) return null;
  const tail = head[2] ? /^\s*\)\s*\)\s*\}\s*<\/Fragment>\s*$/ : /^\s*\)\s*\}\s*<\/Fragment>\s*$/; // `=> (<a …/>)` as Prettier prints it
  if (!tail.test(fragment.slice(wrapper ? wrapper.close!.end : card.openEnd))) return null;
  const list = head[0].indexOf(head[1], head[0].indexOf('{')); // after the map's `{`: never the arrow's own `(post)`
  return { list: { start: list, end: list + head[1].length }, wrapper, card };
}

/** The slot has a posts fragment the binding did not write (custom: shown as hand-wired, never rewritten). */
function isForeignPosts(block: string): boolean {
  const fragment = block.match(POSTS_FRAGMENT_RE)?.[0];
  return !!fragment && !postsShape(fragment);
}

/**
 * Re-emit a posts fragment of the binding's own shape IN PLACE: only the spans the binding owns change — the list,
 * the card tag by THE card swap (cardTagEdits: another card keeps the page's props, as in the card picker), and the
 * wrapper's kind, link, stamp and owned class token (cardWrapper). Everything else — instance override props on the
 * card tag (the only place they live), the wrapper's own classes, the formatting — stays byte-for-byte.
 */
function rewritePosts(fragment: string, { list, wrapper, card }: PostsShape, o: { list: string; cardName: string; cardProp: string; w: CardWrapper }): string {
  const { kind, link, stamp, want, open } = o.w;
  const edits: Splice[] = [{ ...list, text: o.list }, ...cardTagEdits(fragment, card, o.cardName, null, o.cardProp)];
  if (!wrapper) return applySplices(fragment, [...edits, { start: card.start, end: card.start, text: open }, { start: card.openEnd, end: card.openEnd, text: `</${kind}>` }]);
  if (wrapper.name !== kind) edits.push(...renameTag(fragment, wrapper, kind));
  const nameEnd = wrapper.start + 1 + wrapper.name.length;
  const inserts: string[] = [];
  const href = attrOf(wrapper, 'href');
  if (kind === 'a') { if (href) edits.push({ start: href.start, end: href.end, text: link }); else inserts.push(link); }
  else if (href) edits.push(removeAttr(fragment, href));
  const cls = attrOf(wrapper, 'class');
  if (cls?.kind === 'quoted') {
    const tokens = cls.value.split(/\s+/).filter(Boolean);
    const next = tokens.filter((t) => (t !== 'block' && t !== 'contents') || t === want); // both binding-owned: never `contents block`
    if (want && !next.includes(want)) next.unshift(want);
    const v = next.join(' '), q = v.includes('"') ? "'" : '"'; // `font-["Inter"]` needs single quotes (ast-updater attrQuote)
    if (v !== tokens.join(' ')) edits.push(next.length ? { start: cls.start, end: cls.end, text: `class=${q}${v}${q}` } : removeAttr(fragment, cls));
  } else if (!cls && want) inserts.push(`class="${want}"`); // class={…} / class:list: the page's own expression, left alone
  if (inserts.length) edits.push({ start: nameEnd, end: nameEnd, text: ` ${inserts.join(' ')}` });
  const slug = attrOf(wrapper, 'data-sq-post-slug');
  edits.push(slug ? { start: slug.start, end: slug.end, text: stamp } : { start: wrapper.openEnd - 1, end: wrapper.openEnd - 1, text: ` ${stamp}` });
  return applySplices(fragment, edits);
}

/**
 * Rewrite `source` so that its `slot`-th BlogSlot (0-based) carries `binding`.
 * Returns the new page source, or null when the page has no such slot, its
 * existing fetch is custom (the UI must not rewrite hand-written code), or
 * numbered pagination is asked on a page with more than one slot (it owns the
 * page's `[...page]` route, L17). Other slots and their fetches stay
 * byte-identical (L18). Pure: no I/O — the numbered kind's route move
 * (blog.astro → blog/[...page].astro) is the writer's job.
 */
export function emitBlogBinding(source: string, binding: BlogBinding, opts: EmitOptions, slot = 0): string | null {
  const all = parseBlogBindings(source);
  const current = all[slot];
  if (!current || current.custom) return null;
  if (binding.pagination.kind === 'numbered' && all.length > 1) return null;
  const v = current.postsVar;
  const cardName = opts.cardImport.match(/([A-Za-z_$][\w$]*)\.astro$/)?.[1] ?? 'BlogCard';
  const cardProp = opts.cardProp ?? 'post';
  const prefix = opts.cardImport.replace(/[^/]*$/, '');
  const importOf = (name: string) => `import ${name} from '${prefix}${name}.astro';`;
  const unbind = binding.collection === null;
  /** Rewrite ONLY this slot's span: its fragments replaced by `fragments(indent)` (null = removed); other children kept. */
  const inSlot = (src: string, fragments: ((indent: string) => string) | null) => {
    const at = slotSpans(src)[slot];
    const span = src.slice(at.start, at.end);
    const [open, indent, attrs, close] = SLOT_OPEN_RE.exec(span)!;
    const rest = close.includes('/') ? '' : stripFragments(span.slice(open.length, span.lastIndexOf('</BlogSlot>')));
    const body = [fragments?.(indent), rest && `${indent}  ${rest}`].filter(Boolean).join('\n');
    const next = body ? `${indent}<BlogSlot${attrs}>\n${body}\n${indent}</BlogSlot>` : `${indent}<BlogSlot${attrs.trimEnd()} />`;
    return src.slice(0, at.start) + next + src.slice(at.end);
  };
  let out: string;

  if (unbind) {
    // Drop both fragments, then the fetch region unless something else still
    // reads the const (L23); the import sweep and an emptied frontmatter follow.
    out = inSlot(source, null);
    const dropped = replaceFrontmatter(out, (body) => setFetchRegion(body, null, v));
    out = readsIdentifier(dropped, v) ? out : dropped;
  } else {
    // BIND / RE-BIND
    const kind = binding.pagination.kind;
    const chrome = kind === 'none' ? null : PAGINATION_CHROME[kind];
    out = source.match(FRONTMATTER_RE) ? source : `---\n---\n\n${source}`;
    out = replaceFrontmatter(out, (body) => {
      let b = body;
      if (!GET_COLLECTION_IMPORTED.test(b)) b = `${GET_COLLECTION_IMPORT}\n${b}`;
      if (!importStatementRe(cardName).test(b)) b = insertAfterLastImport(b, importOf(cardName));
      if (chrome && !importStatementRe(chrome).test(b)) b = insertAfterLastImport(b, importOf(chrome));
      return setFetchRegion(b, fetchRegion(binding, v), v);
    });

    const list = kind === 'numbered' ? 'page.data' : v;
    const id = (opts.contentLayer ?? siteUsesContentLayer()) ? 'post.id' : 'post.slug';
    const w = cardWrapper(binding.href, !!opts.cardLinks, id);
    const card = `${w.open}<${cardName} ${cardProp}={post} /></${w.kind}>`;
    // The page's own posts fragment is edited in place (custom shapes were refused above, by the parse); a card the
    // page imports under another name keeps that name.
    const at = slotSpans(out)[slot];
    const old = out.slice(at.start, at.end).match(POSTS_FRAGMENT_RE)?.[0];
    const shape = old ? postsShape(old) : null;
    const tagName = shape && out.match(importStatementRe(shape.card.name))?.[1] === opts.cardImport ? shape.card.name : cardName;
    const fragments = (indent: string) => {
      const posts = old && shape
        ? rewritePosts(old, shape, { list, cardName: tagName, cardProp, w }).trimEnd()
        : `${indent}  <Fragment slot="posts">\n${indent}    {${list}.map((post) => ${card})}\n${indent}  </Fragment>`;
      const tag = kind === 'numbered' ? `<${chrome} page={page} />` : kind === 'load-more' ? `<${chrome} pageSize={${binding.pagination.pageSize}} />` : null;
      return tag ? `${posts}\n${indent}  <Fragment slot="pagination">\n${indent}    ${tag}\n${indent}  </Fragment>` : posts;
    };
    out = inSlot(out, fragments);
  }

  // Imports the page no longer uses: getCollection + the card after an unbind,
  // the previous card after a re-bind to another card, the other chrome after
  // a pagination change (a used import — another slot's card too — is kept).
  out = dropImportIfUnused(out, GET_COLLECTION_IMPORT, /getCollection\(/);
  const span = slotSpans(source)[slot];
  const cards = cardTagsOf(source.slice(span.start, span.end)); // the card this slot rendered (only it can lose its last use)
  for (const name of [...new Set(['BlogCard', cardName, ...cards]), ...Object.values(PAGINATION_CHROME)]) {
    const line = out.match(new RegExp(`${importStatementRe(name).source}.*$`, 'm'))?.[0] ?? importOf(name);
    out = dropImportIfUnused(out, line, new RegExp(`<${name}\\b`));
  }
  return unbind ? out.replace(/^---[ \t]*\n[\s]*---[ \t]*\n\n?/, '') : out;
}

/** The frontmatter fetch region for `binding` under const `v` (trailing newline included). */
function fetchRegion(binding: BlogBinding, v = 'posts'): string {
  const expr = emitPostsExpression(binding);
  if (binding.pagination.kind !== 'numbered') return `const ${v} = ${expr};\n`;
  return `export async function getStaticPaths({ paginate }) {\n  const posts = ${expr.replace(/\n/g, '\n  ')};\n  return paginate(posts, { pageSize: ${binding.pagination.pageSize} });\n}\nconst { page } = Astro.props;\n`;
}

/** Replace (or remove with null / append when absent) the fetch region of const `v` in a frontmatter body. */
function setFetchRegion(body: string, region: string | null, v = 'posts'): string {
  const m = (v === 'posts' ? body.match(GSP_BLOCK_RE) : null) ?? body.match(constStmtRe(v));
  if (m && m.index !== undefined) return body.slice(0, m.index) + (region ?? '') + body.slice(m.index + m[0].length);
  if (!region) return body;
  return `${body.replace(/\s+$/, '')}\n${region}`;
}

export function replaceFrontmatter(source: string, fn: (body: string) => string): string {
  return source.replace(FRONTMATTER_RE, (m, body: string) => {
    const at = m.indexOf('\n') + 1; // after the opening fence (body may be '')
    return m.slice(0, at) + fn(body) + m.slice(at + body.length);
  });
}

export function insertAfterLastImport(body: string, line: string): string {
  const lines = body.split('\n');
  let last = -1;
  lines.forEach((l, i) => { if (/^import\s/.test(l)) last = i; });
  lines.splice(last + 1, 0, line);
  return lines.join('\n');
}

/** `name` is read somewhere in `src` as an identifier (not a property, not inside a quoted word). */
export const readsIdentifier = (src: string, name: string): boolean => new RegExp(`(?<![\\w$.'"])${escapeRegex(name)}(?![\\w$'"])`).test(src);

/** Drop `importLine` unless the rest of the file still matches `usage`. */
function dropImportIfUnused(source: string, importLine: string, usage: RegExp): string {
  const without = source.replace(`${importLine}\n`, '');
  return without !== source && !usage.test(without) ? without : source;
}

// ---------------------------------------------------------------------------
// Route move support: a page one folder deeper needs its relative imports re-based
// ---------------------------------------------------------------------------

const dirOf = (file: string) => file.slice(0, Math.max(0, file.lastIndexOf('/')));
const resolveFrom = (dir: string, spec: string) => {
  const out = dir ? dir.split('/') : [];
  for (const seg of spec.split('/')) {
    if (seg === '..') out.pop();
    else if (seg !== '.' && seg !== '') out.push(seg);
  }
  return out.join('/');
};

/** The project-relative file a relative import specifier in `fromFile` points at. */
export function resolveImportPath(fromFile: string, spec: string): string {
  return resolveFrom(dirOf(fromFile), spec);
}

/** The specifier `toFile` writes for a relative import `spec` of `fromFile` (bare/alias specifiers pass through). */
export function rebaseImportSpecifier(spec: string, fromFile: string, toFile: string): string {
  return /^\.\.?\//.test(spec) ? importSpecifierFor(toFile, resolveImportPath(fromFile, spec)) : spec;
}

/**
 * Re-base the frontmatter's RELATIVE import specifiers when the page file
 * moves between folders (`blog.astro` ⇄ `blog/[...page].astro`). Bare
 * specifiers and the template are untouched.
 * // ponytail: imports only — a relative `Astro.glob('./x')` or asset URL in
 * // the template is not re-based (rare on a listing page).
 */
export function rebaseRelativeImports(source: string, fromFile: string, toFile: string): string {
  if (dirOf(fromFile) === dirOf(toFile)) return source;
  return replaceFrontmatter(source, (body) =>
    body.replace(/(\bfrom\s+)(['"])(\.\.?\/[^'"]*)\2/g, (_m, kw: string, q: string, spec: string) =>
      `${kw}${q}${rebaseImportSpecifier(spec, fromFile, toFile)}${q}`));
}
