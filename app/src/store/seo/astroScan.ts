/**
 * A span-exact scanner for the parts of an .astro file the SEO engine reads and
 * rewrites: the frontmatter, tags (incl. ones inside `{cond && <meta …/>}`),
 * their attributes and the props a component destructures from Astro.props.
 * Why not @astrojs/compiler: its positions are unreliable for this (no attribute
 * end offsets, wrong element ends — probed 2026-11-17 with 2.13), and every
 * write here is a byte splice that must touch nothing else.
 * Pure + sync: no window, no IO.
 */

export interface Span { start: number; end: number }

export interface Attr extends Span {
  name: string;
  kind: 'quoted' | 'expression' | 'empty' | 'spread' | 'shorthand' | 'template';
  /** Inner text: the quoted string, the expression without braces, '' for empty. */
  value: string;
}

export interface Tag {
  name: string;
  start: number;
  /** Offset just after the open tag's `>`. */
  openEnd: number;
  selfClosing: boolean;
  attrs: Attr[];
  /** `</name>` span, when the tag has one. */
  close?: Span;
  /** Index of the parent tag in the scan list (-1 = top level). */
  parent: number;
  /** Innermost `{…}` that holds this tag (a `{cond && <tag/>}` guard), if any. */
  expr?: Span;
}

export interface Frontmatter {
  /** The JS between the fences. */
  code: string;
  /** Offset of `code` in the file. */
  codeStart: number;
  /** Offset where the template starts (after the closing fence line). */
  templateStart: number;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);

export function splitFrontmatter(src: string): Frontmatter | null {
  const m = /^(\s*)---[ \t]*\r?\n/.exec(src);
  if (!m) return null;
  const codeStart = m[0].length;
  const close = /\r?\n---[ \t]*(\r?\n|$)/g;
  close.lastIndex = codeStart - 1;
  const c = close.exec(src);
  if (!c) return null;
  return { code: src.slice(codeStart, c.index), codeStart, templateStart: c.index + c[0].length };
}

/** Skip a JS string/template starting at `i` (the quote). Returns the index after it. */
export function skipString(src: string, i: number): number {
  const q = src[i];
  let j = i + 1;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '\\') { j += 2; continue; }
    if (q === '`' && ch === '$' && src[j + 1] === '{') { j = skipJs(src, j + 1); continue; }
    if (ch === q) return j + 1;
    if (q !== '`' && ch === '\n') return j; // unterminated: stop at the line end
    j++;
  }
  return j;
}

/** `src[i]` is `{`: index after the matching `}` (strings, templates, comments skipped). */
export function skipJs(src: string, i: number): number {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === '`') { j = skipString(src, j); continue; }
    if (ch === '/' && src[j + 1] === '/') { const n = src.indexOf('\n', j); j = n < 0 ? src.length : n; continue; }
    if (ch === '/' && src[j + 1] === '*') { const n = src.indexOf('*/', j + 2); j = n < 0 ? src.length : n + 2; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return j;
}

const NAME_RE = /[A-Za-z][\w$.:-]*/y; // `$` too: a component is any JS identifier (`<Blog$Card />`)
const CLOSE_RE = new RegExp(String.raw`<\/\s*(${NAME_RE.source})\s*>`, 'y');

/** Parse an open tag at `i` (`src[i] === '<'`). Null when it is not a tag. */
function parseOpenTag(src: string, i: number): Omit<Tag, 'parent' | 'expr'> | null {
  NAME_RE.lastIndex = i + 1;
  const nm = NAME_RE.exec(src);
  if (!nm) return null;
  const attrs: Attr[] = [];
  let j = NAME_RE.lastIndex;
  for (;;) {
    while (j < src.length && /\s/.test(src[j])) j++;
    if (j >= src.length) return null;
    if (src[j] === '/' && src[j + 1] === '>') return { name: nm[0], start: i, openEnd: j + 2, selfClosing: true, attrs };
    if (src[j] === '>') return { name: nm[0], start: i, openEnd: j + 1, selfClosing: false, attrs };
    const aStart = j;
    if (src[j] === '{') {
      const end = skipJs(src, j);
      const inner = src.slice(j + 1, end - 1);
      const spread = inner.trimStart().startsWith('...');
      attrs.push({ name: spread ? '' : inner.trim(), kind: spread ? 'spread' : 'shorthand', value: inner, start: aStart, end });
      j = end;
      continue;
    }
    const an = /[^\s=/>{]+/y;
    an.lastIndex = j;
    const am = an.exec(src);
    if (!am) { j++; continue; }
    const name = am[0];
    j = an.lastIndex;
    let k = j;
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] !== '=') { attrs.push({ name, kind: 'empty', value: '', start: aStart, end: j }); continue; }
    k++;
    while (k < src.length && /\s/.test(src[k])) k++;
    const q = src[k];
    if (q === '"' || q === "'") {
      const close = src.indexOf(q, k + 1);
      const end = close < 0 ? src.length : close;
      attrs.push({ name, kind: 'quoted', value: src.slice(k + 1, end), start: aStart, end: end + 1 });
      j = end + 1;
    } else if (q === '{') {
      const end = skipJs(src, k);
      attrs.push({ name, kind: 'expression', value: src.slice(k + 1, end - 1), start: aStart, end });
      j = end;
    } else if (q === '`') {
      const end = skipString(src, k);
      attrs.push({ name, kind: 'template', value: src.slice(k + 1, end - 1), start: aStart, end });
      j = end;
    } else {
      const un = /[^\s>]+/y;
      un.lastIndex = k;
      const um = un.exec(src);
      const end = um ? un.lastIndex : k;
      attrs.push({ name, kind: 'quoted', value: src.slice(k, end).replace(/\/$/, ''), start: aStart, end });
      j = end;
    }
  }
}

type Frame = { kind: 'markup'; tag: number } | { kind: 'js'; start: number; tags: number[] };

/**
 * Every tag of the template (from `from`), in document order, with parents,
 * close spans and the `{…}` guard that holds it. Tolerant: an unmatched close
 * tag pops back to the nearest open tag of that name; never throws.
 */
export function scanTags(src: string, from = 0): Tag[] {
  const tags: Tag[] = [];
  const stack: Frame[] = [{ kind: 'markup', tag: -1 }];
  const parentOf = () => { for (let s = stack.length - 1; s >= 0; s--) { const f = stack[s]; if (f.kind === 'markup') return f.tag; } return -1; };
  const exprOf = () => { for (let s = stack.length - 1; s >= 0; s--) { const f = stack[s]; if (f.kind === 'js') return f; } return undefined; };
  let i = from;
  while (i < src.length) {
    const top = stack[stack.length - 1];
    const ch = src[i];
    if (top.kind === 'js') {
      if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
      if (ch === '/' && src[i + 1] === '/') { const n = src.indexOf('\n', i); i = n < 0 ? src.length : n; continue; }
      if (ch === '/' && src[i + 1] === '*') { const n = src.indexOf('*/', i + 2); i = n < 0 ? src.length : n + 2; continue; }
      if (ch === '{') { stack.push({ kind: 'js', start: i, tags: [] }); i++; continue; }
      if (ch === '}') {
        stack.pop();
        const span = { start: top.start, end: i + 1 };
        for (const t of top.tags) tags[t].expr = span;
        i++;
        continue;
      }
      if (ch === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) { i = openTag(i); continue; }
      i++;
      continue;
    }
    // markup
    if (ch === '{') { stack.push({ kind: 'js', start: i, tags: [] }); i++; continue; }
    if (ch === '<' && src.startsWith('<!--', i)) { const n = src.indexOf('-->', i + 4); i = n < 0 ? src.length : n + 3; continue; }
    if (ch === '<' && src[i + 1] === '/') {
      const m = CLOSE_RE;
      m.lastIndex = i;
      const cm = m.exec(src);
      if (cm) {
        for (let s = stack.length - 1; s > 0; s--) {
          const f = stack[s];
          if (f.kind === 'markup' && f.tag >= 0 && tags[f.tag].name === cm[1]) {
            tags[f.tag].close = { start: i, end: m.lastIndex };
            stack.length = s;
            break;
          }
          if (f.kind === 'js') break; // a close tag never crosses an open expression
        }
        i = m.lastIndex;
        continue;
      }
    }
    if (ch === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) { i = openTag(i); continue; }
    i++;
  }
  return tags;

  function openTag(at: number): number {
    const t = parseOpenTag(src, at);
    if (!t) return at + 1;
    const js = exprOf();
    const idx = tags.push({ ...t, parent: parentOf() }) - 1;
    if (js) js.tags.push(idx);
    const lower = t.name.toLowerCase();
    if (t.selfClosing || (VOID.has(lower) && t.name === lower)) return t.openEnd;
    if (RAW.has(lower)) {
      const close = src.toLowerCase().indexOf(`</${lower}`, t.openEnd);
      if (close < 0) return src.length;
      const end = src.indexOf('>', close) + 1;
      tags[idx].close = { start: close, end };
      return end;
    }
    stack.push({ kind: 'markup', tag: idx });
    return t.openEnd;
  }
}

export function attrOf(tag: Tag, name: string): Attr | undefined {
  const lower = name.toLowerCase();
  return tag.attrs.find((a) => a.name.toLowerCase() === lower);
}

// ── Splices: every write is a byte splice ───────────────────────────────────

export type Splice = Span & { text: string };

/** Apply non-overlapping splices (positions in `src`): everything between them stays byte-for-byte. */
export function applySplices(src: string, splices: Splice[]): string {
  // Equal starts apply in the given order (stable sort): a replacement before an insert at its start.
  return [...splices].sort((a, b) => b.start - a.start).reduce((s, x) => s.slice(0, x.start) + x.text + s.slice(x.end), src);
}

/** Remove attribute `a` with the whitespace before it. */
export function removeAttr(src: string, a: Span): Splice {
  let start = a.start;
  while (start > 0 && /\s/.test(src[start - 1])) start--;
  return { start, end: a.end, text: '' };
}

// ── Frontmatter: props + local consts ───────────────────────────────────────

export interface PropEntry {
  /** The prop name (what the parent passes). */
  key: string;
  /** The local binding. */
  alias: string;
  /** Default expression text, if any. */
  defaultText?: string;
}

export interface PropsDecl {
  entries: PropEntry[];
  /** Span of the text between the destructure braces (file offsets). */
  inner: Span;
}

/** Split `text` on top-level commas (quotes/brackets aware). Returns [piece, offset]. */
export function splitTopLevel(text: string): Array<[string, number]> {
  const out: Array<[string, number]> = [];
  let depth = 0, last = 0, i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(text, i); continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (ch === ',' && depth === 0) { out.push([text.slice(last, i), last]); last = i + 1; }
    i++;
  }
  out.push([text.slice(last), last]);
  return out.filter(([p]) => p.trim() !== '');
}

/** `const { a, b = 'x', c: d } = Astro.props` — the first such destructure. */
export function readPropsDecl(src: string, fm: Frontmatter): PropsDecl | null {
  const re = /\b(?:const|let|var)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fm.code))) {
    const open = fm.codeStart + m.index + m[0].length - 1;
    const close = skipJs(src, open);
    if (!/^\s*=\s*Astro\.props\b/.test(src.slice(close, close + 40))) continue;
    const innerStart = open + 1, innerEnd = close - 1;
    const entries: PropEntry[] = [];
    for (const [piece] of splitTopLevel(src.slice(innerStart, innerEnd))) {
      const p = piece.trim();
      if (p.startsWith('...')) continue;
      const em = /^([A-Za-z_$][\w$]*)\s*(?::\s*([A-Za-z_$][\w$]*))?\s*(?:=\s*([\s\S]+))?$/.exec(p);
      if (em) entries.push({ key: em[1], alias: em[2] ?? em[1], defaultText: em[3]?.trim() });
    }
    return { entries, inner: { start: innerStart, end: innerEnd } };
  }
  return null;
}

/** Top-level `const NAME = <expr>` of the frontmatter, with the expr's span. */
export function readLocalConsts(src: string, fm: Frontmatter): Map<string, Span> {
  const out = new Map<string, Span>();
  const re = /(^|\n)[ \t]*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fm.code))) {
    const start = fm.codeStart + m.index + m[0].length;
    const end = statementEnd(src, start, fm.codeStart + fm.code.length);
    out.set(m[2], { start, end });
  }
  return out;
}

function statementEnd(src: string, i: number, limit: number): number {
  let depth = 0, j = i;
  while (j < limit) {
    const ch = src[j];
    if (ch === '"' || ch === "'" || ch === '`') { j = skipString(src, j); continue; }
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    else if (depth === 0 && ch === ';') return j;
    else if (depth === 0 && ch === '\n') {
      const before = src.slice(i, j).trimEnd();
      const after = src.slice(j + 1, limit).trimStart();
      if (!/[?:+|&,(=]$/.test(before) && !/^[?:.+|&]/.test(after)) return j;
    }
    j++;
  }
  return limit;
}

// ── JS literal helpers ──────────────────────────────────────────────────────

/** The value of a whole-string JS literal ('…', "…", `…` without ${}), else null. */
export function jsStringValue(text: string): string | null {
  const t = text.trim();
  if (t.length < 2) return null;
  const q = t[0];
  if (!(q === '"' || q === "'" || q === '`') || t[t.length - 1] !== q) return null;
  if (skipString(t, 0) !== t.length) return null;
  if (q === '`' && t.includes('${')) return null;
  const body = t.slice(1, -1);
  return body.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, e: string) => {
    if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' } as Record<string, string>)[e] ?? e;
  });
}

/** A JS string literal for `value` (double quotes, JSON escapes). */
export function jsString(value: string): string {
  return JSON.stringify(value);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Identifiers referenced by a JS expression (not property names, not inside strings). */
export function referencedIdents(expr: string): Array<{ name: string; astroProp?: string }> {
  const out: Array<{ name: string; astroProp?: string }> = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    if (ch === '"' || ch === "'") { i = skipString(expr, i); continue; }
    if (ch === '`') {
      // Walk the template, recursing into ${…}.
      let j = i + 1;
      while (j < expr.length && expr[j] !== '`') {
        if (expr[j] === '\\') { j += 2; continue; }
        if (expr[j] === '$' && expr[j + 1] === '{') { const end = skipJs(expr, j + 1); out.push(...referencedIdents(expr.slice(j + 2, end - 1))); j = end; continue; }
        j++;
      }
      i = j + 1;
      continue;
    }
    const m = /[A-Za-z_$][\w$]*/y;
    m.lastIndex = i;
    const im = m.exec(expr);
    if (im) {
      const prev = expr.slice(0, i).trimEnd();
      if (!prev.endsWith('.') || prev.endsWith('...')) {
        const rest = /^\.props\.([A-Za-z_$][\w$]*)/.exec(expr.slice(m.lastIndex));
        if (im[0] === 'Astro' && rest) { out.push({ name: 'Astro', astroProp: rest[1] }); i = m.lastIndex + rest[0].length; continue; }
        out.push({ name: im[0] });
      }
      i = m.lastIndex;
      continue;
    }
    i++;
  }
  return out;
}
