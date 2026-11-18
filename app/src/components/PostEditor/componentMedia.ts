/**
 * The MEDIA-SLOT model for a component INVOCATION in a post body (the
 * `astroComponent` node's `source` string). Runtime-agnostic on purpose: the
 * same string is edited in WC and in local mode, and nothing here touches a
 * filesystem, an iframe or a doc.
 *
 * A component exposes its media through exactly ONE of two shapes, and the
 * shape is read from the invocation, never guessed:
 *
 *   1. ARRAY shape — `items={[…]}`. N slots in one attribute, and the COUNT is
 *      a user knob (1 ↔ 2 ↔ 3 media). This is the system Media component's
 *      contract (preview-template/src/components/Media.astro, promoted to
 *      src/components/sq/Media.astro). Semantics here are unchanged from the
 *      original build — the alt-array test pins that only `items` is rewritten.
 *   2. NAMED shape — media-named attributes (`src`, `src1`/`src2`/`src3`,
 *      `poster`, `image`, …). The component DECLARED those props; the count is
 *      fixed by its own markup, so slot i rewrites the i-th named attribute and
 *      we never add an attribute the component does not read.
 *
 * Anything else — no recognizable media attribute, or an `items`/attribute
 * value that is an EXPRESSION rather than a string literal — is reported as
 * NOT EDITABLE (`null`). Refusing is the point: writing a brand-new
 * `items={[…]}` onto a component that only reads `src1`/`src2` changed the
 * .mdx on disk while the render stayed byte-identical, so the upload looked
 * like it did nothing and the placeholder was permanent (owner report,
 * 2026-08-11). A tile the writer cannot fill must never open, which is why
 * `readMediaSlots` (what the UI shows) and `editMediaItem` (what the writer
 * does) are derived from the SAME read.
 *
 * Known limit, deliberate: a bare promoted tag (`<Portrait />`) declares media
 * props in its own frontmatter but carries no attribute here, so it reports
 * not-editable. Making it editable needs the component's manifest
 * (`core/manifest`), which this module is not given — that is the extension
 * point (an optional declared-props argument), not a reason to guess. The `/`
 * menu inserts user components as bare tags, so insert-then-upload for a
 * promoted user component does not work yet: `readMediaSlots` would have to be
 * called as `readMediaSlots(source, declaredMediaProps)` with the names read
 * from the component file, and the named-shape writer would ADD the attribute
 * instead of only rewriting one that is already there.
 *
 * THIS MODULE IS THE ONE SLOT MODEL. Nothing else may parse an invocation's
 * media: a second parser in tiptap/schema.ts disagreed with this one about
 * which attribute backs slot i, so the tiles the user clicked and the attribute
 * the writer rewrote were different attributes — clicking the empty tile of
 * `<Trio src1="a" src3="c"/>` overwrote the third image (2026-08-12 review).
 */
import { manifestFromFrontmatter } from '@/core/manifest/parseManifest';

const ITEMS_RE = /items\s*=\s*\{\s*\[([\s\S]*?)\]\s*\}/;

/**
 * The system Media component is the ONE component whose declared props we own,
 * so it is the only one allowed to GAIN an `items` attribute it does not have
 * yet (legacy invocations; the slash menu inserts `items={[null]}` already).
 */
const ARRAY_SHAPE_TAG = /^\s*<Media\b/;

/**
 * Is this attribute name a media path? Answered by the MANIFEST parser
 * (`core/manifest/parseManifest`), the single owner of media-name knowledge
 * (task-207 D2: `src1` is a `slot` control BY NAME). Probing it with a
 * one-prop destructuring keeps ONE parser — a second copy of its name list
 * here would drift the day someone adds `@media` or a new name to it.
 */
const mediaNameCache = new Map<string, boolean>();

export function isMediaPropName(name: string): boolean {
  const hit = mediaNameCache.get(name);
  if (hit !== undefined) return hit;
  let is = false;
  if (/^[A-Za-z_]\w*$/.test(name)) {
    const { props } = manifestFromFrontmatter(`const { ${name} } = Astro.props`);
    is = props[0]?.control.kind === 'slot';
  }
  mediaNameCache.set(name, is);
  return is;
}

interface Attr {
  name: string;
  /** The string-literal value, or null when the value is an expression. */
  value: string | null;
  /** Span of the value INCLUDING its quotes/braces, within the opening tag. */
  start: number;
  end: number;
}

/** Index just past the `}` matching the `{` at `open`, or -1. Quote-aware. */
function matchBrace(tag: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < tag.length; i++) {
    const c = tag[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * The ROOT element's opening tag only. Children are off-limits: a
 * `<CreditWrapper><Credit src="…"/></CreditWrapper>` must not have the child's
 * attribute read as the wrapper's slot, nor rewritten by a slot edit.
 */
function openingTag(source: string): string | null {
  const head = source.match(/^\s*<[A-Z][\w.]*/);
  if (!head) return null;
  let quote = '';
  let depth = 0;
  for (let i = head[0].length; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; continue; }
    if (c === '>' && depth === 0) return source.slice(0, i + 1);
  }
  return null;
}

/**
 * Attributes of the opening tag. The scanner jumps PAST each value, so an
 * expression's interior (`onClick={() => { src = "x" }}`) can never be
 * mistaken for an attribute.
 */
function scanAttributes(tag: string): Attr[] {
  const head = tag.match(/^\s*<[A-Z][\w.]*/);
  if (!head) return [];
  const out: Attr[] = [];
  const nameRe = /([A-Za-z_][\w:.-]*)\s*=\s*/g;
  nameRe.lastIndex = head[0].length;
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(tag)) !== null) {
    const start = m.index + m[0].length;
    const ch = tag[start];
    if (ch === '"' || ch === "'") {
      const close = tag.indexOf(ch, start + 1);
      if (close < 0) break;
      out.push({ name: m[1], value: tag.slice(start + 1, close), start, end: close + 1 });
      nameRe.lastIndex = close + 1;
    } else if (ch === '{') {
      const close = matchBrace(tag, start);
      if (close < 0) break;
      out.push({ name: m[1], value: null, start, end: close + 1 });
      nameRe.lastIndex = close + 1;
    } else {
      break; // valueless / malformed — stop rather than resync onto garbage
    }
  }
  return out;
}

const baseName = (n: string) => n.replace(/\d+$/, '');
const slotNumber = (n: string) => {
  const m = n.match(/(\d+)$/);
  return m ? Number(m[1]) : 0;
};

/**
 * Slot ORDER for the named shape: families in first-appearance order, and
 * inside a family by its 1-based number. `src1`/`src2` → slots 0/1 whatever
 * order they were written in; a lone `src` is slot 0; `poster` is its own slot
 * after `src` in `<SingleVideo src="…" poster="…" />`.
 */
function orderNamed(attrs: Attr[]): Attr[] {
  const firstOfBase = new Map<string, number>();
  attrs.forEach((a, i) => {
    const b = baseName(a.name);
    if (!firstOfBase.has(b)) firstOfBase.set(b, i);
  });
  return attrs
    .map((a, i) => ({ a, i }))
    .sort((x, y) =>
      firstOfBase.get(baseName(x.a.name))! - firstOfBase.get(baseName(y.a.name))! ||
      slotNumber(x.a.name) - slotNumber(y.a.name) ||
      x.i - y.i,
    )
    .map(e => e.a);
}

export type MediaShape = 'items' | 'named';

export interface MediaSlots {
  shape: MediaShape;
  /** Current path per slot; null = empty (unset, `null` entry, or `""`). */
  slots: (string | null)[];
  /** Attribute backing each slot — empty for the array shape. */
  names: string[];
  /** The slot COUNT is a user knob for the array shape only. */
  countEditable: boolean;
}

/** Entries of `items={[…]}`; null when an entry is an expression. */
function parseItemEntries(inner: string): (string | null)[] | null {
  const trimmed = inner.trim();
  if (trimmed === '') return [];
  const out: (string | null)[] = [];
  for (const raw of trimmed.split(',')) {
    const piece = raw.trim();
    if (piece === '') continue;
    if (piece === 'null' || piece === 'undefined') {
      out.push(null);
      continue;
    }
    const str = piece.match(/^(['"])([\s\S]*)\1$/);
    if (!str) return null;
    out.push(str[2]);
  }
  return out;
}

/**
 * THE read every media UI and every media write goes through: the shape, the
 * per-slot current path and whether the count is editable. `null` = this
 * invocation has no editable media surface, so no tile may open for it.
 */
export function readMediaSlots(source: string): MediaSlots | null {
  if (!/^\s*<[A-Z]/.test(source)) return null;

  // Array shape first: a component carrying `items` owns its media there even
  // if it also takes an unrelated `poster`.
  if (/\bitems\s*=/.test(source)) {
    const match = source.match(ITEMS_RE);
    if (!match) return null; // `items={expr}` — the user's code, not ours
    const entries = parseItemEntries(match[1]);
    if (entries === null) return null;
    return { shape: 'items', slots: entries, names: [], countEditable: true };
  }

  const tag = openingTag(source);
  const media = tag ? scanAttributes(tag).filter(a => isMediaPropName(a.name)) : [];
  if (media.length > 0) {
    // One expression-valued media attr poisons the whole invocation, exactly
    // as one expression entry poisons an items array: we would otherwise show
    // a tile whose write target is the user's own code.
    if (media.some(a => a.value === null)) return null;
    const ordered = orderNamed(media);
    return {
      shape: 'named',
      slots: ordered.map(a => (a.value === '' ? null : a.value)),
      names: ordered.map(a => a.name),
      countEditable: false,
    };
  }

  // No media attribute at all: only the system Media component may still gain
  // one, because `items` is a prop we know it declares.
  if (ARRAY_SHAPE_TAG.test(source)) {
    return { shape: 'items', slots: [], names: [], countEditable: true };
  }
  return null;
}

/**
 * Current media paths per slot, or null when this invocation is not editable.
 * Kept as the module's original public name: callers (PostBodyEditor,
 * DesignBar/MediaBlock, core/postmedia) index it by slot.
 */
export function parseMediaItems(source: string): (string | null)[] | null {
  return readMediaSlots(source)?.slots ?? null;
}

/**
 * The slots a UI must DRAW, in slot order. `readMediaSlots().slots` with ONE
 * adaptation: an array-shape invocation carrying no entries still renders one
 * media box (`Media.astro`: `count = Math.max(items.length, 1)`), so it offers
 * the one slot `editMediaItem(source, 0, …)` grows into. Reader and writer stay
 * derived from the same read — a tile that opens is a tile the writer can fill.
 */
export function displayMediaSlots(source: string): (string | null)[] | null {
  const read = readMediaSlots(source);
  if (read === null) return null;
  return read.shape === 'items' && read.slots.length === 0 ? [null] : read.slots;
}

/**
 * The URL the EDITOR PAGE can load for a media path, or null when there is
 * none. Three cases, and the third is why this exists:
 *
 *   - absolute (`https://…`, `data:…`, `//cdn/…`) — loadable as written;
 *   - root-relative (`/uploads/x.png`) — the preview INSTANCE serves it, so it
 *     needs that instance's origin (identical in WC and local: both hand the
 *     editor an origin whose `/uploads/*` the browser can load as an image);
 *   - anything else (`./images/timepad/hero.png`, `../a.png`) — Astro resolves
 *     these through its asset pipeline into a hashed `/@fs/…?origWidth=…` URL
 *     that nothing here can reconstruct. Emitting `<img src="./images/…">` from
 *     the EDITOR page 404s, and that is real content, not a corner case
 *     (Timepad-Redesign.mdx is written entirely this way). The honest answer is
 *     null and the caller shows a neutral pending frame.
 */
export function previewUrlFor(src: string | null | undefined, origin: string | null): string | null {
  if (!src) return null;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) return src;
  if (src.startsWith('/')) return origin ? origin.replace(/\/+$/, '') + src : null;
  return null;
}

const serializeItems = (entries: (string | null)[]) =>
  `items={[${entries.map(e => (e == null ? 'null' : `"${e}"`)).join(', ')}]}`;

/**
 * "Only images can be set up to be full width or not" (owner): the width
 * control belongs to MEDIA components only — text-ish components (credits,
 * wrappers) keep the centered measure.
 *
 * Media = the ROOT invocation carries a media attribute, by the SAME name
 * authority `readMediaSlots` uses. The old hardcoded `items|src|src1|poster`
 * list silently excluded a `src2`-only or `image=`-only invocation from every
 * media affordance, which is the original bug's own shape (a component that
 * plainly holds media, treated as if it held none).
 *
 * Deliberately WIDER than `readMediaSlots`: an expression-valued `items={photos}`
 * is media the editor cannot rewrite, but width is a CLASS edit and stays
 * available. Heuristic until a component capability manifest exists — a user
 * component with an unrelated `src=` prop gets the (harmless) width control.
 */
export function isMediaComponent(source: string): boolean {
  if (/\bitems\s*=/.test(source) || ARRAY_SHAPE_TAG.test(source)) return true;
  const tag = openingTag(source);
  return tag !== null && scanAttributes(tag).some(a => isMediaPropName(a.name));
}

/** Why a slot write is refused. The UI turns this into a sentence. */
export type MediaWriteBlock = 'expression' | 'no-media' | 'out-of-range' | 'unsafe-path';

/**
 * Why `editMediaItem` would refuse THIS write, or null when it will go through.
 * `editMediaItem` is implemented on top of it, so the reason the UI states and
 * the decision the writer makes cannot drift — the previous build guessed the
 * reason from the source string and told the user "this component doesn't take
 * media from an items list" when the real cause was an out-of-range index.
 */
export function mediaWriteBlock(
  source: string,
  index: number,
  src: string | null,
): MediaWriteBlock | null {
  const read = readMediaSlots(source);
  if (read === null) return isMediaComponent(source) ? 'expression' : 'no-media';
  if (!Number.isInteger(index) || index < 0) return 'out-of-range';
  // A quote or backslash would break out of the attribute / the array literal
  // and stop the page rendering. Refused for BOTH shapes: an `items={["a"b"]}`
  // is as fatal as a broken attribute, and a refusal the user can read beats
  // markup that blanks the post.
  if (src !== null && /["\\]/.test(src)) return 'unsafe-path';
  // Named shape: the component declared its props, so slot i must already
  // exist — inventing `src3` on a two-image component writes a dead prop, the
  // exact failure the owner reported. The array shape grows on purpose (1↔2↔3).
  if (read.shape === 'named' && read.names[index] === undefined) return 'out-of-range';
  return null;
}

/**
 * Set the LAYOUT MODE: 1, 2 or 3 media pieces. Array shape only — a named-shape
 * component's slot count is fixed by its own markup, so this returns null and
 * the UI must hide the control (`readMediaSlots().countEditable`).
 * Existing entries are kept up to the new count; growth pads null placeholders.
 */
export function setMediaItemCount(source: string, count: number): string | null {
  const read = readMediaSlots(source);
  if (read === null || read.shape !== 'items') return null;
  const next = read.slots.slice(0, count);
  while (next.length < count) next.push(null);
  return ITEMS_RE.test(source)
    ? source.replace(ITEMS_RE, serializeItems(next))
    : source.replace(/^(\s*<[A-Za-z0-9_]+)/, `$1 ${serializeItems(next)}`);
}

/**
 * Write ONE slot. Every other attribute passes through verbatim — a previous
 * build destroyed the alt array while replacing one image, and the named shape
 * holds the same bar (only the one attribute's value moves).
 *
 * - array shape: setting an index past the end GROWS the array (1 ↔ 2 ↔ 3).
 * - named shape: an out-of-range index is refused — inventing `src3` on a
 *   two-image component writes a prop it never reads.
 * - clearing (`src === null`) empties the value rather than deleting the
 *   attribute, so the slot (and its tile) survives and can be re-filled.
 *
 * Returns null when the markup can't be edited safely — `mediaWriteBlock` says
 * WHICH case it was, and is the gate this writer runs.
 */
export function editMediaItem(source: string, index: number, src: string | null): string | null {
  if (mediaWriteBlock(source, index, src) !== null) return null;
  const read = readMediaSlots(source)!;

  if (read.shape === 'items') {
    const entries = read.slots.slice();
    while (entries.length <= index) entries.push(null);
    entries[index] = src;
    return ITEMS_RE.test(source)
      ? source.replace(ITEMS_RE, serializeItems(entries))
      : // No items attribute yet: right after the tag name, so the tag's own
        // formatting and every other attribute stay where they were.
        source.replace(/^(\s*<[A-Za-z0-9_]+)/, `$1 ${serializeItems(entries)}`);
  }

  const name = read.names[index];
  const tag = openingTag(source)!;
  const attr = scanAttributes(tag).find(a => a.name === name)!;
  const rewritten = tag.slice(0, attr.start) + `"${src ?? ''}"` + tag.slice(attr.end);
  return rewritten + source.slice(tag.length);
}
