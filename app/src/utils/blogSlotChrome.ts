/**
 * BlogSlot chrome shape (library/BlogSlot.astro) and the idempotent upgrade
 * of a project's copy to it. Owner 2026-09-20: pagination rendered BESIDE the
 * card because the section had been given a Flex/Grid layout in the editor —
 * its two children became row/grid items. The posts grid and the pagination
 * container now each claim a full row in every layout mode; the section
 * carries `flex-wrap` so a flex row wraps instead of sharing the line.
 * A project copy written by an older build (or by the retired August
 * host-disk writer, which left its own last bytes `on>` after </section>)
 * upgrades in place; user classes are kept, only the missing tokens are added.
 */
import { stampDocTag } from '../../../preview-template/src/plugins/sq-backdrop.js';
import { openingTagAttributes } from '../../../preview-template/src/plugins/sq-image-fill.js';
import { parseValueForm } from '../../../preview-template/src/plugins/sq-prop-fallback.js';

export const SLOT_SECTION_CLASSES = ['flex-wrap'] as const;
export const SLOT_ROW_CLASSES = ['w-full', 'basis-full', 'col-span-full'] as const;

const SECTION_TAG = /<section\b[^>]*>/;
const POSTS_TAG = /<div\b[^>]*data-blog-source="posts"[^>]*>/;
const PAGINATION_TAG = /<div\b[^>]*data-blog-source="pagination"[^>]*>/;
const CLASS_ATTR = /\sclass=(?:"([^"]*)"|'([^']*)'|\{)/;
/** The retired writer's tail: the file's own last bytes re-appended after </section>. */
const STRAY_TAIL = /(<\/section>)\s*[A-Za-z<>\/]{1,12}\s*$/;

function ensureClasses(source: string, tag: RegExp, classes: readonly string[]): string {
  const m = tag.exec(source);
  if (!m) return source;
  const open = m[0];
  const attr = CLASS_ATTR.exec(open);
  if (attr && attr[1] === undefined && attr[2] === undefined) return source; // class={expr}: not ours to rewrite
  const current = attr ? (attr[1] ?? attr[2] ?? '') : '';
  const have = new Set(current.split(/\s+/).filter(Boolean));
  const missing = classes.filter(c => !have.has(c));
  if (!missing.length) return source;
  const next = [current.trim(), ...missing].filter(Boolean).join(' ');
  const patched = attr
    ? open.replace(CLASS_ATTR, ` class="${next}"`)
    : open.replace(/^<([a-zA-Z][\w-]*)/, `<$1 class="${next}"`); // class first, like the library file
  return source.slice(0, m.index) + patched + source.slice(m.index + open.length);
}

/**
 * Stamped by the upgrade (and shipped in the library file): the chrome has
 * been applied ONCE. Without it the upgrade re-added `flex-wrap` / the row
 * tokens every time a blog page rendered — a class the user (or the AI)
 * deliberately removed came straight back (2026-10-05, fs-traced: the slot
 * upgrade's write-file 0.4 s after the edit landed).
 */
export const SLOT_CHROME_MARKER = '@sq-chrome 2';

/** The project copy in canonical shape, applied once; identical input → identical output. */
export function upgradeBlogSlotSource(source: string): string {
  if (source.includes(SLOT_CHROME_MARKER)) return source;
  let out = source;
  out = ensureClasses(out, SECTION_TAG, SLOT_SECTION_CLASSES);
  out = ensureClasses(out, POSTS_TAG, SLOT_ROW_CLASSES);
  out = ensureClasses(out, PAGINATION_TAG, SLOT_ROW_CLASSES);
  out = out.replace(STRAY_TAIL, '$1\n');
  return stampDocTag(out, SLOT_CHROME_MARKER);
}

// ---------------------------------------------------------------------------
// Per-instance layout (task-244 L8/L9): the section / posts grid / pagination
// classes read a page prop, the literal kept as the fallback — the
// overrides-in-files shape (utils/propOverrides), so a page passes
// `postsClass="…"` and the instance-class editor reuses the same prop.
// ---------------------------------------------------------------------------

const PLUMB_TAGS = [['section', SECTION_TAG, 'sectionClass'], ['posts', POSTS_TAG, 'postsClass'], ['pagination', PAGINATION_TAG, 'paginationClass']] as const;
type ClassProps = { section: string; posts: string; pagination: string };

/** The class attribute of `open`: `{ prop }` when it already reads a prop, `{ literal }`, or null for any other expression / class:list. */
function classOf(open: string): { prop: string } | { literal: string } | null {
  const attrs: Array<{ name: string; valueStart: number | null; end: number }> = openingTagAttributes(open).attributes;
  if (attrs.some((a) => a.name === 'class:list')) return null;
  const a = attrs.find((x) => x.name === 'class');
  if (!a || a.valueStart === null) return { literal: '' };
  const raw = open.slice(a.valueStart, a.end);
  if (/^["']/.test(raw)) return { literal: raw.slice(1, -1) };
  const form = parseValueForm(raw);
  return form ? { prop: form.prop } : null;
}

/** The prop each of the three elements reads, or null when any is not plumbed (or cannot be found). */
export function blogSlotClassProps(source: string): ClassProps | null {
  const out = {} as ClassProps;
  for (const [part, tag] of PLUMB_TAGS) {
    const open = tag.exec(source)?.[0];
    const c = open ? classOf(open) : null;
    if (!c || !('prop' in c)) return null;
    out[part] = c.prop;
  }
  return out;
}

/** A project BlogSlot with the three class props plumbed (rendering unchanged without a page value); null = hand-edited past recognition ("BlogSlot is custom"). Idempotent. */
export function plumbBlogSlotClasses(source: string): string | null {
  let out = source;
  for (const [, tag, prop] of PLUMB_TAGS) {
    const m = tag.exec(out);
    if (!m) return null;
    const c = classOf(m[0]);
    if (!c) return null;
    if ('prop' in c) continue;
    const attr = `class={Astro.props.${prop} ?? ${JSON.stringify(c.literal)}}`;
    const open = /\sclass=("[^"]*"|'[^']*')/.test(m[0])
      ? m[0].replace(/\sclass=("[^"]*"|'[^']*')/, ` ${attr}`)
      : m[0].replace(/^<([a-zA-Z][\w-]*)/, `<$1 ${attr}`);
    out = out.slice(0, m.index) + open + out.slice(m.index + m[0].length);
  }
  return out;
}
