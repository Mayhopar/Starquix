/** Bounded source edits: never serialize an entire imported YAML document. */
import { load, JSON_SCHEMA, YAML11_SCHEMA } from 'js-yaml';

export interface PostWriteBaseline { frontmatter: Record<string, unknown>; body: string }
/** Retained target constraints; only a possibly applied candidate permits reconciliation. */
export interface PostWriteAttempt extends PostWriteBaseline { canReconcileCandidate: boolean }
export interface PostUpdateOptions {
  baseline?: PostWriteBaseline;
  /** Unknown writes or source refusals whose affected targets still need verification. */
  unresolvedAttempts?: readonly PostWriteAttempt[];
}
export interface FrontmatterSourcePatch {
  expectedSource: string;
  edits: Array<{ start: number; end: number; text: string }>;
}
export class PostSourceConflict extends Error {
  readonly code = 'post-source-conflict';
  constructor(message = 'The post changed outside this editor. Keep this draft and reopen the source to compare it.') { super(message); }
}
export class UnsafeFrontmatterEdit extends Error {
  readonly code = 'unsafe-frontmatter-edit';
  constructor() { super('This property uses source syntax that cannot be edited safely here. Your draft is kept.'); }
}
export function equalPostValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.prototype.hasOwnProperty.call(b, k)
    && equalPostValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
export function changedFrontmatter(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(after).filter(([key, value]) => !Object.prototype.hasOwnProperty.call(before, key) || !equalPostValue(before[key], value)));
}

/** Also handles empty blocks, BOM, CRLF and an EOF closing fence. */
export function postSourceParts(raw: string) {
  const opener = /^\uFEFF?---\r?\n/.exec(raw);
  if (!opener) return { start: 0, end: 0, bodyStart: 0, yaml: '', body: raw, eol: '\n', opener: '' };
  const start = opener[0].length;
  const close = /^---(?:\r?\n|$)/m.exec(raw.slice(start));
  if (!close) throw new UnsafeFrontmatterEdit();
  const end = start + close.index, bodyStart = end + close[0].length;
  return { start, end, bodyStart, yaml: raw.slice(start, end), body: raw.slice(bodyStart), eol: opener[0].endsWith('\r\n') ? '\r\n' : '\n', opener: opener[0] };
}
function mapping(yaml: string, json = true): Record<string, unknown> {
  if (!yaml.replace(/^\s*#.*$/gm, '').trim()) return {};
  try {
    const value: unknown = load(yaml, { schema: json ? JSON_SCHEMA : YAML11_SCHEMA });
    if (value == null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new UnsafeFrontmatterEdit();
    return value as Record<string, unknown>;
  } catch { throw new UnsafeFrontmatterEdit(); }
}
function scalar(value: unknown): boolean {
  return value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value));
}
function encoded(value: unknown, previous = ''): string {
  if (!scalar(value) && !(Array.isArray(value) && value.every(scalar))) throw new UnsafeFrontmatterEdit();
  // Astro's default YAML schema distinguishes a bare timestamp from a string.
  // Preserve that distinction on date edits, including quoted date strings.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:[Tt ][\d:.]+(?:[Zz]|[+-][\d:]+)?)?$/.test(previous)
      && /^\d{4}-\d{2}-\d{2}(?:[Tt ][\d:.]+(?:[Zz]|[+-][\d:]+)?)?$/.test(value)) {
    if (load(value, { schema: YAML11_SCHEMA }) instanceof Date) return value;
  }
  return JSON.stringify(value);
}
/** Find a comment outside quoted strings and a single-line flow list. */
function valueEnd(source: string): number {
  let quote = '', depth = 0, tokenStart = true;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (quote === '"' && ch === '\\') { i++; continue; }
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && source[i + 1] === "'") { i++; continue; }
        quote = '';
      }
    } else if ((ch === '"' || ch === "'") && tokenStart) { quote = ch; tokenStart = false; }
    else if ((ch === '[' || ch === '{') && tokenStart) { depth++; tokenStart = true; }
    else if ((ch === ']' || ch === '}') && depth > 0) { depth--; tokenStart = false; }
    else if (ch === ',' && depth > 0) tokenStart = true;
    else if (ch === '#' && depth === 0 && (i === 0 || /\s/.test(source[i - 1]))) return source.slice(0, i).trimEnd().length;
    else if (!/\s/.test(ch)) tokenStart = false;
  }
  return source.trimEnd().length;
}

export function prepareFrontmatterPatch(raw: string, changes: Record<string, unknown>): FrontmatterSourcePatch {
  const parts = postSourceParts(raw);
  const edits: FrontmatterSourcePatch['edits'] = [];
  // Opaque/invalid YAML is safe for body-only writes: no YAML byte changes.
  if (!Object.keys(changes).length) return { expectedSource: raw, edits };
  const original = mapping(parts.yaml), typedOriginal = mapping(parts.yaml, false);
  const requested = Object.entries(changes).filter(([key, value]) => !Object.prototype.hasOwnProperty.call(original, key) || !equalPostValue(original[key], value));
  if (!requested.length) return { expectedSource: raw, edits };
  const expected = { ...original }, typedExpected = { ...typedOriginal };
  let appended = '';
  for (const [key, value] of requested) {
    // Ambiguous/complex key syntax stays read-only. No key strings become regex.
    if (!/^[A-Za-z_][\w-]*$/.test(key)) throw new UnsafeFrontmatterEdit();
    const lines = [...parts.yaml.matchAll(/[^\r\n]*(?:\r?\n|$)/g)];
    const matches = lines.filter(m => m[0].startsWith(`${key}:`) && /^(?:\s|$)/.test(m[0].slice(key.length + 1)));
    let text: string;
    if (Object.prototype.hasOwnProperty.call(original, key)) {
      if (matches.length !== 1) throw new UnsafeFrontmatterEdit();
      const line = matches[0];
      const prefix = new RegExp(`^${key}:[ \\t]*`).exec(line[0])![0];
      const valueSource = line[0].slice(prefix.length).replace(/\r?\n$/, '');
      const end = valueEnd(valueSource), previous = valueSource.slice(0, end);
      if (!previous || /^[|>&*!]/.test(previous)) throw new UnsafeFrontmatterEdit();
      // A block continuation, anchor, alias or tag cannot masquerade as a scalar.
      let parsed: unknown;
      try { parsed = load(previous, { schema: JSON_SCHEMA }); } catch { throw new UnsafeFrontmatterEdit(); }
      if (!equalPostValue(parsed, original[key]) || (!scalar(parsed) && !(Array.isArray(parsed) && parsed.every(scalar)))) throw new UnsafeFrontmatterEdit();
      text = encoded(value, previous);
      edits.push({ start: parts.start + line.index! + prefix.length, end: parts.start + line.index! + prefix.length + end, text });
    } else {
      if (matches.length) throw new UnsafeFrontmatterEdit();
      text = encoded(value);
      appended += `${key}: ${text}${parts.eol}`;
    }
    Object.defineProperty(expected, key, { value, enumerable: true, configurable: true, writable: true });
    Object.defineProperty(typedExpected, key, { value: load(text, { schema: YAML11_SCHEMA }), enumerable: true, configurable: true, writable: true });
  }
  if (appended) edits.push({ start: parts.end, end: parts.end,
    text: parts.opener ? appended : `---${parts.eol}${appended}---${parts.eol}` });
  edits.sort((a, b) => a.start - b.start);
  const patch = { expectedSource: raw, edits };
  const candidate = postSourceParts(applyPreparedPostPatch(raw, patch));
  if (!equalPostValue(mapping(candidate.yaml), expected) || !equalPostValue(mapping(candidate.yaml, false), typedExpected)) throw new UnsafeFrontmatterEdit();
  return patch;
}
export function applyPreparedPostPatch(raw: string, patch: FrontmatterSourcePatch, body?: string): string {
  let next = raw;
  for (const edit of [...patch.edits].reverse()) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  if (body === undefined) return next;
  const parts = postSourceParts(next);
  let header = next.slice(0, parts.bodyStart);
  if (header && !header.endsWith('\n') && body) header += parts.eol;
  return header + body;
}

/** Explicit field deletion: remove its own line/indented continuation only,
 * then prove that every remaining property still has the same meaning. */
export function prepareFrontmatterRemoval(raw: string, key: string): FrontmatterSourcePatch {
  const parts = postSourceParts(raw);
  if (!parts.opener) return { expectedSource: raw, edits: [] };
  const original = mapping(parts.yaml), typedOriginal = mapping(parts.yaml, false);
  if (!Object.prototype.hasOwnProperty.call(original, key)) return { expectedSource: raw, edits: [] };
  if (!/^[A-Za-z_][\w-]*$/.test(key)) throw new UnsafeFrontmatterEdit();
  const lines = [...parts.yaml.matchAll(/[^\r\n]*(?:\r?\n|$)/g)];
  const matches = lines.filter(m => m[0].startsWith(`${key}:`) && /^(?:\s|$)/.test(m[0].slice(key.length + 1)));
  if (matches.length !== 1) throw new UnsafeFrontmatterEdit();
  const line = matches[0], start = parts.start + line.index!;
  let end = start + line[0].length;
  for (let i = lines.indexOf(line) + 1; i < lines.length && /^[ \t]+\S/.test(lines[i][0]); i++) end += lines[i][0].length;
  const patch = { expectedSource: raw, edits: [{ start, end, text: '' }] };
  delete original[key]; delete typedOriginal[key];
  const candidate = postSourceParts(applyPreparedPostPatch(raw, patch));
  if (!equalPostValue(mapping(candidate.yaml), original) || !equalPostValue(mapping(candidate.yaml, false), typedOriginal)) throw new UnsafeFrontmatterEdit();
  return patch;
}
