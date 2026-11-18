/**
 * Pure string helpers for the component-editor drawn MIRROR (task-078).
 *
 * Drawn elements are baked into the component `.astro` source marked with
 * `data-sq-drawn="<key>"`. Two consumers strip those marked elements:
 *  - the write-back reconcile (host): strip before re-inserting the live set, so
 *    add/delete both modify source and the operation is idempotent;
 *  - the editor reopen (client): strip on read so the boxes render once, from
 *    the live Yjs/localStorage drawn set, never doubled with the baked source.
 *
 * Zero dependencies on purpose — safe to import in BOTH the Vite plugin (host)
 * and the React client without pulling in @astrojs/compiler.
 */

const DRAWN_VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Find the index just past the matching `</tagName>` for an element whose opening
 * tag ends at `from`, accounting for nested same-name elements. Returns -1 if no
 * balanced close is found. Operates on the well-formed markup `serializeDrawnTree`
 * produces, so a hand-rolled depth scan is sufficient (no full HTML parser).
 * Exported: also the balanced scanner for export-time drawn nesting
 * (generateAstro appendInsideKeyedElement) — keep ONE copy, it lives here
 * because this module stays dependency-free.
 */
export function findMatchingClose(s: string, from: number, tagName: string): number {
  const openRe = new RegExp(`<${tagName}(?=[\\s/>])`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  let depth = 1;
  let i = from;
  while (i < s.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const o = openRe.exec(s);
    const c = closeRe.exec(s);
    if (!c) return -1;
    if (o && o.index < c.index) {
      const gt = s.indexOf('>', o.index);
      if (gt === -1) return -1;
      const openTag = s.slice(o.index, gt + 1);
      // A nested self-closing same-name tag does not add depth.
      if (!/\/\s*>$/.test(openTag)) depth++;
      i = gt + 1;
    } else {
      depth--;
      i = c.index + c[0].length;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Remove every element bearing a `data-sq-drawn` attribute (and its whole
 * subtree) from `content`, including the element's leading indentation and one
 * trailing newline — the inverse of the bake insert, so reconcile is idempotent.
 * Restarts the scan after each removal (indices shift); bails on malformed markup
 * to avoid an infinite loop.
 */
export function stripDrawnElements(content: string, onRemove?: (before: string, after: string, start: number, end: number) => void): string {
  let out = content;
  for (;;) {
    const attrIdx = out.indexOf('data-sq-drawn');
    if (attrIdx === -1) break;
    const tagStart = out.lastIndexOf('<', attrIdx);
    if (tagStart === -1) break;
    const openEnd = out.indexOf('>', attrIdx);
    if (openEnd === -1) break;
    const openTag = out.slice(tagStart, openEnd + 1);
    const nameMatch = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(openTag);
    const tagName = nameMatch ? nameMatch[1].toLowerCase() : '';
    const selfClosing = /\/\s*>$/.test(openTag) || DRAWN_VOID_ELEMENTS.has(tagName);
    let spanEnd: number;
    if (selfClosing || !tagName) {
      spanEnd = openEnd + 1;
    } else {
      const close = findMatchingClose(out, openEnd + 1, tagName);
      spanEnd = close === -1 ? openEnd + 1 : close;
    }
    // Consume leading indentation (spaces/tabs) on the element's own line…
    let removeStart = tagStart;
    while (removeStart > 0 && (out[removeStart - 1] === ' ' || out[removeStart - 1] === '\t')) removeStart--;
    // …and one trailing newline, so no blank line is left behind.
    let removeEnd = spanEnd;
    if (out[removeEnd] === '\n') removeEnd++;
    const before = out;
    out = out.slice(0, removeStart) + out.slice(removeEnd);
    onRemove?.(before, out, removeStart, removeEnd);
  }
  return out;
}
