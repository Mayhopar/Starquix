/**
 * The component view's backdrop (owner 2026-10-10): a per-component EDITOR note
 * in the component file — `@sq-backdrop #hex` in its header comment — read by
 * SqComponentView.astro and written by the Design panel (the component root selected).
 * It never changes how the site renders. Plain JS: it runs in the instance too.
 */
const LINE = /^([ \t]*(?:\*|\/\/)[ \t]*)@sq-backdrop[ \t]+(\S+)[ \t]*\r?\n/m;
export const HEX = /^#[0-9a-fA-F]{3,8}$/;

/** `src` with `tag` added to its header comment (after `* @name`), else a `//` line opening the frontmatter. */
export function stampDocTag(src, tag) {
  const named = /^([ \t]*\*[ \t]*@name[^\n]*\n)/m.exec(src);
  if (named) { const at = named.index + named[0].length; return `${src.slice(0, at)} * ${tag}\n${src.slice(at)}`; }
  if (src.startsWith('---\n')) return `---\n// ${tag}\n${src.slice(4)}`;
  return `---\n// ${tag}\n---\n${src}`;
}

/** The backdrop color the file asks for, else null (only hex — the view writes it into CSS). */
export function readBackdrop(src) {
  const m = LINE.exec(src || '');
  return m && HEX.test(m[2]) ? m[2] : null;
}

/** `src` with its backdrop set to `color` (hex), or the note removed (`null`). */
export function setBackdrop(src, color) {
  if (color !== null && !HEX.test(color)) throw new Error(`Not a hex color: ${color}`);
  const m = LINE.exec(src);
  if (m) return color === null ? src.replace(LINE, '') : src.replace(LINE, `${m[1]}@sq-backdrop ${color}\n`);
  return color === null ? src : stampDocTag(src, `@sq-backdrop ${color}`);
}
