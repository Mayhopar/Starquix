/**
 * Schema follows the field (2026-09-12). On the files-truth runtime the editor
 * never REWRITES the user's content config (writeContentConfig no-ops there) —
 * but a strict `z.object` strips undeclared keys from post.data, so a field
 * added in the post editor never reached the site. These are SURGICAL edits:
 * one property line inserted into / removed from the named collection's
 * `z.object({…})`, every other byte kept. No config, a collection the config
 * does not declare, or no `z.object` schema → the input, unchanged.
 * // ponytail: text scanning with bracket balancing, not a TS parser — the
 * // shapes are `const x = defineCollection({ schema: [({ image }) =>] z.object({…}) })`
 * // and an inline `name: defineCollection(…)` entry; anything else is left alone.
 */
import type { FieldType } from './types';

/** The zod declaration for an editor field type — always optional (existing posts may lack it). */
export function zodFor(type: FieldType): string {
  switch (type) {
    case 'boolean': return 'z.boolean().optional()';
    case 'date': return 'z.coerce.date().optional()';
    case 'list': return 'z.array(z.string()).optional()';
    // image: a public `/uploads/…` path string (the editor's upload target for
    // a field the schema does not declare with image()).
    default: return 'z.string().optional()';
  }
}

const ident = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Index just past the opening bracket at `open`, and the index of its matching close (skipping strings). */
function matchBracket(src: string, open: number): number {
  const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
  const stack: string[] = [pairs[src[open]]];
  let quote: string | null = null;
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return i; }
  }
  return -1;
}

/** The `{`…`}` span of the named collection's `z.object({` in the config, else null. */
function schemaObjectSpan(config: string, collection: string): { open: number; close: number } | null {
  const entries = config.match(/export\s+const\s+collections\s*(?::[^=]*)?=\s*\{/);
  if (!entries || entries.index === undefined) return null;
  const objOpen = entries.index + entries[0].length - 1;
  const objClose = matchBracket(config, objOpen);
  if (objClose === -1) return null;
  const body = config.slice(objOpen + 1, objClose);
  const inline = body.match(new RegExp(`(^|[{,\\s])${ident(collection)}\\s*:\\s*defineCollection\\s*\\(`));
  const entry = inline ?? body.match(new RegExp(`(^|[{,\\s])${ident(collection)}\\s*(?::\\s*([A-Za-z_$][\\w$]*))?\\s*(?=[,}\\s]|$)`, 'm'));
  if (!entry || entry.index === undefined) return null;
  let from: number;
  if (inline) {
    from = objOpen + 1 + entry.index;
  } else {
    const varName = entry[2] ?? collection;
    const decl = config.match(new RegExp(`\\b(?:const|let|var)\\s+${ident(varName)}\\s*(?::[^=]*)?=\\s*defineCollection\\s*\\(`));
    if (!decl || decl.index === undefined) return null;
    from = decl.index;
  }
  const callOpen = config.indexOf('(', config.indexOf('defineCollection', from));
  const callClose = matchBracket(config, callOpen);
  if (callClose === -1) return null;
  const call = config.slice(callOpen, callClose);
  const zo = call.match(/\bz\.object\s*\(\s*\{/);
  if (!zo || zo.index === undefined) return null;
  const open = callOpen + zo.index + zo[0].length - 1;
  const close = matchBracket(config, open);
  return close === -1 ? null : { open, close };
}

/** Top-level properties of an object body: `[start, end)` of each `name: value` incl. its trailing comma; `value` = just past its colon. */
function properties(body: string): Array<{ name: string; start: number; value: number; end: number }> {
  const out: Array<{ name: string; start: number; value: number; end: number }> = [];
  let i = 0;
  while (i < body.length) {
    const m = body.slice(i).match(/^\s*(?:\/\/[^\n]*\n\s*)*(?:(['"]?)([A-Za-z_$][\w$-]*)\1)\s*:/);
    if (!m) break;
    const start = i + m[0].length - m[0].trimStart().length;
    let j = i + m[0].length;
    let quote: string | null = null;
    let depth = 0;
    for (; j < body.length; j++) {
      const c = body[j];
      if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') quote = c;
      else if ('({['.includes(c)) depth++;
      else if (')}]'.includes(c)) depth--;
      else if (c === ',' && depth === 0) { j++; break; }
    }
    out.push({ name: m[2], start, value: i + m[0].length, end: j });
    i = j;
  }
  return out;
}

export function addFieldToContentConfig(config: string, collection: string, name: string, type: FieldType): string {
  const span = schemaObjectSpan(config, collection);
  if (!span) return config;
  const body = config.slice(span.open + 1, span.close);
  const props = properties(body);
  if (props.some((p) => p.name === name)) return config;
  const last = props[props.length - 1];
  if (!last) {
    // Empty object: `{}` → a two-space block under the line's own indentation.
    const lineStart = config.lastIndexOf('\n', span.open) + 1;
    const indent = config.slice(lineStart).match(/^[ \t]*/)![0];
    return `${config.slice(0, span.open + 1)}\n${indent}  ${name}: ${zodFor(type)},\n${indent}${config.slice(span.close)}`;
  }
  const lastText = body.slice(last.start, last.end);
  const lineStart = body.lastIndexOf('\n', last.start) + 1;
  const indent = body.slice(lineStart, last.start);
  const comma = lastText.trimEnd().endsWith(',') ? '' : ',';
  const at = span.open + 1 + last.start + lastText.trimEnd().length;
  return `${config.slice(0, at)}${comma}\n${indent}${name}: ${zodFor(type)},${config.slice(at)}`;
}

export function removeFieldFromContentConfig(config: string, collection: string, name: string): string {
  const span = schemaObjectSpan(config, collection);
  if (!span) return config;
  const body = config.slice(span.open + 1, span.close);
  const prop = properties(body).find((p) => p.name === name);
  if (!prop) return config;
  // Take the property's own line(s): from the start of its line through the newline after its comma.
  const lineStart = body.lastIndexOf('\n', prop.start) + 1;
  const nl = body.indexOf('\n', prop.end - 1);
  const lineEnd = nl === -1 ? prop.end : nl + 1;
  const before = body.slice(0, lineStart);
  const after = body.slice(lineEnd);
  // The previous property may have been the one without a trailing comma only
  // if it was last — after removing the last one, leave the file as it was.
  return `${config.slice(0, span.open + 1)}${before}${after}${config.slice(span.close)}`;
}

/**
 * Does `collection`'s schema in this config declare `field` with Astro's
 * `image()` helper? Scoped to that collection's own `z.object({…})` — a field
 * of the same name in another collection says nothing about this one, and a
 * collection the config does not declare (raw frontmatter) is never image().
 */
export function isImageSchemaFieldIn(config: string, collection: string, field: string): boolean {
  const span = schemaObjectSpan(config, collection);
  if (!span) return false;
  const body = config.slice(span.open + 1, span.close);
  const prop = properties(body).find((p) => p.name === field);
  return !!prop && /:\s*image\s*\(\s*\)/.test(body.slice(prop.start, prop.end));
}

/** A property's value expression: its outer call chain (bracket contents dropped: `image().optional()`,
 * `z.object()`) and the body offset where it ends — before the trailing comma or a trailing comment. */
function declaration(body: string, prop: { value: number; end: number }): { chain: string; end: number } {
  const value = body.slice(prop.value, prop.end).replace(/,$/, '').trimEnd();
  let chain = '', end = value.length;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '/' && (value[i + 1] === '/' || value[i + 1] === '*')) { end = value.slice(0, i).trimEnd().length; break; }
    if ('({['.includes(c)) { const close = matchBracket(value, i); if (close === -1) break; chain += c + value[close]; i = close; continue; }
    chain += c;
  }
  return { chain: chain.trim(), end: prop.value + end };
}

/** A value that may be missing from a post: `.optional()`, `.nullish()`, `.default(…)`, `z.optional(…)`. */
const MAY_BE_MISSING = /(^|\.)(optional|nullish|default)\(\)/;

/** Names `collection`'s schema declares as required — a post without them fails Astro's content validation. */
export function requiredFieldsIn(config: string, collection: string): string[] {
  const span = schemaObjectSpan(config, collection);
  if (!span) return [];
  const body = config.slice(span.open + 1, span.close);
  return properties(body).filter((p) => !MAY_BE_MISSING.test(declaration(body, p).chain)).map((p) => p.name);
}

/** Appends `.optional()` to a required declaration (before any trailing comment); undeclared or already optional → unchanged. */
export function makeFieldOptionalInContentConfig(config: string, collection: string, name: string): string {
  const span = schemaObjectSpan(config, collection);
  if (!span) return config;
  const body = config.slice(span.open + 1, span.close);
  const prop = properties(body).find((p) => p.name === name);
  if (!prop) return config;
  const decl = declaration(body, prop);
  if (MAY_BE_MISSING.test(decl.chain)) return config;
  const at = span.open + 1 + decl.end;
  return `${config.slice(0, at)}.optional()${config.slice(at)}`;
}
