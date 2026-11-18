/**
 * Byte-space source surgery, in ONE place.
 *
 * `@astrojs/compiler` reports positions as UTF-8 BYTE offsets, so every writer
 * that edits an .astro file from an AST works in `Buffer` space — never string
 * indices, which drift the moment the file contains a non-ASCII character.
 *
 * PLAIN JS and in the plugin dir on purpose: sq-inline-layout.js needs these
 * while running inside the instance's `astro dev`, which gets only the plugin
 * dir's `.js` files (desktop/src/instance.mjs SQ_FILES).
 * `app/src/vite-plugin/server/localStamp.ts` re-exports them — never a second
 * copy, or the stamper and the inline transform find tags differently.
 */

const LT = 0x3c; // '<'
const SLASH = 0x2f; // '/'
const GT = 0x3e; // '>'

const isSpaceByte = (b) => b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d;

/** A byte that may legally terminate a tag name. */
const isNameEndByte = (b) => b === undefined || isSpaceByte(b) || b === SLASH || b === GT;

/**
 * The `<` of the tag whose AST node reports `offset`, or null.
 *
 * Accepts the `<` AT the offset or ONE byte before it (the compiler reports
 * either) and then verifies the tag-name bytes actually follow. Anything else
 * returns null and the site is skipped — fail closed: an unstamped placement
 * keeps working on the `q` chain, a mis-positioned insert corrupts the file.
 */
export function findTagStart(buf, offset, name) {
  const nameBytes = Buffer.from(name, 'utf8');
  const matches = (lt) => {
    if (lt < 0 || buf[lt] !== LT) return false;
    const from = lt + 1;
    if (from + nameBytes.length > buf.length) return false;
    if (!buf.subarray(from, from + nameBytes.length).equals(nameBytes)) return false;
    return isNameEndByte(buf[from + nameBytes.length]);
  };
  if (matches(offset)) return offset;
  if (matches(offset - 1)) return offset - 1;
  return null;
}

/**
 * Apply byte edits right-to-left, in `Buffer` space.
 *
 * Right-to-left so earlier offsets stay valid — the same one-coordinate-system,
 * one-splice-loop discipline `sq-tagging.js` adopted after the round-3 rebasing
 * bug corrupted that file.
 */
export function applyByteEdits(buf, edits) {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = buf;
  for (const e of sorted) {
    out = Buffer.concat([out.subarray(0, e.start), Buffer.from(e.text, 'utf8'), out.subarray(e.end)]);
  }
  return out;
}
