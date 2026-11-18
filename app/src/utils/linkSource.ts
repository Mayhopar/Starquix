/**
 * Link edits on a source file, pure: add (wrap), remove, set an attribute.
 * The Design Bar's Link block and the AI/MCP link tools share them. Offsets are
 * LF-normalized, as getElementSource's are.
 */
import { extractOpeningTag, getElementSource, updateAttribute } from '@/vite-plugin/ast-updater';

/** A new link's target until the user types one: home, a real route the arrow can follow. */
export const DEFAULT_LINK_HREF = '/';

/** `<a>`-only attributes: without them the element is no link. */
const LINK_ONLY_ATTRS = ['href', 'target', 'rel', 'download', 'aria-label'];

type Loc = { line: number; column: number };

const offsetAt = (text: string, { line, column }: Loc) => {
  let start = 0;
  for (let l = 1; l < line; l++) start = text.indexOf('\n', start) + 1;
  return start + column - 1;
};

const locationAt = (text: string, offset: number): Loc => ({
  line: text.slice(0, offset).split('\n').length,
  column: offset - text.lastIndexOf('\n', offset - 1),
});

/**
 * `<x …>…</x>` → `<a href="/"><x …>…</x></a>`, on the element's own lines so
 * the rest of the file stays put. Under a flex or grid parent the link box is
 * `contents`: the element stays the item, or its column and sizing would stop
 * applying. `element` = where the element now starts.
 */
export function wrapLinkSource(src: string, loc: Loc, tagName: string, transparent: boolean): { source: string; element: Loc } {
  const text = src.replace(/\r\n/g, '\n');
  const { source, startOffset, endOffset } = getElementSource(text, { file: '', ...loc });
  if (!new RegExp(`^<${tagName}[\\s/>]`, 'i').test(source)) throw new Error('the file changed — select the element again');
  const open = `<a href="${DEFAULT_LINK_HREF}"${transparent ? ' class="contents"' : ''}>`;
  const out = text.slice(0, startOffset) + open + source + '</a>' + text.slice(endOffset);
  return { source: out, element: locationAt(out, startOffset + open.length) };
}

/** `<a …>children</a>` → children. Throws when the element is not a wrapping link. */
export function unwrapLinkSource(src: string, loc: Loc): string {
  const text = src.replace(/\r\n/g, '\n'); // getElementSource offsets are LF-normalized
  const { source, startOffset, endOffset } = getElementSource(text, { file: '', line: loc.line, column: loc.column });
  if (!/^<a[\s>]/.test(source)) throw new Error('the element is not a link (<a>)');
  if (source.endsWith('/>')) throw new Error('the link has no children to keep');
  const open = extractOpeningTag(source, 0)!;
  const inner = source.slice(open.endOffset, source.lastIndexOf('</a>')).trim();
  return text.slice(0, startOffset) + inner + text.slice(endOffset);
}

/**
 * Remove the link and nothing else. A bare wrapper around elements (what + made)
 * goes away. A link that carries a look or holds only text stays as a `<span>`,
 * the same box as an `<a>`: the unwrapped text would lose its classes, and the
 * selection its element. `inside` = an element in the link; `element` = where it lands.
 */
export async function removeLinkSource(src: string, file: string, loc: Loc, inside: Loc | null): Promise<{ source: string; element: Loc | null }> {
  const text = src.replace(/\r\n/g, '\n');
  const link = getElementSource(text, { file, ...loc });
  if (!/^<a[\s>]/.test(link.source)) throw new Error('the element is not a link (<a>)');
  const innerStart = link.startOffset + extractOpeningTag(link.source, 0)!.endOffset;

  let bare = text;
  for (const attribute of LINK_ONLY_ATTRS) bare = await updateAttribute(bare, file, { file, ...loc }, attribute, '');
  const { source, startOffset, endOffset } = getElementSource(bare, { file, ...loc });
  const open = extractOpeningTag(source, 0)!;
  const inner = source.slice(open.endOffset, source.lastIndexOf('</a>'));

  const wrapper = /^<a(\s+class="contents")?\s*>$/.test(open.tagContent) && inner.trimStart().startsWith('<');
  const span = `<span${open.tagContent.slice(2)}`;
  const out = wrapper
    ? unwrapLinkSource(bare, loc)
    : bare.slice(0, startOffset) + span + inner + '</span>' + bare.slice(endOffset);
  const delta = wrapper
    ? startOffset - (innerStart + inner.length - inner.trimStart().length)
    : startOffset + span.length - innerStart;
  return { source: out, element: inside ? locationAt(out, offsetAt(text, inside) + delta) : null };
}

/** Set (empty = remove) one attribute of a link. A `href={…}` is code, never overwritten.
 *  `inside` = an element after the opening tag; `element` = where it lands. */
export async function setLinkAttribute(src: string, file: string, loc: Loc, attribute: string, value: string, inside: Loc | null = null): Promise<{ source: string; element: Loc | null }> {
  const link = getElementSource(src, { file, ...loc });
  if (!/^<a[\s>]/.test(link.source)) throw new Error('the element is not a link (<a>)');
  if (attribute === 'href' && /\shref=\{/.test(extractOpeningTag(link.source, 0)!.tagContent)) {
    throw new Error('this link is set by code — change it in Source');
  }
  const source = await updateAttribute(src, file, { file, ...loc }, attribute, value);
  return { source, element: inside ? locationAt(source, offsetAt(src, inside) + source.length - src.length) : null };
}

// ponytail: session table, never pruned (a key or two per link edit); selection only.
const elementPositions = new Map<string, { tagName: string; keys: Set<string> }>();

/** The same element's key at another source position; placement and copy suffixes stay. */
export const movedKey = (key: string, { line, column }: Loc) => key.replace(/:\d+:\d+(?=~|#|$)/, `:${line}:${column}`);

/** A link edit moved an element: every position it has had, since ⌘Z and ⇧⌘Z walk them again. */
export function noteLinkKeyMove(key: string, next: string, tagName: string): void {
  const positions = elementPositions.get(key) ?? { tagName, keys: new Set([key]) };
  positions.keys.add(next);
  elementPositions.set(key, positions);
  elementPositions.set(next, positions);
}

// A text session linked part of this element; the link's own parent, once selected.
let linkedTextParent: string | null = null;
const inlineLinkParents = new Map<string, string>();

/** Selected text became a link: the element holds it now, so the panel moves to it. */
export function noteInlineLinkAdded(parentKey: string): void {
  linkedTextParent = parentKey;
}

interface ScanRow { key: string; tagName: string; parentKey?: string | null; linkHref?: string; sourceLocation?: unknown }

/** The element to select after a scan: the new `<a>` of linked text, or the
 *  selected element when its key no longer shows it (the key is gone, or the
 *  new `<a>` took its position). */
export function linkElementAfterScan<T extends ScanRow>(selectedKey: string, elements: readonly T[]): T | null {
  if (selectedKey === linkedTextParent) {
    const link = elements.find((e) => e.parentKey === selectedKey && e.tagName === 'a' && e.linkHref === DEFAULT_LINK_HREF && e.sourceLocation);
    if (link) {
      linkedTextParent = null;
      inlineLinkParents.set(link.key, selectedKey);
      return link;
    }
  }
  const here = elements.find((e) => e.key === selectedKey);
  const parent = inlineLinkParents.get(selectedKey);
  if (parent && !here) return elements.find((e) => e.key === parent) ?? null;
  const moved = elementPositions.get(selectedKey);
  if (!moved || here?.tagName === moved.tagName) return null;
  return elements.find((e) => moved.keys.has(e.key) && e.tagName === moved.tagName) ?? null;
}
