/**
 * Inline a layout's whole Astro document into a file that imported it.
 *
 * Files are truth — the page file IS the page — so deleting a
 * layout must leave every importer standing on its own: the layout's
 * frontmatter, <head> and body move in, the page's children land at the slot,
 * and the import goes away. A bare <div> swap would strip the stylesheet, the
 * <title> and the bridge script, which is why this module exists.
 *
 * PLAIN JS and in the plugin dir on purpose: `/__sq/local/layout-plan`
 * (inline-delete) is served by the shared route table (sq-project-fs-routes.js),
 * which runs inside the instance's `astro dev` — it gets only the plugin dir's
 * `.js` files (desktop/src/instance.mjs SQ_FILES). This is the ONLY copy of
 * the transform.
 *
 * Every function here is PURE and byte-preserving: child source is spliced
 * verbatim, because re-indenting a restore is the task-133 data-loss lesson.
 *
 * Design: docs/plans/2026-08-25-delete-layout-design.md §4.
 */
import * as path from 'node:path';
import { findTagStart, applyByteEdits } from './sq-source-bytes.js';
import { SLOT_TAG_RE, slotParts } from './sq-slot-markup.js';

const FENCE_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function splitFrontmatter(source) {
  const m = source.match(FENCE_RE);
  if (!m) return { frontmatter: '', template: source };
  return { frontmatter: m[1], template: source.slice(m[0].length) };
}

/**
 * Re-point relative specifiers from `fromDir` to `toDir` (both project-relative).
 *
 * MANDATORY, not optional: a layout at src/layouts importing '../styles/global.css'
 * becomes '../../styles/global.css' inside src/pages/blog/index.astro. Skipping
 * it silently breaks CSS and component imports on any nested page (C9).
 *
 * Bare and aliased specifiers ('astro:content', '@lib/y') are left alone — they
 * do not resolve by depth.
 */
export function rewriteRelativeImports(frontmatter, fromDir, toDir) {
  return frontmatter.replace(/(['"])(\.[^'"]*)\1/g, (_full, quote, spec) => {
    const abs = path.posix.normalize(path.posix.join(fromDir, spec));
    let next = path.posix.relative(toDir, abs);
    if (!next.startsWith('.')) next = `./${next}`;
    return `${quote}${next}${quote}`;
  });
}

/**
 * The call site's attributes as the body of an object literal.
 *
 * Reads the AST's OWN parse rather than re-scanning the source: the component
 * node already carries `{kind, name, value}` per attribute, so there is no
 * second attribute grammar to keep in step. Confirmed against the pinned
 * compiler — `spread` reports `name: 'rest'` for `{...rest}` and `shorthand`
 * reports `name: 'title'` for `{title}`, so nothing needs the raw text.
 *
 *   title="About"  → title: "About"      (quoted)
 *   n={1+2}        → n: (1+2)            (expression)
 *   flag           → flag: true          (empty)
 *   {...rest}      → ...rest             (spread)
 *   {title}        → title               (shorthand)
 *   tpl={`hi`}     → tpl: `hi`           (template-literal)
 *
 * A non-identifier name (`data-x`) is quoted, or the literal would not parse.
 */
export function attrsToLiteralBody(attrs) {
  const key = (n) => (/^[A-Za-z_$][\w$]*$/.test(n) ? n : JSON.stringify(n));
  return attrs.map((a) => {
    switch (a.kind) {
      case 'spread': return `...${a.value || a.name}`;
      case 'shorthand': return a.value || a.name;
      case 'expression': return `${key(a.name)}: (${a.value})`;
      case 'template-literal': return `${key(a.name)}: \`${a.value}\``;
      case 'empty': return `${key(a.name)}: true`;
      default: return `${key(a.name)}: ${JSON.stringify(a.value)}`;
    }
  }).join(', ');
}

/**
 * Replace every `Astro.props` with the call site's props as an object literal.
 *
 * One substitution, and defaults, renames and destructuring all keep working
 * without per-prop analysis:
 *
 *   const { title = 'L1' } = Astro.props;  →  const { title = 'L1' } = { title: "About" };
 *
 * Takes the finished literal (not the attributes) because the caller applies it
 * to BOTH the frontmatter and the template — building it once is the point.
 */
export function materializeProps(source, literal) {
  // `Astro.props.x` must keep working, so parenthesise before the member access.
  return source
    .replace(/Astro\.props(?=\s*\.)/g, `(${literal})`)
    .replace(/Astro\.props/g, literal);
}

/** Drop a child's own `slot="…"` attribute — it named the target, and the
 *  target is gone once the child is spliced in (C8). */
function stripSlotAttribute(source, onRemove) {
  return source.replace(/^(\s*<[A-Za-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?>)/, (_f, open, attrs, close) => {
    const next = attrs.replace(/\s+slot\s*=\s*("[^"]*"|'[^']*'|\{[^}]*\})/, (match, _value, offset) => {
      const start = Buffer.byteLength(open + attrs.slice(0, offset), 'utf8');
      onRemove?.(start, start + Buffer.byteLength(match, 'utf8'));
      return '';
    });
    return `${open}${next}${close}`;
  });
}

/**
 * Splice children into their matching <slot>, dropping the `slot=` attribute.
 *
 * Children with `slot="header"` go to `<slot name="header">`, the rest to the
 * default `<slot>`. An unfilled slot keeps the layout's own fallback content
 * (C6). Bytes are copied verbatim — no re-indent.
 */
export function spliceChildrenBySlot(template, children, preserved = []) {
  const bySlot = new Map();
  for (const c of children) {
    const key = c.slot.trim();
    const list = bySlot.get(key) ?? [];
    list.push(c);
    bySlot.set(key, list);
  }
  let byteDelta = 0;
  return template.replace(SLOT_TAG_RE, (full, attrsSelf, attrsOpen, inner, offset) => {
    const { name } = slotParts(attrsSelf, attrsOpen);
    const filling = bySlot.get(name);
    // Unfilled: the layout's own fallback stands in (a self-closing slot has none).
    let output = '';
    if (!filling || filling.length === 0) output = inner ?? '';
    else for (const child of filling) {
      const start = Buffer.byteLength(template.slice(0, offset), 'utf8') + byteDelta + Buffer.byteLength(output, 'utf8');
      let removal;
      const source = stripSlotAttribute(child.source, (from, to) => { removal = { from, to }; });
      const kept = removal ? [[0, removal.from], [removal.to, Buffer.byteLength(child.source, 'utf8')]] : [[0, Buffer.byteLength(child.source, 'utf8')]];
      for (const region of child.regions ?? []) for (const [from, to] of kept) {
        const a = Math.max(region.afterStart, from), b = Math.min(region.afterStart + region.length, to);
        if (a < b) preserved.push({ beforeStart: region.beforeStart + a - region.afterStart,
          afterStart: start + a - (removal && a >= removal.to ? removal.to - removal.from : 0), length: b - a });
      }
      output += source;
    }
    byteDelta += Buffer.byteLength(output, 'utf8') - Buffer.byteLength(full, 'utf8');
    return output;
  });
}

// ── The transform ───────────────────────────────────────────────────────

const GT = 0x3e; // '>'
const SLASH = 0x2f; // '/'

/**
 * Byte span of one component invocation, in `Buffer` space.
 *
 * `position.start.offset` is a UTF-8 BYTE offset that can point at the tag NAME
 * instead of `<`, and a SELF-CLOSING node carries NO `position.end` at all —
 * both confirmed against the pinned @astrojs/compiler. So the `<` comes from
 * {@link findTagStart} (which fails closed) and a self-closing end is scanned
 * for rather than read.
 */
function usageSpan(buf, node) {
  const tagStart = findTagStart(buf, node.position.start.offset, node.name);
  if (tagStart == null) return null;

  // Walk the open tag to its `>`, honouring quotes and {expression} braces so a
  // `>` inside either does not end it early.
  let i = tagStart + 1 + Buffer.byteLength(node.name, 'utf8');
  let quote = 0;
  let depth = 0;
  for (; i < buf.length; i += 1) {
    const b = buf[i];
    if (quote) { if (b === quote) quote = 0; continue; }
    if (b === 0x22 || b === 0x27 || b === 0x60) { quote = b; continue; }
    if (b === 0x7b) { depth += 1; continue; }
    if (b === 0x7d) { depth -= 1; continue; }
    if (b === GT && depth === 0) break;
  }
  if (i >= buf.length) return null;
  const gt = i;
  const selfClosing = buf[gt - 1] === SLASH;

  // A paired node reports its own end (past `</Name>`); a self-closing one stops
  // at the `>`.
  const end = selfClosing ? gt + 1 : node.position.end?.offset ?? gt + 1;
  return { tagStart, childrenStart: gt + 1, end, selfClosing };
}

/** Drop the `import X from '<layoutRel-ish>'` line from a frontmatter. */
function dropLayoutImport(frontmatter, layoutName) {
  return frontmatter.replace(
    new RegExp(`^[ \\t]*import\\s+${layoutName}\\s+from\\s+['"][^'"]+\\.astro['"];?[ \\t]*\\r?\\n?`, 'm'),
    '',
  );
}

/** Byte length of the source's leading `---…---` block (0 when it has none). */
function fenceByteLength(source) {
  return Buffer.byteLength(source.match(FENCE_RE)?.[0] ?? '', 'utf8');
}

/** A frontmatter body as a fence — empty body means the file gets none at all. */
function fence(body) {
  const trimmed = body.trim();
  return trimmed ? `---\n${trimmed}\n---\n` : '';
}

/**
 * The layout's whole document, inlined into one importer.
 *
 * Composes the pure helpers in the design's §4 order: split both files → locate
 * the usage → refuse on more than one (C7) → rewrite the layout's relative
 * imports for the importer's directory (C9) → materialize props from the call
 * site → splice children by slot (C8) → merge frontmatter minus the layout
 * import.
 *
 * The usage span is REPLACED in place rather than the whole template swapped,
 * so anything the importer had outside `<Foo>…</Foo>` survives.
 *
 * Returns `{content}` or `{error}` — never throws for a refusal.
 */
export async function inlineLayoutIntoImporter(input) {
  const { layoutSource, layoutName, layoutRelDir, importerSource, importerRelDir, parse } = input;

  const { ast } = await parse(importerSource, { position: true });
  // Astro splits `element` (lowercase) from `component` (PascalCase); a walker
  // matching only `element` finds nothing here.
  const usages = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'component' && n.name === layoutName) usages.push(n);
    for (const c of n.children ?? []) walk(c);
    if (n.content) walk(n.content);
  };
  walk(ast);

  if (usages.length > 1) {
    return { error: `uses <${layoutName}> more than once — two usages need two prop scopes in one frontmatter` };
  }

  const importerParts = splitFrontmatter(importerSource);
  const nextImporterFm = dropLayoutImport(importerParts.frontmatter, layoutName);

  const buf = Buffer.from(importerSource, 'utf8');
  const fenceEnd = fenceByteLength(importerSource);

  // A DEAD import — the file imports the layout and never renders it. Dropping
  // the import is the whole job: refusing here would make a stray import enough
  // to render the layout undeletable, and leaving it breaks the route the
  // moment the file is gone. The layout's own document is NOT pulled in.
  if (usages.length === 0) {
    const nextFence = fence(nextImporterFm);
    return {
      content: applyByteEdits(buf, [{ start: 0, end: fenceEnd, text: nextFence }]).toString('utf8'),
      preservedSpans: [{ beforeStart: fenceEnd, afterStart: Buffer.byteLength(nextFence, 'utf8'), length: buf.length - fenceEnd }],
    };
  }

  const span = usageSpan(buf, usages[0]);
  if (!span) return { error: `could not locate the <${layoutName}> tag` };

  const layout = splitFrontmatter(layoutSource);
  // Built ONCE from the AST's own parse, then applied to both the layout's
  // frontmatter and its template.
  const literal = `{ ${attrsToLiteralBody(usages[0].attributes ?? [])} }`;

  // Children: the whole inner run is the default slot, minus each direct child
  // that named a slot of its own. Bytes are copied verbatim — no re-indent.
  const children = [];
  if (!span.selfClosing) {
    const innerEnd = span.end - (3 + Buffer.byteLength(layoutName, 'utf8')); // `</Name>`
    // Parser order is document order, so these are already ascending by offset —
    // the gap-walk below relies on that and does not re-sort.
    const named = [];
    for (const child of usages[0].children ?? []) {
      if (child.type !== 'element' && child.type !== 'component') continue;
      const slot = child.attributes?.find((a) => a.name === 'slot')?.value;
      if (!slot || !child.position || !child.name) continue;
      const cs = usageSpan(buf, child);
      if (!cs) continue;
      named.push({ start: cs.tagStart, end: cs.end, slot });
    }
    let defaultRun = '';
    const regions = [];
    let cursor = span.childrenStart;
    for (const n of named) {
      regions.push({ beforeStart: cursor, afterStart: Buffer.byteLength(defaultRun, 'utf8'), length: n.start - cursor });
      defaultRun += buf.subarray(cursor, n.start).toString('utf8');
      cursor = n.end;
    }
    regions.push({ beforeStart: cursor, afterStart: Buffer.byteLength(defaultRun, 'utf8'), length: innerEnd - cursor });
    defaultRun += buf.subarray(cursor, innerEnd).toString('utf8');
    if (defaultRun.trim()) children.push({ slot: '', source: defaultRun, regions });
    for (const n of named) children.push({ slot: n.slot, source: buf.subarray(n.start, n.end).toString('utf8'),
      regions: [{ beforeStart: n.start, afterStart: 0, length: n.end - n.start }] });
  }

  const layoutFm = materializeProps(
    rewriteRelativeImports(layout.frontmatter, layoutRelDir, importerRelDir),
    literal,
  );
  const childSpans = [];
  const spliced = spliceChildrenBySlot(materializeProps(layout.template, literal), children, childSpans);
  const nextFence = fence([layoutFm.trim(), nextImporterFm.trim()].filter(Boolean).join('\n'));

  // ONE byte-space pass. applyByteEdits splices right-to-left, so rewriting the
  // frontmatter cannot invalidate the usage offsets.
  const out = applyByteEdits(buf, [
    { start: 0, end: fenceEnd, text: nextFence },
    { start: span.tagStart, end: span.end, text: spliced },
  ]);
  const fenceShift = Buffer.byteLength(nextFence, 'utf8') - fenceEnd;
  return { content: out.toString('utf8'), preservedSpans: [
    { beforeStart: fenceEnd, afterStart: fenceEnd + fenceShift, length: span.tagStart - fenceEnd },
    ...childSpans.map(region => ({ ...region, afterStart: region.afterStart + span.tagStart + fenceShift })),
    { beforeStart: span.end, afterStart: span.tagStart + fenceShift + Buffer.byteLength(spliced, 'utf8'), length: buf.length - span.end },
  ] };
}
