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
      || (numberedVar && slot !== 0);
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

/** The card tags a slot's fragment renders (`<X y={post} />`, as emitBlogBinding writes them). */
export function cardTagsOf(src: string): string[] {
  return [...src.matchAll(/<([A-Z][\w$]*)\s+[\w$]+=\{post\}/g)].map((m) => m[1]);
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

    // The post link is PAGE markup around the card (`<a … class="block">`), not
    // a card prop: it works for any card — an imported site's own copy too.
    // The wrapper (a plain <div> when the project has no detail route) is
    // stamped data-sq-post-slug: the bridge reads the nearest stamp, so every
    // element of the card offers "Go to post" (the editor), route or no route.
    const list = kind === 'numbered' ? 'page.data' : v;
    const id = (opts.contentLayer ?? siteUsesContentLayer()) ? 'post.id' : 'post.slug';
    const card = binding.href !== null && !opts.cardLinks
      ? `<a href={\`${binding.href}\${${id}}\`} class="block" data-sq-post-slug={${id}}><${cardName} ${cardProp}={post} /></a>`
      // A self-linking card's wrapper has no box (`contents`): the cards lay out
      // exactly as without it (live 2026-10-10: a site styling every element
      // `display: flow-root` lost the cards' margin collapse to a plain div).
      : `<div${opts.cardLinks ? ' class="contents"' : ''} data-sq-post-slug={${id}}><${cardName} ${cardProp}={post} /></div>`;
    const fragments = (indent: string) => {
      const posts = `${indent}  <Fragment slot="posts">\n${indent}    {${list}.map((post) => ${card})}\n${indent}  </Fragment>`;
      const tag = kind === 'numbered' ? `<${chrome} page={page} />` : kind === 'load-more' ? `<${chrome} pageSize={${binding.pagination.pageSize}} />` : null;
      return tag ? `${posts}\n${indent}  <Fragment slot="pagination">\n${indent}    ${tag}\n${indent}  </Fragment>` : posts;
    };
    out = inSlot(out, fragments);
  }

  // Imports the page no longer uses: getCollection + the card after an unbind,
  // the previous card after a re-bind to another card, the other chrome after
  // a pagination change (a used import — another slot's card too — is kept).
  out = dropImportIfUnused(out, GET_COLLECTION_IMPORT, /getCollection\(/);
  const cards = cardTagsOf(source); // the card(s) the page rendered
  for (const name of [...new Set(['BlogCard', ...cards]), ...Object.values(PAGINATION_CHROME)]) {
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
