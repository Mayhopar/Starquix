/**
 * Instance overrides LIVE IN FILES (owner ruling 2026-10-07 — "like Figma":
 * they survive close/reopen, export → import, deploy). An element a component
 * renders reads the overridable value from a prop, the master value as the
 * fallback:
 *   Header.astro   <ul class={Astro.props.ulClass ?? "flex p-6"}>
 *                  <ul class:list={Astro.props.ulClass ?? ["flex", { open }]}>
 *                  <h2>{Astro.props.h2Text ?? "Works"}</h2>
 *                  <p>{Astro.props.pHtml ? <Fragment set:html={Astro.props.pHtml} /> : <>Hi <a href="/x">there</a></>}</p>
 *                  <img src={Astro.props.imgSrc ?? "/a.jpg"} alt={Astro.props.imgAlt ?? "A"} />
 *   about.astro    <Header ulClass="flex p-6 opacity-90" h2Text="Projects" />
 * A placement through intermediate components (Header inside the Main layout,
 * Main on the page) threads the prop through each usage:
 *   Main.astro     <Header ulClass={Astro.props.headerUlClass} />
 *   about.astro    <Layout headerUlClass="flex p-6 opacity-90">
 * Push = bake the value into the fallback + drop the page prop; Reset = drop
 * the page prop. The tagger reports a literal fallback (`data-sq-cf`/`-tf`/`-sf`)
 * so the editor knows what the MASTER says while the page renders the override.
 */
import type { SourceLocation } from '@/store/types';
import { readOpeningTag, readElementContent, updateAttribute, updateAttributeExpression, updateTextContent } from '@/vite-plugin/ast-updater';
import { openingTagAttributes } from '../../../preview-template/src/plugins/sq-image-fill.js';
import { parseValueForm, parseMarkupForm, valueExpr, markupForm, hasMarkup, collectImportSpecifiers, literalValue, decodeInnerHtmlEntities } from '../../../preview-template/src/plugins/sq-prop-fallback.js';
import { sameTokenSet } from '@/core/classes';
import { resolveImportPath } from './blogBinding';
import { createSourceIdentityMap, spliceSourceSpans } from '@/vite-plugin/source-transform-identity';
import type { SourceIdentityMap } from '@/services/durableEdits/types';

/** `class` / `text` (plain or with inline markup), or an `<img>` attribute (`src` / `alt`). */
export type OverrideKind = 'class' | 'text' | 'src' | 'alt';
const ATTR_OF: Partial<Record<OverrideKind, string>> = { class: 'class', src: 'src', alt: 'alt' };

export interface OverrideHop {
  /** The component file that renders the next-inner element. */
  component: string;
  /** The tag that placed `component`, in the next-outer file. `line: 0` = the
   *  scan cannot see it (`component` renders no element of its own — a layout
   *  wrapping another layout); it is found from `usage.file` (the page) by imports. */
  usage: SourceLocation;
}

interface ScanLike { key: string; parentKey: string | null; sourceLocation?: SourceLocation; usageLocation?: SourceLocation }

/**
 * Element → page: one hop per component boundary, read off the scan. Each
 * element carries only its IMMEDIATE usage; the next one out is the usage of
 * the nearest ancestor defined in the placing file. Null = not an instance on
 * this page, or a chain the scan cannot prove.
 */
export function overrideChain(elements: readonly ScanLike[], key: string, pageFile: string,
  byKey: ReadonlyMap<string, ScanLike> = new Map(elements.map(e => [e.key, e]))): OverrideHop[] | null {
  let cur = byKey.get(key);
  const hops: OverrideHop[] = [];
  while (cur?.sourceLocation && hops.length < 12) {
    const usage = cur.usageLocation;
    if (!usage?.file || cur.sourceLocation.file === pageFile) return null;
    hops.push({ component: cur.sourceLocation.file, usage });
    if (usage.file === pageFile) return hops;
    let up = cur.parentKey ? byKey.get(cur.parentKey) : undefined;
    while (up && up.sourceLocation?.file !== usage.file) up = up.parentKey ? byKey.get(up.parentKey) : undefined;
    if (!up) return /^src\/pages\//.test(usage.file) ? null : [...hops, { component: usage.file, usage: { file: pageFile, line: 0, column: 0 } }];
    cur = up;
  }
  return null;
}

/** Several scanned copies on one chain (a `.map` loop): one usage tag cannot
 *  carry a per-copy value. */
export function sharedChain(elements: readonly ScanLike[], key: string, pageFile: string, hops: OverrideHop[]): boolean {
  const byKey = new Map(elements.map(e => [e.key, e]));
  const at = byKey.get(key)?.sourceLocation;
  const sig = (h: OverrideHop[] | null) => h?.map(x => `${x.component}|${x.usage.file}:${x.usage.line}:${x.usage.column}`).join('>');
  const mine = sig(hops);
  return elements.some(e => e.key !== key && !!at && e.sourceLocation?.file === at.file && e.sourceLocation.line === at.line
    && e.sourceLocation.column === at.column && sig(overrideChain(elements, e.key, pageFile, byKey)) === mine);
}

function attr(tag: string, name: string): string | null | undefined {
  const a = openingTagAttributes(tag).attributes.find((x: { name: string }) => x.name === name);
  if (!a) return undefined;
  return a.valueStart === null ? null : tag.slice(a.valueStart, a.end);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** HTML text → its characters (a JS string literal must hold the decoded value). */
const decodeEntities = (s: string) => s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);
/** A raw attribute value as a fallback expression: a quoted literal decoded, an expression parenthesised. */
const fallbackExpr = (value: string | null | undefined) => typeof value !== 'string' ? '""'
  : /^["']/.test(value) ? JSON.stringify(decodeEntities(value.slice(1, -1)))
  : /^\{[\s\S]*\}$/.test(value) ? `(${value.slice(1, -1).trim()})` : JSON.stringify(value);

/** Taken if the identifier appears anywhere in the file — a prop, a local, an import. */
function freshName(base: string, source: string): string {
  let name = base, i = 2;
  while (new RegExp(`(?:(?<![\\w$.])|Astro\\.props\\.)${name}(?![\\w$])`).test(source)) name = `${base}${i++}`;
  return name;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (s: string) => s.replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^[A-Z]/, c => c.toLowerCase());
const componentName = (file: string) => camel(file.split('/').pop()!.replace(/\.astro$/, '')) || 'part';
const FRONTMATTER = /^(\s*---\r?\n)([\s\S]*?)(\r?\n---)/;
const lineCount = (s: string) => s.split('\n').length;

/**
 * A new prop on a component: declared in a typed `Props` (`astro check` — a
 * common build script — rejects an undeclared one) and kept out of a spread
 * (`{...rest}` / `{...Astro.props}` would render it as an HTML attribute).
 * Same-line edits where possible; a file with no frontmatter gains one (the
 * caller shifts later locations by the line delta).
 */
function declareProp(source: string, name: string): string[] {
  // One step per edit region: each becomes its own identity map (a single
  // splice), so no element between two regions loses its coordinate.
  const steps: string[] = [];
  const SPREAD = /\{\s*\.\.\.\s*Astro\.props\s*\}/;
  if (SPREAD.test(source)) {
    const rest = freshName('props', source);
    while (SPREAD.test(source)) steps.push(source = source.replace(SPREAD, `{...${rest}}`));
    const line = `const { ...${rest} } = Astro.props; `;
    const fm = FRONTMATTER.exec(source);
    steps.push(source = fm ? source.slice(0, fm.index + fm[1].length) + line + source.slice(fm.index + fm[1].length) : `---\n${line.trim()}\n---\n${source}`);
  }
  const fm = FRONTMATTER.exec(source);
  if (!fm) return steps;
  const body = fm[2]
    .replace(/((?:\binterface\s+Props\b[^{]*|\btype\s+Props\s*=\s*)\{)/, `$1 ${name}?: string;`)
    .replace(/(\{)([^{}]*\.\.\.\s*[A-Za-z_$][\w$]*\s*\}\s*=\s*Astro\.props\b)/, `$1 ${name},$2`);
  steps.push(source.slice(0, fm.index) + fm[1] + body + fm[3] + source.slice(fm.index + fm[0].length));
  return steps;
}

interface ElementValue {
  prop: string | null;
  /** The master value when it is known (a literal), else null. */
  master: string | null;
  raw: string | null | undefined;
  /** Text only: content with inline markup (or already the set:html form). */
  html?: boolean;
  /** Class only: the value is a class:list expression. */
  list?: boolean;
  /** Attribute kinds: the opening tag read. */
  tag?: string;
}

/** What the element's own value reads: an existing prop, and the master value if it is a literal. */
function readElement(source: string, loc: SourceLocation, kind: OverrideKind): ElementValue {
  const name = ATTR_OF[kind];
  if (name) {
    const tag = readOpeningTag(source, loc);
    const list = kind === 'class' ? attr(tag, 'class:list') : undefined;
    if (typeof list === 'string') return { prop: parseValueForm(list)?.prop ?? null, master: null, raw: list, list: true, tag };
    const value = attr(tag, name);
    const p = typeof value === 'string' ? parseValueForm(value) : null;
    if (p) return { prop: p.prop, master: p.literal, raw: value, tag };
    const master = value === undefined || value === null ? '' : /^["']/.test(value) ? decodeEntities(value.slice(1, -1)) : null;
    return { prop: null, master, raw: value, tag };
  }
  const content = readElementContent(source, loc);
  const h = parseMarkupForm(content);
  if (h) return { prop: h.prop, master: h.markup.trim(), raw: content, html: true };
  const p = parseValueForm(content);
  if (p) return { prop: p.prop, master: p.literal, raw: content };
  if (/[{}]/.test(content)) return { prop: null, master: null, raw: content };
  return hasMarkup(content) ? { prop: null, master: content.trim(), raw: content, html: true }
    : { prop: null, master: decodeEntities(content.trim()), raw: content };
}

/** Does the element already read an override prop for `kind`? (Export guard: then the override is in the files.) */
export const readsOverrideProp = (source: string, loc: SourceLocation, kind: OverrideKind) => readElement(source, loc, kind).prop !== null;

/** Make the element's value (`at`, as read) read a prop, the master value kept as the fallback. */
async function ensureProp(source: string, loc: SourceLocation, tagName: string, kind: OverrideKind, html: boolean, at: ElementValue): Promise<{ steps: string[]; prop: string }> {
  if (at.prop) {
    if (kind === 'text' && html && !at.html) throw new Error('inline markup over a plain-text override — edit it in its component');
    return { steps: [], prop: at.prop };
  }
  const prop = freshName(`${camel(tagName.toLowerCase())}${kind === 'text' && html ? 'Html' : cap(kind)}`, source);
  const name = ATTR_OF[kind];
  let next: string;
  if (at.list) {
    // The page passes the whole class string; the list stays the master.
    next = await updateAttributeExpression(source, loc, 'class:list', valueExpr(prop, `(${(at.raw as string).slice(1, -1).trim()})`));
  } else if (name) {
    // ponytail: <img> src/alt only as plain literals — an astro:assets import or
    // a dynamic src is not editable by the editor at all (Fill refuses it too).
    if (kind !== 'class' && (!/^<img[\s/>]/.test(at.tag ?? '') || at.master === null)) throw new Error(`${kind} is not a plain <img> literal — edit it in its component`);
    next = await updateAttributeExpression(source, loc, name, valueExpr(prop, fallbackExpr(at.raw)));
  } else {
    if (at.master === null) throw new Error('text with expressions — edit it in its component');
    const raw = at.raw as string;
    const lead = /^\s*/.exec(raw)![0], trail = raw.trim() ? /\s*$/.exec(raw)![0] : '';
    const inner = html || at.html ? markupForm(prop, raw.trim()) : `{${valueExpr(prop, JSON.stringify(at.master))}}`;
    next = await updateTextContent(source, loc.file, loc, `${lead}${inner}${trail}`, undefined, true);
  }
  return { steps: [next, ...declareProp(next, prop)], prop };
}

/**
 * On the usage tag of `component` inside an intermediate file, forward `prop`
 * from that file's own props. Returns the name the next-outer usage must pass.
 */
async function threadProp(source: string, usage: SourceLocation, prop: string, component: string): Promise<{ steps: string[]; prop: string }> {
  const value = attr(readOpeningTag(source, usage), prop);
  const existing = typeof value === 'string' ? parseValueForm(value) : null;
  if (existing) return { steps: [], prop: existing.prop };
  const upstream = freshName(`${componentName(component)}${cap(prop)}`, source);
  // Nothing passed here → nothing forwarded (the component's own fallback applies).
  const fallback = typeof value === 'string' ? fallbackExpr(value) : undefined;
  const next = await updateAttributeExpression(source, usage, prop, valueExpr(upstream, fallback));
  return { steps: [next, ...declareProp(next, upstream)], prop: upstream };
}

/** The page-level value: set (string) or drop (null) the prop on the usage tag. */
async function setUsageValue(source: string, file: string, usage: SourceLocation, prop: string, value: string | null): Promise<string> {
  if (value === null) return updateAttribute(source, file, usage, prop, '');
  // Already passed (`""`, `"x"`, `{"x"}`): never respell it — a re-plan of a seeded override must be a no-op.
  const cur = attr(readOpeningTag(source, usage), prop);
  if (typeof cur === 'string') {
    const lit = /^["']/.test(cur) ? decodeEntities(cur.slice(1, -1)) : /^\{[\s\S]*\}$/.test(cur) ? literalValue(cur.slice(1, -1)) : undefined;
    if (lit === value) return source;
  }
  // ponytail: quoted when it is safe to be, else a JS string expression.
  if (value.trim() && value === value.trim() && !/["{}&<>\n]/.test(value)) return updateAttribute(source, file, usage, prop, value);
  return updateAttributeExpression(source, usage, prop, JSON.stringify(value));
}

/** Component tags in `file` whose import resolves to `component`. */
function placementsIn(source: string, file: string, component: string): SourceLocation[] {
  const fm = FRONTMATTER.exec(source);
  if (!fm) return [];
  const start = fm.index + fm[0].length;
  return [...collectImportSpecifiers(source)].filter(([, spec]) => resolveSpec(file, spec) === component)
    .flatMap(([name]) => [...source.slice(start).matchAll(new RegExp(`<${name.replace(/\$/g, '\\$')}(?=[\\s/>])`, 'g'))].map(m => {
      const before = source.slice(0, start + m.index!).split('\n');
      return { file, line: before.length, column: before[before.length - 1].length + 1 };
    }));
}
// ponytail: relative imports + the `@/`/`~/` → src/ convention; other aliases stay editor-only.
const resolveSpec = (file: string, spec: string) => /^\.\.?\//.test(spec) ? resolveImportPath(file, spec) : spec.replace(/^[@~]\//, 'src/');
const astroImports = (source: string, file: string) =>
  [...collectImportSpecifiers(source).values()].filter(spec => spec.endsWith('.astro')).map(spec => resolveSpec(file, spec));

/**
 * Where `component` sits under `page` when the scan cannot see it: the unique
 * import path page → … → component (depth ≤ 4), as hops from the component out.
 */
async function placementPath(read: (file: string) => Promise<string>, page: string, component: string): Promise<OverrideHop[]> {
  const paths: OverrideHop[][] = [];
  const walk = async (file: string, outer: OverrideHop[], depth: number): Promise<void> => {
    const source = await read(file).catch(() => '');
    const here = placementsIn(source, file, component);
    if (here.length) { for (const usage of here) paths.push([{ component, usage }, ...outer]); return; }
    if (depth === 0) return;
    for (const child of new Set(astroImports(source, file))) {
      const tags = placementsIn(source, file, child);
      if (tags.length === 1) await walk(child, [{ component: child, usage: tags[0] }, ...outer], depth - 1);
    }
  };
  await walk(page, [], 4);
  if (paths.length !== 1) throw new Error(`${component} is not placed exactly once under ${page}`);
  return paths[0];
}

const sameValue = (kind: OverrideKind, a: string, b: string) =>
  kind === 'class' ? sameTokenSet(a.split(/\s+/).filter(Boolean), b) : kind === 'text' ? a.trim() === b.trim() : a === b;

/** `identityMaps`: how element coordinates move through this change — writers
 *  that resolve a location by source version (Push) rebase through them. */
export interface PropFileChange { file: string; beforeSource: string; afterSource: string; identityMaps?: SourceIdentityMap[] }

/** One edit as a single splice (common prefix/suffix) → its identity map. */
function identityMapOf(before: string, after: string): SourceIdentityMap {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let tail = 0;
  while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  return createSourceIdentityMap(before, after, spliceSourceSpans(before.length, start, before.length - tail, after.length - start - tail));
}

/**
 * Every file change one override needs, element file → page file.
 * `value: null` drops the page prop (Reset/Push) and leaves the plumbing; a
 * value equal to the master's is the same as no override. `read` returns the
 * current bytes; `base` the bytes the scan's locations describe (they differ
 * inside one batch — a frontmatter edit shifts every later line).
 */
export async function planOverride(read: (file: string) => Promise<string | null>, hops: OverrideHop[],
  element: SourceLocation, tagName: string, kind: OverrideKind, value: string | null,
  base: (file: string) => Promise<string | null> = read): Promise<PropFileChange[]> {
  const files = new Map<string, PropFileChange & { base: string }>();
  const load = async (file: string) => {
    const known = files.get(file);
    if (known) return known.afterSource;
    const s = await read(file);
    if (s === null) throw new Error(`Source does not exist: ${file}`);
    files.set(file, { file, beforeSource: s, afterSource: s, base: base === read ? s : (await base(file)) ?? s });
    return s;
  };
  const save = (file: string, s: string) => {
    const f = files.get(file)!;
    if (s === f.afterSource) return;
    (f.identityMaps ??= []).push(identityMapOf(f.afterSource, s));
    f.afterSource = s;
  };
  // Scan locations describe `base`; our edits only add lines above the template.
  const at = (loc: SourceLocation): SourceLocation => {
    const f = files.get(loc.file);
    return f ? { ...loc, line: loc.line + lineCount(f.afterSource) - lineCount(f.base) } : loc;
  };

  const resolved: OverrideHop[] = [];
  for (const h of hops) {
    if (h.usage.line) { resolved.push(h); continue; }
    resolved.push(...await placementPath(load, h.usage.file, h.component));
  }
  hops = resolved;

  const own = readElement(await load(element.file), at(element), kind);
  const html = kind === 'text' && (!!own.html || (value !== null && hasMarkup(value)));
  // A text value is HTML element content (typed text arrives encoded): the
  // markup form takes it as is, a plain-text prop holds its characters.
  if (kind === 'text' && value !== null && !html) value = decodeInnerHtmlEntities(value);
  if (value !== null && own.master !== null && sameValue(kind, value, own.master)) value = null;
  let prop: string | null;
  if (value === null) {
    prop = own.prop;
    if (!prop) return [];
  } else {
    const r = await ensureProp(await load(element.file), at(element), tagName, kind, html, own);
    for (const step of r.steps) save(element.file, step);
    prop = r.prop;
  }
  for (let i = 0; i < hops.length - 1; i++) {
    const file = hops[i].usage.file;
    const s = await load(file);
    if (value === null) {
      const v = attr(readOpeningTag(s, at(hops[i].usage)), prop);
      const up = typeof v === 'string' ? parseValueForm(v)?.prop : undefined;
      if (!up) return [];
      prop = up;
    } else {
      const r = await threadProp(s, at(hops[i].usage), prop, hops[i].component);
      for (const step of r.steps) save(file, step);
      prop = r.prop;
    }
  }
  const last = hops[hops.length - 1].usage;
  save(last.file, await setUsageValue(await load(last.file), last.file, at(last), prop, value));
  return [...files.values()].filter(f => f.afterSource !== f.beforeSource).map(({ file, beforeSource, afterSource, identityMaps }) => ({ file, beforeSource, afterSource, identityMaps }));
}

// The scan the user is looking at — the chain is captured from it at gesture
// time (SelectionContext publishes every scan here).
let scanned: readonly (ScanLike & { tagName: string })[] = [];
export const noteScan = (elements: readonly (ScanLike & { tagName: string })[]) => { scanned = elements; };
export const latestScan = () => scanned;

// Push/Reset just dropped these page props: a scan of the not-yet-reloaded
// DOM still renders the override and must not re-seed it. Cleared per key AND
// kind by the first scan that renders the master again — an <img> renders its
// master class while its src still shows the dropped override.
const settling = new Set<string>();
export const settleOverrides = (entries: readonly { key: string; kind: string }[], on = true) => {
  for (const { key, kind } of entries) if (on) settling.add(`${kind}|${key}`); else settling.delete(`${kind}|${key}`);
};
/** True = skip seeding `kind` of `key` from this scan (its drop has not rendered yet). */
export function stillSettling(key: string, kind: string, rendersOverride: boolean): boolean {
  if (!settling.has(`${kind}|${key}`)) return false;
  if (!rendersOverride) settling.delete(`${kind}|${key}`);
  return true;
}
