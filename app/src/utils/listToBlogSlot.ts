/**
 * One reusable list (task-244, design docs/plans/2026-10-10-one-reusable-list-design.md):
 * a SIMPLE imported list component (WorkList: typed `CollectionEntry<"c">[]`,
 * one optional filter + sort, maps entries to one card) becomes a BlogSlot on
 * the page that renders it — the fetch, card and layout classes move into the
 * page code, where Blog Settings edits them. Anything the converter cannot
 * read exactly stays as it is (L3). Pure string transforms; the page is
 * written by the SAME emit Blog Settings uses (utils/blogBinding), so a
 * converted slot is byte-identical to one bound in the editor.
 */
import { emitBlogBinding, FRONTMATTER_RE, importStatementRe, squash, insertAfterLastImport, readsIdentifier, replaceFrontmatter, resolveImportPath, slotSpans, UNBOUND, type BlogBinding, type BlogSort } from './blogBinding';
import { cardEmitOptions, renderedComponents } from './cardAssignment';
import { plumbBlogSlotClasses, blogSlotClassProps } from './blogSlotChrome';
import { CARD_FILE, DEFAULT_CARD, isCardSource } from './cardFields';
import { importSpecifierFor } from './localStructural';

export interface ListConversion {
  /** Files that change (pages + BlogSlot.astro when created/plumbed). */
  /** Files that change; `null` = deleted (a converted list nothing imports any more — owner 2026-10-10). */
  writes: Record<string, string | null>;
  converted: Array<{ page: string; list: string; slot: number }>;
  skipped: Array<{ page: string; list: string; reason: string }>;
}

const SLOT_FILE = 'src/components/BlogSlot.astro';
const ID = '[A-Za-z_$][\\w$]*';
type Filter = BlogBinding['filter'];

// ---------------------------------------------------------------------------
// Reading code
// ---------------------------------------------------------------------------

/** Top-level `const name = …` statements: a statement ends at `;` or at a line end (depth 0) not followed by a `.`-chained line. */
function constStatements(body: string): Array<{ name: string; expr: string; start: number; end: number }> {
  const out: Array<{ name: string; expr: string; start: number; end: number }> = [];
  const re = new RegExp(`^[ \\t]*const\\s+(${ID})\\s*=\\s*`, 'gm');
  for (let m = re.exec(body); m; m = re.exec(body)) {
    let depth = 0, i = re.lastIndex, quote = '';
    for (; i < body.length; i++) {
      const ch = body[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (depth === 0 && ch === ';') break;
      else if (depth === 0 && ch === '\n' && !/^\s*\./.test(body.slice(i + 1))) break;
    }
    const expr = body.slice(re.lastIndex, i).trim();
    const end = body[i] === ';' ? i + 1 : i;
    out.push({ name: m[1], expr, start: m.index, end: body[end] === '\n' ? end + 1 : end });
    re.lastIndex = end;
  }
  return out;
}

/** `base.f(arg).g(arg)` → base + calls; null when anything else is in the expression. */
function chainOf(expr: string): { base: string; calls: Array<{ name: string; arg: string }> } | null {
  const base = new RegExp(`^${ID}`).exec(expr)?.[0];
  if (!base) return null;
  const calls: Array<{ name: string; arg: string }> = [];
  let i = base.length;
  const call = new RegExp(`\\s*\\.\\s*(${ID})\\s*\\(`, 'y');
  while (i < expr.length) {
    call.lastIndex = i;
    const m = call.exec(expr);
    if (!m) return null;
    let depth = 1, j = call.lastIndex;
    for (; j < expr.length && depth; j++) depth += expr[j] === '(' ? 1 : expr[j] === ')' ? -1 : 0;
    if (depth) return null;
    calls.push({ name: m[1], arg: expr.slice(call.lastIndex, j - 1).trim() });
    i = j;
  }
  return { base, calls };
}

const fetchOf = (expr: string) => /^\(?\s*await\s+getCollection\(\s*['"]([^'"]+)['"]\s*\)\s*\)?$/.exec(expr)?.[1] ?? null;

/** `x => [!]x.data.F` → { field[, not] }. */
function filterOf(arg: string): Filter | undefined {
  const m = new RegExp(`^\\(?(${ID})\\)?=>(!?)\\1\\.data\\.(${ID})$`).exec(squash(arg));
  if (!m) return undefined;
  return m[2] ? { field: m[3], not: true } : { field: m[3] };
}

/** One of the four sorts in any of its usual spellings (L15); else undefined (L16). */
function sortOf(arg: string): BlogSort | undefined {
  const m = new RegExp(`^\\(?(${ID}),(${ID})\\)?=>(.+)$`).exec(squash(arg));
  if (!m) return undefined;
  const [, a, b, body] = m;
  const order = (x: string, y: string) => (x === a && y === b ? 'asc' : x === b && y === a ? 'desc' : null);
  const title = new RegExp(`^(${ID})\\.data\\.title\\.localeCompare\\((${ID})\\.data\\.title\\)$`).exec(body);
  if (title) { const o = order(title[1], title[2]); return o ? `title-${o}` : undefined; }
  const date = (side: string) => new RegExp(`^(?:(${ID})\\.data\\.date\\.(?:valueOf|getTime)\\(\\)|Number\\((${ID})\\.data\\.date\\)|\\+(${ID})\\.data\\.date)$`).exec(side)?.slice(1).find(Boolean);
  const sides = body.split('-');
  if (sides.length !== 2) return undefined;
  const [x, y] = sides.map(date);
  const o = x && y ? order(x, y) : null;
  return o ? `date-${o}` : undefined;
}

/** Page ∧ list: one filter after merging (same field + polarity collapses); null = not simple (L14). */
function mergeFilters(p: Filter, l: Filter): { filter: Filter } | null {
  if (!p || !l) return { filter: p ?? l };
  return p.field === l.field && !!p.not === !!l.not ? { filter: p } : null;
}

interface SimpleList { prop: string; collection: string; filter: Filter; sort: BlogSort | null; cardFile: string; cardAttr: string; rootClass: string }

/** A list component in the §3 simple pattern, or why not. */
function readList(file: string, src: string, files: Record<string, string>): SimpleList | { reason: string } {
  const fm = src.match(FRONTMATTER_RE);
  if (!fm || fm.index !== 0) return { reason: 'the list has no frontmatter' };
  let body = fm[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  body = body.replace(/^\s*import\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"]astro:content['"];?[ \t]*$/gm, '');
  const imports = [...body.matchAll(new RegExp(`^\\s*import\\s+(${ID})\\s+from\\s*['"]([^'"]+)['"];?[ \\t]*$`, 'gm'))];
  if (imports.length !== 1) return { reason: 'the list does not import exactly one card' };
  const [importLine, cardName, cardSpec] = imports[0];
  if (!/^\.\.?\//.test(cardSpec) || !cardSpec.endsWith('.astro')) return { reason: 'the card is not a relative .astro import' };
  body = body.replace(importLine, '');
  const props = new RegExp(`(?:type\\s+Props\\s*=\\s*|interface\\s+Props\\s*)\\{\\s*(${ID})\\s*:\\s*CollectionEntry<\\s*['"]([^'"]+)['"]\\s*>\\s*\\[\\]\\s*[;,]?\\s*\\};?`).exec(body);
  if (!props) return { reason: 'the list props are not one CollectionEntry<…>[]' };
  body = body.replace(props[0], '');
  const [, prop, collection] = props;
  const destructure = new RegExp(`const\\s*\\{\\s*${prop}\\s*\\}\\s*=\\s*Astro\\.props\\s*;?`).exec(body);
  if (!destructure) return { reason: 'the list does not read its prop plainly' };
  body = body.replace(destructure[0], '');
  const consts = constStatements(body);
  if (consts.length > 1) return { reason: 'the list has its own logic' };
  let rest = body;
  let list = prop, filter: Filter = null, sort: BlogSort | null = null;
  if (consts.length) {
    const c = consts[0];
    rest = body.slice(0, c.start) + body.slice(c.end);
    const chain = chainOf(c.expr);
    if (!chain || chain.base !== prop || chain.calls.length > 2) return { reason: 'the list has its own logic' };
    for (const [i, call] of chain.calls.entries()) {
      if (call.name === 'filter' && i === 0) {
        const f = filterOf(call.arg);
        if (f === undefined) return { reason: 'the list filter is not one boolean field' };
        filter = f;
      } else if (call.name === 'sort' && i === chain.calls.length - 1) {
        const s = sortOf(call.arg);
        if (!s) return { reason: 'the list sort is not date or title' };
        sort = s;
      } else return { reason: 'the list has its own logic' };
    }
    list = c.name;
  }
  if (rest.trim()) return { reason: 'the list has its own logic' };

  const template = src.slice(fm[0].length).replace(/<!--[\s\S]*?-->/g, '').trim();
  const root = new RegExp(`^<div\\s+class=(?:"([^"]*)"|'([^']*)')\\s*>\\s*\\{\\s*${list}\\.map\\(\\s*\\(?\\s*(${ID})\\s*\\)?\\s*=>\\s*<${cardName}\\s+(${ID})=\\{\\s*\\3\\s*\\}\\s*\\/>\\s*\\)\\s*\\}\\s*<\\/div>$`).exec(template);
  if (!root) return { reason: 'the list root is not one <div class> rendering only its cards' };
  const cardFile = resolveImportPath(file, cardSpec);
  if (!files[cardFile] || !isCardSource(files[cardFile])) return { reason: 'the card is not a card component' };
  return { prop, collection, filter, sort, cardFile, cardAttr: root[4], rootClass: (root[1] ?? root[2]).replace(/\s+/g, ' ').trim() };
}

const isListLike = (src: string) => /CollectionEntry</.test(src) && /\.map\(/.test(src) && !isCardSource(src);
const addImport = (src: string, line: string) => replaceFrontmatter(src, (body) => insertAfterLastImport(body, line));

/** Drop `const`s derived from a fetch (getCollection, or another such const) that nothing reads any more (L4). */
function dropDeadFetches(src: string): string {
  const consts = constStatements(src.match(FRONTMATTER_RE)?.[1] ?? '');
  const fetchy = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const c of consts) if (!fetchy.has(c.name) && (/getCollection\(/.test(c.expr) || [...fetchy].some((n) => readsIdentifier(c.expr, n)))) { fetchy.add(c.name); grew = true; }
  }
  // Last to first: removing a statement never moves the ones before it; repeat while a removal frees another.
  for (let changed = true; changed;) {
    changed = false;
    for (const c of constStatements(src.match(FRONTMATTER_RE)?.[1] ?? '').reverse()) {
      if (!fetchy.has(c.name)) continue;
      const without = replaceFrontmatter(src, (b) => b.slice(0, c.start) + b.slice(c.end));
      if (!readsIdentifier(without, c.name)) { src = without; changed = true; }
    }
  }
  return replaceFrontmatter(src, (b) => b.replace(/\n{3,}/g, '\n\n'));
}

/**
 * `<L prop={v} />` at [start, end) of `page` → the page with a bound BlogSlot in
 * its place (the SAME emit Blog Settings uses), or why not (§3).
 */
function convertUsage(files: Readonly<Record<string, string>>, page: string, src: string, start: number, end: number,
  prop: string, v: string, listFile: string, classProps: { section: string; posts: string }): { out: string; slot: number } | { reason: string } {
  const list = readList(listFile, files[listFile], files);
  if ('reason' in list) return list;
  if (prop !== list.prop) return { reason: 'the list usage passes another prop' };
  // The page side: `const V = await getCollection('c')`, or one filter hop off such a const.
  const consts = constStatements(src.match(FRONTMATTER_RE)![1]);
  const fetchConst = consts.find((c) => c.name === v);
  let collection = fetchConst ? fetchOf(fetchConst.expr) : null;
  let pageFilter: Filter = null;
  if (fetchConst && !collection) {
    const chain = chainOf(fetchConst.expr);
    const base = chain?.calls.length === 1 && chain.calls[0].name === 'filter' ? consts.find((c) => c.name === chain.base) : undefined;
    const f = chain && base ? filterOf(chain.calls[0].arg) : undefined;
    collection = base && f !== undefined ? fetchOf(base.expr) : null;
    pageFilter = f ?? null;
  }
  if (!collection) return { reason: 'the page fetch is not simple' };
  if (collection !== list.collection) return { reason: `the page passes ${collection} to a ${list.collection} list` };
  const merged = mergeFilters(pageFilter, list.filter);
  if (!merged) return { reason: 'page and list filter on different fields' };
  const cardName = list.cardFile.replace(/^.*\//, '').replace(/\.astro$/, '');
  const clash = src.match(importStatementRe(cardName))?.[1];
  if (clash && resolveImportPath(page, clash) !== list.cardFile) return { reason: `the page already imports another ${cardName}` };

  // Replace the usage with an unbound slot carrying the list's layout, then bind it.
  const slot = slotSpans(src).filter((sp) => sp.start < start).length;
  const cls = list.rootClass.includes('"') ? `{${JSON.stringify(list.rootClass)}}` : `"${list.rootClass}"`;
  let next = `${src.slice(0, start)}<BlogSlot ${classProps.section}="" ${classProps.posts}=${cls} />${src.slice(end)}`;
  if (!importStatementRe('BlogSlot').test(next.match(FRONTMATTER_RE)![1])) next = addImport(next, `import BlogSlot from '${importSpecifierFor(page, SLOT_FILE)}';`);
  const binding: BlogBinding = { ...UNBOUND, collection, filter: merged.filter, sort: list.sort };
  const out = emitBlogBinding(next, binding, { ...cardEmitOptions(page, list.cardFile, files[list.cardFile]), cardProp: list.cardAttr }, slot);
  return out === null ? { reason: 'the page cannot take a BlogSlot (its blog fetch is wired by hand)' } : { out, slot };
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

export function convertListsToBlogSlots(files: Readonly<Record<string, string>>, opts: { blogSlotLibrary: string }): ListConversion {
  const writes: Record<string, string | null> = {};
  const converted: ListConversion['converted'] = [];
  const skipped: ListConversion['skipped'] = [];
  const slotSrc = files[SLOT_FILE];
  const slot = slotSrc === undefined ? opts.blogSlotLibrary : plumbBlogSlotClasses(slotSrc);
  const classProps = slot ? blogSlotClassProps(slot) : null;

  for (const page of Object.keys(files).filter((f) => /^src\/pages\/.*\.astro$/.test(f)).sort()) {
    let src = files[page];
    const fm = src.match(FRONTMATTER_RE);
    if (!fm || fm.index !== 0) continue;
    const lists = new Map(renderedComponents(page, src).filter(([, file]) => files[file] !== undefined && isListLike(files[file]))); // tag → list file
    if (!lists.size) continue;
    const tagRe = new RegExp(`<(${[...lists.keys()].join('|')})(?=[\\s/>])`, 'g');
    const usedLists = new Set<string>();
    let pageChanged = false;
    // Template order; `tail` = the bytes after the usage, which a conversion never touches.
    for (let tail = src.length - fm[0].length; ;) {
      tagRe.lastIndex = src.length - tail;
      const m = tagRe.exec(src);
      if (!m) break;
      const listFile = lists.get(m[1])!;
      usedLists.add(m[1]);
      const usage = new RegExp(`<${m[1]}\\s+(${ID})\\s*=\\s*\\{\\s*(${ID})\\s*\\}\\s*(?:\\/>|>\\s*<\\/${m[1]}>)`, 'y');
      usage.lastIndex = m.index;
      const u = usage.exec(src);
      const end = u ? usage.lastIndex : m.index + m[0].length;
      tail = src.length - end;
      const r = !classProps ? { reason: 'BlogSlot is custom' }
        : !u ? { reason: 'the list usage has other attributes or children' }
        : convertUsage(files, page, src, m.index, end, u[1], u[2], listFile, classProps);
      if ('reason' in r) { skipped.push({ page, list: listFile, reason: r.reason }); continue; }
      src = r.out;
      pageChanged = true;
      converted.push({ page, list: listFile, slot: r.slot });
    }
    if (!pageChanged) continue;
    // Lists no longer rendered lose their import; fetch consts nobody reads go (L4).
    const template = () => src.slice(src.match(FRONTMATTER_RE)![0].length);
    for (const name of usedLists) {
      if (new RegExp(`<${name}(?=[\\s/>])`).test(template())) continue;
      src = replaceFrontmatter(src, (b) => b.replace(new RegExp(`${importStatementRe(name).source}.*\\n`, 'm'), ''));
    }
    writes[page] = dropDeadFetches(src);
  }

  // A converted list nothing imports any more is deleted (owner 2026-10-10: no dead list files).
  const after = { ...files, ...writes };
  for (const list of new Set(converted.map((c) => c.list))) {
    const importers = Object.entries(after).filter(([f, src]) => f !== list && src !== null && renderedComponents(f, src).some(([, t]) => t === list));
    if (!importers.length) writes[list] = null;
  }

  if (converted.length && slot) {
    if (slot !== slotSrc) writes[SLOT_FILE] = slot;
    // The library BlogSlot imports ./BlogCard.astro (its placeholder) — a page must never import a file that imports a missing one.
    if (slotSrc === undefined && files[CARD_FILE] === undefined) writes[CARD_FILE] = DEFAULT_CARD;
  }
  return { writes, converted, skipped };
}
