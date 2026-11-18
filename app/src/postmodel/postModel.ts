/**
 * PostDoc — the parent-owned model of an MDX post body.
 *
 * Lossless contract (binding law #1): parse→serialize of an untouched document
 * is byte-identical — corpus test in __tests__/roundtrip.test.ts. Every block
 * keeps its verbatim source slice (via mdast position offsets) plus the exact
 * inter-block gap; only blocks explicitly marked dirty are re-stringified.
 * Constructs the editor does not model (ESM, expressions, fences, raw HTML,
 * comments, footnote definitions, ref definitions, tables, …) are opaque
 * passthrough blocks that serialize back verbatim. The DOM never reconstructs
 * source (law #4) — this module is the only text producer.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkStringify from 'remark-stringify';
import type { Root, RootContent } from 'mdast';
import type { MdxJsxFlowElement, MdxJsxAttribute } from 'mdast-util-mdx-jsx';
import type { StackDirection, StackRatio, StackWidth } from '@/core/stack/stackClasses';

export type EditableKind = 'paragraph' | 'heading' | 'blockquote' | 'list';

export type PostBlock =
  | {
      kind: EditableKind;
      mdast: RootContent;
      /** verbatim original slice — emitted as-is while !dirty */
      source: string;
      dirty: boolean;
      /** exact source text between the previous block and this one (leading text for block 0) */
      gapBefore: string;
    }
  | {
      kind: 'component';
      name: string;
      /** verbatim slice of the component element itself (inner element when span-wrapped) */
      source: string;
      /** 4..12 columns, 'full' = edge-to-edge bleed, null = the default measure */
      span: number | 'full' | null;
      /** verbatim full slice including a col-span wrapper, if any — emitted while !dirty */
      raw: string;
      dirty: boolean;
      gapBefore: string;
    }
  | {
      kind: 'passthrough';
      source: string;
      gapBefore: string;
      /** original mdast node type (e.g. 'mdxjsEsm') — used for import grouping */
      nodeType: string;
      /** What the writing view DRAWS for a code block / table (from this parse — never re-parsed); `source` stays the bytes. */
      display?: PassthroughDisplay;
    }
  | StackBlock;

export type PassthroughDisplay = { code: string } | { rows: string[][] };

/** Plain text of an mdast subtree (inline marks dropped). */
function mdastText(node: RootContent): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  return 'children' in node ? (node.children as RootContent[]).map(mdastText).join('') : '';
}

function passthroughDisplay(node: RootContent): PassthroughDisplay | undefined {
  if (node.type === 'code') return { code: node.value };
  if (node.type === 'table') return { rows: node.children.map(row => row.children.map(mdastText)) };
  return undefined;
}

/**
 * Editorial layouts (task-242): a `<Stack>` bound to OUR component. Children
 * are ordinary blocks whose gaps are relative to the previous sibling (the
 * first child's gap follows the open tag / slot `<div>`), so an untouched
 * stack re-concatenates to its exact source. `dirty` = attrs/direction
 * changed → head/between/tail are regenerated; children keep their bytes.
 */
export interface StackBlock {
  kind: 'stack';
  /** the local JSX name (the import binding — `Stack` unless renamed) */
  name: string;
  direction: StackDirection;
  attrs: StackAttrs;
  /** column: [blocks]; row: [slot0, slot1] */
  slots: PostBlock[][];
  /** verbatim: open tag (row: + `\n<div>`) up to the first child's gap */
  head: string;
  /** row only: slot0's end up to slot1's first gap (`\n\n</div>\n<div>`) */
  between: string;
  /** verbatim: after the last child up to the close tag's end */
  tail: string;
  dirty: boolean;
  gapBefore: string;
}

export type { StackDirection };
export interface StackAttrs {
  ratio?: StackRatio;
  width?: StackWidth;
  class?: string;
  text?: string;
}

export interface PostDoc {
  blocks: PostBlock[];
  eol: '\n' | '\r\n';
  /** verbatim source after the last block (usually '\n' or '') */
  trailing: string;
}

const mdxParser = unified()
  .use(remarkParse)
  .use(remarkMdx)
  .use(remarkGfm)
  .use(remarkFrontmatter);

// .md files: raw HTML is legal there (`<br>` would be an unclosed-JSX parse
// error under remark-mdx), so they parse without the MDX extensions and HTML
// becomes passthrough blocks.
const mdParser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter);

export type PostFormat = 'mdx' | 'md';

const stringifier = unified()
  .use(remarkStringify, {
    bullet: '-',
    rule: '-',
    emphasis: '*',
    strong: '*',
    // hard breaks stay the two-trailing-spaces form users wrote (finding: hardbreak corruption)
    handlers: { break: () => '  \n' },
  })
  .use(remarkMdx)
  .use(remarkGfm);

const EDITABLE_KINDS: Record<string, EditableKind> = {
  paragraph: 'paragraph',
  heading: 'heading',
  blockquote: 'blockquote',
  list: 'list',
};

function classAttr(node: MdxJsxFlowElement): string | null {
  for (const attr of node.attributes) {
    if (attr.type === 'mdxJsxAttribute' && (attr.name === 'class' || attr.name === 'className')) {
      return typeof attr.value === 'string' ? attr.value : null;
    }
  }
  return null;
}

/** `<div class="col-span-N">` wrapping exactly one component element → that element + N */
function unwrapColSpan(
  node: MdxJsxFlowElement,
): { inner: MdxJsxFlowElement; span: number | 'full' } | null {
  if (node.name !== 'div') return null;
  const cls = classAttr(node);
  const m = cls && /^col-span-(\d+|full)$/.exec(cls);
  if (!m) return null;
  const kids = node.children.filter(
    (c) => !(c.type === 'paragraph' && c.children.length === 0),
  );
  if (kids.length !== 1 || kids[0].type !== 'mdxJsxFlowElement' || kids[0].name === null) return null;
  return { inner: kids[0] as MdxJsxFlowElement, span: m[1] === 'full' ? 'full' : Number(m[1]) };
}

function slice(src: string, node: { position?: { start: { offset?: number }; end: { offset?: number } } }): string {
  return src.slice(node.position!.start.offset!, node.position!.end.offset!);
}

const STACK_IMPORT = /(^|\/)components\/sq\/Stack\.astro$/;
const STACK_VALUES: Record<string, readonly string[] | null> = {
  direction: ['column', 'row'],
  ratio: ['1:1', '2:1', '1:2'],
  width: ['reading', 'wide', 'edge'],
  class: null,
  text: null,
};

/** End offset of a JSX element's OPEN tag (quote-aware: class values hold `>`). */
function openTagEnd(text: string, start: number): number {
  let quote = '';
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = ''; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return i + 1;
  }
  return text.length;
}

/** String-literal attrs from the known set, else null (P6: passthrough). */
function stackAttrs(el: MdxJsxFlowElement): { direction: StackDirection; attrs: StackAttrs } | null {
  const out: Record<string, string> = {};
  for (const a of el.attributes) {
    if (a.type !== 'mdxJsxAttribute' || typeof a.value !== 'string' || !(a.name in STACK_VALUES)) return null;
    const allowed = STACK_VALUES[a.name];
    if (allowed && !allowed.includes(a.value)) return null;
    out[a.name] = a.value;
  }
  const { direction = 'column', ...attrs } = out;
  return { direction: direction as StackDirection, attrs: attrs as StackAttrs };
}

interface ParseCtx {
  text: string;
  /** local names bound to OUR Stack.astro */
  stackNames: Set<string>;
}

/**
 * Which stacks may appear among these siblings (D3: one level — a row inside
 * a column; anything else nested stays passthrough, P6).
 */
type StackRoom = 'any' | 'row' | 'none';

/**
 * Classify sibling mdast nodes into blocks. `cursor` = where the first node's
 * gap starts; returns the blocks and the offset after the last node.
 */
function classifyNodes(nodes: RootContent[], ctx: ParseCtx, cursor: number, room: StackRoom): { blocks: PostBlock[]; end: number } {
  const { text } = ctx;
  const blocks: PostBlock[] = [];
  for (const node of nodes) {
    const start = node.position!.start.offset!;
    const end = node.position!.end.offset!;
    const gapBefore = text.slice(cursor, start);
    const source = text.slice(start, end);
    cursor = end;

    // MDX reads `<div>x</div>` on ONE line as a paragraph of inline JSX. A paragraph
    // made only of HTML elements is the writer's own markup (Custom code), not prose.
    if (isHtmlOnlyParagraph(node)) {
      blocks.push({ kind: 'passthrough', source, gapBefore, nodeType: 'mdxJsxFlowElement' });
      continue;
    }
    const editable = EDITABLE_KINDS[node.type];
    if (editable) {
      blocks.push({ kind: editable, mdast: node, source, dirty: false, gapBefore });
      continue;
    }
    if (node.type === 'mdxJsxFlowElement') {
      const el = node as MdxJsxFlowElement;
      if (el.name && ctx.stackNames.has(el.name)) {
        const stack = parseStack(el, ctx, room, gapBefore);
        if (stack) { blocks.push(stack); continue; }
        blocks.push({ kind: 'passthrough', source, gapBefore, nodeType: node.type });
        continue;
      }
      if (el.name && /^[A-Z]/.test(el.name)) {
        blocks.push({ kind: 'component', name: el.name, source, span: null, raw: source, dirty: false, gapBefore });
        continue;
      }
      const wrapped = unwrapColSpan(el);
      if (wrapped) {
        blocks.push({
          kind: 'component',
          name: wrapped.inner.name!,
          source: slice(text, wrapped.inner),
          span: wrapped.span,
          raw: source,
          dirty: false,
          gapBefore,
        });
        continue;
      }
    }
    const display = passthroughDisplay(node);
    blocks.push({ kind: 'passthrough', source, gapBefore, nodeType: node.type, ...(display ? { display } : {}) });
  }
  return { blocks, end: cursor };
}

/** Only lowercase (HTML) names: a capitalised element is a component, handled as one. */
function isHtmlOnlyParagraph(node: RootContent): boolean {
  if (node.type !== 'paragraph') return false;
  let elements = 0;
  for (const child of node.children) {
    if (child.type === 'mdxJsxTextElement' && child.name && /^[a-z]/.test(child.name)) elements++;
    else if (!(child.type === 'text' && child.value.trim() === '')) return false;
  }
  return elements > 0;
}

function parseStack(el: MdxJsxFlowElement, ctx: ParseCtx, room: StackRoom, gapBefore: string): StackBlock | null {
  const parsed = stackAttrs(el);
  if (!parsed) return null;
  const { direction, attrs } = parsed;
  if (room === 'none' || (room === 'row' && direction !== 'row')) return null;
  const inner: StackRoom = direction === 'column' && room === 'any' ? 'row' : 'none';
  const { text } = ctx;
  const elStart = el.position!.start.offset!;
  const elEnd = el.position!.end.offset!;
  const open = openTagEnd(text, elStart);
  const kids = el.children as RootContent[];
  if (direction === 'column') {
    const { blocks, end } = classifyNodes(kids, ctx, open, inner);
    return { kind: 'stack', name: el.name!, direction, attrs, slots: [blocks], head: text.slice(elStart, open), between: '', tail: text.slice(end, elEnd), dirty: false, gapBefore };
  }
  const divs = kids as MdxJsxFlowElement[];
  if (divs.length !== 2 || divs.some(d => d.type !== 'mdxJsxFlowElement' || d.name !== 'div' || d.attributes.length > 0)) return null;
  const slotParts = divs.map(d => {
    const dOpen = openTagEnd(text, d.position!.start.offset!);
    return classifyNodes(d.children as RootContent[], ctx, dOpen, inner);
  });
  const open0 = openTagEnd(text, divs[0].position!.start.offset!);
  const open1 = openTagEnd(text, divs[1].position!.start.offset!);
  return {
    kind: 'stack', name: el.name!, direction, attrs,
    slots: slotParts.map(p => p.blocks),
    head: text.slice(elStart, open0),
    between: text.slice(slotParts[0].blocks.length ? slotParts[0].end : open0, open1),
    tail: text.slice(slotParts[1].blocks.length ? slotParts[1].end : open1, elEnd),
    dirty: false,
    gapBefore,
  };
}

export function parsePostBody(src: string, format: PostFormat = 'mdx'): PostDoc {
  const eol: '\n' | '\r\n' = src.includes('\r\n') ? '\r\n' : '\n';
  const text = eol === '\r\n' ? src.replace(/\r\n/g, '\n') : src;
  const root = (format === 'mdx' ? mdxParser : mdParser).parse(text) as Root;

  const stackNames = new Set(
    root.children
      .filter(n => n.type === 'mdxjsEsm')
      .flatMap(n => esmBindings(slice(text, n)))
      .filter(b => b.isDefault && STACK_IMPORT.test(b.source))
      .map(b => b.local),
  );
  const { blocks, end } = classifyNodes(root.children, { text, stackNames }, 0, 'any');
  return {
    blocks,
    eol,
    trailing: text.slice(end),
  };
}

/** Stringify ONE mdast block node (used only for dirty blocks). */
export function stringifyBlockMdast(node: RootContent): string {
  const out = stringifier.stringify({ type: 'root', children: [node] } as Root);
  return out.replace(/\n$/, '');
}

function indent(source: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return source
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

function componentText(block: Extract<PostBlock, { kind: 'component' }>): string {
  if (!block.dirty) return block.raw;
  if (block.span === null) return block.source;
  return `<div class="col-span-${block.span}">\n${indent(block.source, 2)}\n</div>`;
}

/** Attribute string in canonical order; defaults omitted. */
export function stackAttrString(direction: StackDirection, attrs: StackAttrs): string {
  const parts: string[] = [];
  if (direction === 'row') parts.push('direction="row"');
  if (direction === 'row' && attrs.ratio && attrs.ratio !== '1:1') parts.push(`ratio="${attrs.ratio}"`);
  if (attrs.width && attrs.width !== 'reading') parts.push(`width="${attrs.width}"`);
  if (attrs.class) parts.push(`class="${attrs.class}"`);
  if (attrs.text) parts.push(`text="${attrs.text}"`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/** Regenerated tags for a dirty stack. */
function stackFrame(b: StackBlock): { head: string; between: string; tail: string } {
  const open = `<${b.name}${stackAttrString(b.direction, b.attrs)}>`;
  return b.direction === 'row'
    ? { head: `${open}\n<div>`, between: '\n\n</div>\n<div>', tail: `\n\n</div>\n</${b.name}>` }
    : { head: open, between: '', tail: `\n\n</${b.name}>` };
}

/** First child of a regenerated section always sits after a blank line. */
function childrenText(blocks: PostBlock[], forceFirstGap: boolean): string {
  return blocks.map((b, i) => (i === 0 && forceFirstGap ? '\n\n' : b.gapBefore) + blockText(b)).join('');
}

function stackText(b: StackBlock): string {
  const frame = b.dirty ? stackFrame(b) : b;
  if (b.direction === 'column') return frame.head + childrenText(b.slots[0] ?? [], b.dirty) + frame.tail;
  return frame.head + childrenText(b.slots[0] ?? [], b.dirty) + frame.between + childrenText(b.slots[1] ?? [], b.dirty) + frame.tail;
}

/** One block's own text (no gap). */
export function blockText(block: PostBlock): string {
  if (block.kind === 'passthrough') return block.source;
  if (block.kind === 'component') return componentText(block);
  if (block.kind === 'stack') return stackText(block);
  return block.dirty ? stringifyBlockMdast(block.mdast) : block.source;
}

/**
 * Visit every block (depth-first, document order — the same order ProseMirror
 * walks descendants) with the 1-based body line it starts on, measured over
 * the exact pieces the serializer emits.
 */
export function walkBlockLines(doc: PostDoc, visit: (block: PostBlock, line: number, endLine: number) => boolean | void): void {
  const nl = (t: string) => { let n = 0; for (let i = 0; i < t.length; i++) if (t[i] === '\n') n++; return n; };
  let line = 1;
  let stopped = false;
  /** a visitor returning true stops the walk; a stack is visited after its children (its end is known then) */
  const walk = (blocks: PostBlock[], forceFirstGap: boolean) => {
    for (let i = 0; i < blocks.length && !stopped; i++) {
      const b = blocks[i];
      line += nl(i === 0 && forceFirstGap ? '\n\n' : b.gapBefore);
      const start = line;
      if (b.kind !== 'stack') {
        line += nl(blockText(b));
        if (visit(b, start, line)) stopped = true;
        continue;
      }
      const f = b.dirty ? stackFrame(b) : b;
      line += nl(f.head);
      walk(b.slots[0] ?? [], b.dirty);
      if (b.direction === 'row') { line += nl(f.between); walk(b.slots[1] ?? [], b.dirty); }
      line += nl(f.tail);
      if (!stopped && visit(b, start, line)) stopped = true;
    }
  };
  walk(doc.blocks, false);
}

export function serializePostDoc(doc: PostDoc): string {
  let out = '';
  for (const block of doc.blocks) out += block.gapBefore + blockText(block);
  out += doc.trailing;
  return doc.eol === '\r\n' ? out.replace(/\n/g, '\r\n') : out;
}

/**
 * Insert a block; gap bookkeeping keeps the blank-line invariant (draft-merge finding).
 * ponytail: ESM-adjacent single-\n grouping lands with import insertion (Task 7).
 */
export function insertBlock(doc: PostDoc, index: number, block: PostBlock): PostDoc {
  const blocks = doc.blocks.slice();
  const b = { ...block } as PostBlock;
  if (blocks.length === 0) {
    b.gapBefore = '';
  } else if (index === 0) {
    b.gapBefore = blocks[0].gapBefore;
    blocks[0] = { ...blocks[0], gapBefore: '\n\n' };
  } else {
    b.gapBefore = '\n\n';
  }
  blocks.splice(index, 0, b);
  const trailing = doc.blocks.length === 0 && doc.trailing === '' ? '\n' : doc.trailing;
  return { ...doc, blocks, trailing };
}

export interface ComponentInsertSpec {
  /** preferred local name; the actual binding may differ (collision / reuse) */
  name: string;
  importPath: string;
  markup: (localName: string) => string;
}

export interface EsmBinding {
  local: string;
  source: string;
  isDefault: boolean;
}

/** Real bindings of an ESM passthrough block — via mdast/estree, never regex,
 *  so fences and prose mentions can neither fool nor collide (findings 7/8). */
function esmBindings(source: string): EsmBinding[] {
  try {
    const root = mdxParser.parse(source) as Root;
    const out: EsmBinding[] = [];
    for (const child of root.children) {
      if (child.type !== 'mdxjsEsm') continue;
      const program = (child as { data?: { estree?: { body?: unknown[] } } }).data?.estree;
      for (const stmt of program?.body ?? []) {
        const s = stmt as {
          type: string;
          source?: { value?: unknown };
          specifiers?: Array<{ type: string; local?: { name?: string } }>;
        };
        if (s.type !== 'ImportDeclaration') continue;
        for (const spec of s.specifiers ?? []) {
          out.push({
            local: spec.local?.name ?? '',
            source: String(s.source?.value ?? ''),
            isDefault: spec.type === 'ImportDefaultSpecifier',
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** An ESM (import/export) passthrough block. */
export const isEsmBlock = (b: PostBlock): boolean => b.kind === 'passthrough' && b.nodeType === 'mdxjsEsm';

/** Every import binding across the doc's ESM passthrough blocks. */
export function docEsmBindings(doc: PostDoc): EsmBinding[] {
  return doc.blocks
    .filter(isEsmBlock)
    .flatMap(b => esmBindings((b as { source: string }).source));
}

/**
 * Add one import line as an ESM passthrough: right after the last ESM block,
 * or at the top of the body. Returns the index it landed at.
 */
export function insertImportBlock(doc: PostDoc, line: string): { doc: PostDoc; at: number } {
  const blocks = doc.blocks.slice();
  const importBlock: PostBlock = {
    kind: 'passthrough',
    source: line,
    nodeType: 'mdxjsEsm',
    gapBefore: '\n', // beside its ESM neighbor
  };
  let lastEsm = -1;
  blocks.forEach((b, i) => { if (isEsmBlock(b)) lastEsm = i; });
  let at: number;
  if (lastEsm >= 0) {
    at = lastEsm + 1;
    blocks.splice(at, 0, importBlock);
  } else {
    // top of the body. The block that used to be first keeps a BLANK line
    // under the import — MDX's greedy ESM parsing eats a directly-adjacent
    // prose line and the post stops compiling (owner incident, 2026-08-09).
    importBlock.gapBefore = blocks[0]?.gapBefore ?? '';
    if (blocks[0]) blocks[0] = { ...blocks[0], gapBefore: '\n\n' };
    blocks.splice(0, 0, importBlock);
    at = 0;
  }
  return { doc: { ...doc, blocks }, at };
}

/** Bind `name` from `importPath`: reuse an existing default import of that
 *  path, else add one (a taken name → Name1, …). `at` = where it landed. */
export function bindImport(doc: PostDoc, name: string, importPath: string): { doc: PostDoc; localName: string; at: number | null } {
  const bindings = docEsmBindings(doc);
  const existing = bindings.find(b => b.source === importPath && b.isDefault);
  if (existing) return { doc, localName: existing.local, at: null };
  const taken = new Set(bindings.map(b => b.local));
  let localName = name;
  for (let n = 1; taken.has(localName); n++) localName = `${name}${n}`;
  const r = insertImportBlock(doc, `import ${localName} from '${importPath}';`);
  return { doc: r.doc, localName, at: r.at };
}

/**
 * Insert a component block at `index`, import included. The import rides as an
 * ESM passthrough grouped with existing imports (never above frontmatter —
 * the doc IS the body — and never inside prose); the same module path already
 * imported → its local name is reused; a taken name → Name1, Name2, …
 */
export function insertComponent(
  doc: PostDoc,
  index: number,
  spec: ComponentInsertSpec,
): { doc: PostDoc; localName: string } {
  const bound = bindImport(doc, spec.name, spec.importPath);
  const { localName } = bound;
  const blocks = bound.doc.blocks;
  const componentIndex = index + (bound.at !== null && bound.at <= index ? 1 : 0);

  const withImport: PostDoc = {
    ...doc,
    blocks,
    trailing: doc.blocks.length === 0 && doc.trailing === '' ? '\n' : doc.trailing,
  };
  const componentBlock: PostBlock = {
    kind: 'component',
    name: localName,
    source: spec.markup(localName),
    span: null,
    raw: '',
    dirty: true,
    gapBefore: '\n\n',
  };
  return { doc: insertBlock(withImport, componentIndex, componentBlock), localName };
}

/** Names of all component blocks in a doc. */
export function componentNames(doc: PostDoc): Set<string> {
  const names = new Set<string>();
  const walk = (blocks: PostBlock[]) => {
    for (const b of blocks) {
      if (b.kind === 'component') names.add(b.name);
      if (b.kind === 'stack') { names.add(b.name); b.slots.forEach(walk); }
    }
  };
  walk(doc.blocks);
  return names;
}

/** True when a single source line is exactly one import declaration whose
 *  local bindings are all in `names` — the only lines GC may drop. */
function isImportLineOf(line: string, names: Set<string>): boolean {
  const m = /^\s*import\s+(.+?)\s+from\s+['"][^'"]+['"];?\s*$/.exec(line);
  if (!m) return false;
  const clause = m[1];
  const locals: string[] = [];
  const defaultMatch = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(clause);
  if (defaultMatch) locals.push(defaultMatch[1]);
  const named = /\{([^}]*)\}/.exec(clause);
  if (named) {
    for (const part of named[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) locals.push(name);
    }
  }
  return locals.length > 0 && locals.every(l => names.has(l));
}

/**
 * Drop import lines whose binding was a component REMOVED from the doc and is
 * no longer referenced by any non-ESM block. Conservative on purpose: only
 * whole lines importing solely removed names go; a name that still appears
 * anywhere (a fence, a comment, prose) keeps its import. Never touches an
 * untouched doc (empty `removed` = identity), so round-trip byte-identity holds.
 */
export function gcUnusedImports(doc: PostDoc, original: PostDoc): PostDoc {
  const present = componentNames(doc);
  const removed = [...componentNames(original)].filter(n => !present.has(n));
  if (removed.length === 0) return doc;

  const body = doc.blocks.filter(b => !isEsmBlock(b)).map(b => (b.kind === 'component' ? b.source : blockText(b))).join('\n');
  const stillReferenced = (name: string): boolean => new RegExp(`\\b${name}\\b`).test(body);

  const dead = new Set(removed.filter(n => !stillReferenced(n)));
  if (dead.size === 0) return doc;

  const blocks: PostBlock[] = [];
  for (const b of doc.blocks) {
    if (b.kind !== 'passthrough' || b.nodeType !== 'mdxjsEsm') {
      blocks.push(b);
      continue;
    }
    const kept = b.source.split('\n').filter(line => !isImportLineOf(line, dead));
    if (kept.length === 0) continue; // whole ESM block was dead imports
    blocks.push(kept.length === b.source.split('\n').length ? b : { ...b, source: kept.join('\n') });
  }
  return { ...doc, blocks };
}

export function makeParagraphBlock(textValue: string): PostBlock {
  return {
    kind: 'paragraph',
    mdast: { type: 'paragraph', children: [{ type: 'text', value: textValue }] },
    source: '',
    dirty: true,
    gapBefore: '\n\n',
  };
}
