/**
 * BlogCard field binding (task-240 Phase 2). In the card MASTER a text
 * element bound to a collection field reads `{post.data.<field>}`; an <img>
 * reads `src={post.data.<field>?.src ?? post.data.<field>}` — image() metadata
 * or a plain path, so no schema knowledge is needed. Pure transforms over the
 * component file; the writer (components/Editor/localFieldBind) commits them.
 */
import { TEXT_EDITABLE_TAGS } from '@/components/Canvas/viewportMessages/selection';
import { getElementSource, updateElementSource, updateTextContent, updateAttributeExpression } from '@/vite-plugin/ast-updater';
import type { SourceLocation } from '@/store/types';
import { entryVarOf } from '@/utils/cardFields';

/** `box` = a block container that holds an image (the library card's `aspect-video` placeholder box). */
export type FieldKind = 'text' | 'img' | 'box';

// `?.src` since 2026-09-12: a post without the field (or the card master's
// standalone fallback) crashed the render with `.src` (TypeError: reading
// 'src' of undefined); files bound with the old form still parse.
// Any entry name: our cards say `post`, an imported card `work` (cardFields.entryVarOf). Field = group 2.
const FIELD = String.raw`([A-Za-z_$][\w$]*)\.data\.([A-Za-z_$][\w$]*)(?:\??\.src\s*\?\?\s*\1\.data\.\2)?`;
const TEXT_RE = new RegExp(`^\\s*\\{\\s*${FIELD}\\s*\\}\\s*$`);
const SRC_RE = new RegExp(`\\bsrc=\\{\\s*${FIELD}\\s*\\}`);

/**
 * A date field shown as text picks a format (owner 2026-10-10). Written into
 * the card as plain Astro — `{post.data.date && new Date(post.data.date)
 * .toLocaleDateString('en-US', { … timeZone: 'UTC' })}` — so the card stays
 * self-contained; '' = the value as stored. UTC: content dates are midnight UTC.
 * dateExpression is the ONE definition: the reader compares against it.
 */
const FORMATS: ReadonlyArray<[value: string, locale: string, options: Record<string, string>]> = [
  ['short', 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }],
  ['long', 'en-US', { month: 'long', day: 'numeric', year: 'numeric' }],
  ['day-short', 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }],
  ['day-long', 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }],
  ['numeric', 'en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }],
  ['iso', 'sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }],
  ['month', 'en-US', { month: 'short', year: 'numeric' }],
  ['year', 'en-US', { year: 'numeric' }],
];
/** The picker's options; each label is what the format renders. */
export const DATE_FORMATS = FORMATS.map(([value, locale, options]) => ({
  value, label: new Date(Date.UTC(2026, 9, 8)).toLocaleDateString(locale, { ...options, timeZone: 'UTC' }),
}));

function dateExpression(entry: string, field: string, format: string): string {
  const [, locale, options] = FORMATS.find(([v]) => v === format)!;
  const opts = Object.entries(options).map(([k, v]) => `${k}: '${v}'`).join(', ');
  return `${entry}.data.${field} && new Date(${entry}.data.${field}).toLocaleDateString('${locale}', { ${opts}, timeZone: 'UTC' })`;
}

const DATE_HEAD_RE = /^\s*\{\s*([A-Za-z_$][\w$]*)\.data\.([A-Za-z_$][\w$]*)\s*&&/;
const squashed = (s: string) => s.replace(/\s+/g, '');

/** A text element's `{post.data.f}` ('' = as stored) or a date format we write; null = static or hand-written. */
function readTextBinding(inner: string | null): { field: string; dateFormat: string } | null {
  if (inner === null) return null;
  const m = inner.match(TEXT_RE);
  if (m) return { field: m[2], dateFormat: '' };
  const d = inner.match(DATE_HEAD_RE);
  const hit = d && FORMATS.find(([v]) => squashed(inner) === squashed(`{${dateExpression(d[1], d[2], v)}}`));
  return hit ? { field: d![2], dateFormat: hit[0] } : null;
}

/** The format a TEXT element bound to a field shows ('' = as stored); null = not a text binding we write. */
export function readDateFormat(elementSource: string, tagName: string): string | null {
  return bindingKindFor(tagName) === 'text' ? readTextBinding(innerOf(elementSource))?.dateFormat ?? null : null;
}
/** The opening tag incl. quoted / `{…}` attribute values. */
const OPEN_TAG_RE = /^<[a-zA-Z][\w.:-]*(?:\s+(?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*)?>/;
const BOX_TAGS = new Set(['div', 'figure', 'picture']);
/** A box is bindable while its content is a placeholder: nothing, text, or inline img/span/br only. */
const BOX_BLOCK_CHILD_RE = /<(?!\/?(?:img|span|br)\b)[a-zA-Z]/;

export function bindingKindFor(tagName: string): FieldKind | null {
  if (tagName === 'img') return 'img';
  if (BOX_TAGS.has(tagName)) return 'box';
  return TEXT_EDITABLE_TAGS.has(tagName) ? 'text' : null;
}

/** May an IMAGE field fill this element? A box only while it holds no block children (their loss would be silent). */
export function canBindField(elementSource: string, tagName: string): boolean {
  if (bindingKindFor(tagName) !== 'box') return bindingKindFor(tagName) !== null;
  const inner = innerOf(elementSource);
  return inner !== null && !BOX_BLOCK_CHILD_RE.test(inner);
}

/** The expression a field renders as: image fields resolve metadata or a path (Astro's <Image> takes the metadata as is). */
export function fieldExpression(field: string, type: string, entry = 'post', astroImage = false): string {
  return type === 'image' && !astroImage ? `${entry}.data.${field}?.src ?? ${entry}.data.${field}` : `${entry}.data.${field}`;
}

function innerOf(elementSource: string): string | null {
  const open = elementSource.match(OPEN_TAG_RE);
  if (!open || open[0].endsWith('/>')) return null;
  const close = elementSource.lastIndexOf('</');
  return close < open[0].length ? null : elementSource.slice(open[0].length, close);
}

/** The field an element is bound to (from its own source bytes), else null. */
export function readFieldBinding(elementSource: string, tagName: string): string | null {
  const kind = bindingKindFor(tagName);
  if (kind === 'img') return elementSource.match(SRC_RE)?.[2] ?? null;
  if (kind === 'text') return readTextBinding(innerOf(elementSource))?.field ?? null;
  if (kind === 'box') {
    const inner = innerOf(elementSource)?.trim() ?? '';
    return /^<img\b[^>]*\/?>$/.test(inner) ? inner.match(SRC_RE)?.[2] ?? null : null;
  }
  return null;
}

// Block-form cards (utils/cardSetup) read a SLOT: `{f('x')}` / `src={f('x')?.src ?? f('x')}`.
const SLOT = String.raw`f\('([A-Za-z_$][\w$]*)'\)(?:\??\.src\s*\?\?\s*f\('\1'\))?`;
const SLOT_TEXT_RE = new RegExp(`^\\s*\\{\\s*${SLOT}\\s*\\}\\s*$`);
const SLOT_SRC_RE = new RegExp(`\\bsrc=\\{\\s*${SLOT}\\s*\\}`);

/** The slot a block-form card element renders (from its own source bytes), else null. */
export function readSlotBinding(elementSource: string, tagName: string): string | null {
  const kind = bindingKindFor(tagName);
  if (kind === 'img') return elementSource.match(SLOT_SRC_RE)?.[1] ?? null;
  if (kind === 'text') return innerOf(elementSource)?.match(SLOT_TEXT_RE)?.[1] ?? null;
  if (kind === 'box') {
    const inner = innerOf(elementSource)?.trim() ?? '';
    return /^(?:\{f\('[\w$]+'\)\s*&&\s*)?<img\b[^>]*\/?>\}?$/.test(inner) ? inner.match(SLOT_SRC_RE)?.[1] ?? null : null;
  }
  return null;
}

/** The element an IMAGE field turns a text placeholder into: fills its box; decorative (the card's title is text beside it). */
export function boundImageTag(field: string, entry = 'post'): string {
  return `<img src={${fieldExpression(field, 'image', entry)}} alt="" class="w-full h-full object-cover" />`;
}

/**
 * The component file with the element at `loc` bound to `field` (null = back
 * to a static placeholder; text only — an image is "unbound" by filling it
 * with a static image). An IMAGE field on a BOX (the library card's
 * `<div class="aspect-video …"><span>{post.data.thumbnail}</span></div>`
 * placeholder — the span inside is inline text, never selectable on its own)
 * replaces the box's CONTENT with a bound <img> and keeps the box; on a TEXT
 * element it replaces the element itself — the path as text is never what was
 * meant. Throws when the element cannot be located or bound.
 */
export async function applyFieldBinding(
  content: string, loc: SourceLocation, tagName: string, field: string | null, fieldType: string,
  /** A date field on a text element: a DATE_FORMATS value, '' = as stored. */
  dateFormat = '',
): Promise<string> {
  const kind = bindingKindFor(tagName);
  if (!kind) throw new Error(`<${tagName}> cannot be bound to a field`);
  const entry = entryVarOf(content);
  if (kind === 'img') {
    if (!field) throw new Error('an image is unbound by filling it with a static image');
    const astroImage = /^<(Image|Picture)\b/.test(getElementSource(content, loc).source);
    return updateAttributeExpression(content, loc, 'src', fieldExpression(field, fieldType, entry, astroImage));
  }
  if (kind === 'box') {
    if (!field || fieldType !== 'image') throw new Error('a box takes an image field');
    const el = getElementSource(content, loc);
    if (!canBindField(el.source, tagName)) throw new Error('this box holds other elements — bind an image inside it instead');
    const open = el.source.match(OPEN_TAG_RE)![0];
    const close = el.source.slice(el.source.lastIndexOf('</'));
    const indent = content.split('\n')[el.startLine - 1].match(/^[ \t]*/)![0];
    return updateElementSource(content, el.startLine, el.endLine, `${open}\n${indent}  ${boundImageTag(field, entry)}\n${indent}${close}`);
  }
  if (field && fieldType === 'image') {
    const { startLine, endLine } = getElementSource(content, loc);
    return updateElementSource(content, startLine, endLine, boundImageTag(field, entry));
  }
  if (field) {
    const expr = dateFormat ? dateExpression(entry, field, dateFormat) : fieldExpression(field, fieldType, entry);
    return updateTextContent(content, loc.file, loc, `{${expr}}`, undefined, true);
  }
  const previous = readFieldBinding(getElementSource(content, loc).source, tagName);
  const placeholder = previous ? previous.charAt(0).toUpperCase() + previous.slice(1) : 'Text';
  return updateTextContent(content, loc.file, loc, placeholder);
}
