/**
 * A card's per-collection field setup (design 2026-10-09-cards-any-collection
 * §2): ONE Starquix-managed block at the end of the card's frontmatter —
 *   // sq:fields — …
 *   const fields = { 'works': { title: 'title', … }, 'blog': { … } };
 *   const f = (slot: string): any => { … (<entry> as any).collection … };
 * Value 'x' = slot shows field x; '!x' = hidden (x remembered); null = unmapped.
 * Pure string transforms.
 */
import { FRONTMATTER_RE } from '@/utils/blogBinding';
import { entryVarOf, eyeOf, fieldElements, hasSetupBlock, readShow, SETUP_MARK } from '@/utils/cardFields';

export { hasSetupBlock, SETUP_MARK };
export type Setup = Map<string, Map<string, string | null>>;
const BLOCK_RE = /^[ \t]*\/\/ sq:fields[^\n]*\n[ \t]*const fields = \{\n([\s\S]*?)\n?[ \t]*\};\n[ \t]*const f = [^\n]*\n?/m;
const ROW_RE = /^\s*'([^']+)':\s*\{([^{}]*)\},?\s*$/;
const PAIR_RE = /^\s*([A-Za-z_$][\w$]*):\s*(null|'(!?[A-Za-z_$][\w$]*)')\s*$/;

/** The card's setup; null = no block (plain form); 'custom' = a block we cannot parse (hand-edited — never rewritten). */
export function readSetup(src: string): Setup | null | 'custom' {
  if (!hasSetupBlock(src)) return null;
  const body = src.match(BLOCK_RE)?.[1];
  if (body === undefined) return 'custom';
  const out: Setup = new Map();
  for (const line of body.split('\n')) {
    if (!line.trim()) continue;
    const row = line.match(ROW_RE);
    if (!row) return 'custom';
    const slots = new Map<string, string | null>();
    for (const pair of row[2].split(',').filter((p) => p.trim())) {
      const m = pair.match(PAIR_RE);
      if (!m) return 'custom';
      slots.set(m[1], m[2] === 'null' ? null : m[3]);
    }
    out.set(row[1], slots);
  }
  return out;
}

function emitBlock(setup: Setup, v: string): string {
  const rows = [...setup].map(([col, slots]) =>
    `  '${col}': { ${[...slots].map(([s, x]) => `${s}: ${x === null ? 'null' : `'${x}'`}`).join(', ')} },`);
  return `${SETUP_MARK} — what each collection shows in this card ('!x' = x hidden); Starquix keeps it in sync\n`
    + `const fields = {\n${rows.length ? `${rows.join('\n')}\n` : ''}};\n`
    // `as any`: a typed entry with a standalone fallback is a union whose sample has no `collection` (astro check TS2339).
    + `const f = (slot: string): any => { const s = (fields as Record<string, Record<string, string | null>>)[(${v} as any).collection]; const k = s ? s[slot] : slot; return k && k[0] !== '!' ? (${v}.data as Record<string, any>)[k] : undefined; };\n`;
}

/** The card with `setup` as its block (replaced in place, else appended at the end of the frontmatter). */
export function writeSetup(src: string, setup: Setup, v = entryVarOf(src)): string {
  const block = emitBlock(setup, v);
  if (BLOCK_RE.test(src)) return src.replace(BLOCK_RE, block);
  const fm = src.match(FRONTMATTER_RE);
  if (!fm) throw new Error('the card has no frontmatter');
  const close = fm[0].lastIndexOf('---');
  return src.slice(0, close) + block + src.slice(close);
}

const esc = (s: string) => s.replace(/[$]/g, '\\$&');

/**
 * Plain → block (design §2 "Promotion"). Each field element `x` reads f('x')
 * (its text child `{v.data.x}` / its `src={…}`); non-title elements are
 * guarded `{f('x') && …}` (an old value guard or eye guard is dropped — the
 * eye's value moves into the setup); `<Image>`/`<Picture>` becomes `<img>`
 * (it throws on a path string or undefined); the `show` line goes;
 * `collection` (null = unassigned) gets the identity row with show:false
 * fields as '!x'. Every other `<v>.data.y` read (attributes, custom code) is
 * left alone (D8).
 */
export function promoteCard(src: string, collection: string | null): string {
  if (hasSetupBlock(src)) return src;
  const v = entryVarOf(src);
  const show = readShow(src);
  const els = fieldElements(src, v);
  let out = src;
  for (const el of [...els].reverse()) {
    const x = esc(el.field);
    const read = String.raw`${esc(v)}\.data\.${x}`;
    // An eye outside the element (or its image box): `{show.x && …}`.
    const eye = eyeOf(out, el);
    const eyeOpen = out.slice(0, eye.start).match(new RegExp(String.raw`\{\s*show\.${x}\s*&&\s*$`));
    const eyeClose = eyeOpen ? out.slice(eye.end).match(/^\s*\}/) : null;
    let text = out.slice(el.start, el.end);
    // A guarded element `{[show.x &&] v.data.x && <el>}` → `<el>`.
    const guard = text.match(new RegExp(String.raw`^\{\s*(?:show\.${x}\s*&&\s*)?${read}\s*&&\s*`));
    if (guard) text = text.slice(guard[0].length).replace(/\s*\}$/, '');
    text = text
      .replace(new RegExp(String.raw`\bsrc=\{\s*${read}(?:\??\.src\s*\?\?\s*${read})?\s*\}`), `src={f('${el.field}')?.src ?? f('${el.field}')}`)
      .replace(new RegExp(String.raw`\{\s*${read}\s*\}`), `{f('${el.field}')}`);
    if (/^<(Image|Picture)\b/.test(text)) text = text.replace(/^<(Image|Picture)\b/, '<img').replace(/\s*(?:>\s*<\/(?:Image|Picture)\s*>|\/>)$/, ' />');
    if (el.field !== 'title') text = `{f('${el.field}') && ${text}}`;
    if (eyeOpen && eyeClose) {
      const a = eye.start - eyeOpen[0].length, b = eye.end + eyeClose[0].length;
      out = out.slice(0, a) + out.slice(eye.start, el.start) + text + out.slice(el.end, eye.end) + out.slice(b);
    } else out = out.slice(0, el.start) + text + out.slice(el.end);
  }
  out = out.replace(/^const show = \{[^}]*\};[ \t]*\r?\n/m, '');
  const setup: Setup = new Map();
  if (collection) setup.set(collection, new Map(els.map((e) => [e.field, show.get(e.field) === false ? `!${e.field}` : e.field])));
  return writeSetup(out, setup, v);
}

const TYPE_RE = /CollectionEntry<\s*["']([^"']+)["']\s*>/;
const IMPORT_LINE = "import type { CollectionEntry } from 'astro:content';";

/** Rewrite (or add) the card's `CollectionEntry<"x">` type. Throws on a card whose own Props we must not touch. */
export function setCardCollection(src: string, collection: string): string {
  const fm = src.match(FRONTMATTER_RE);
  if (!fm) throw new Error('the card has no frontmatter');
  const body = fm[1];
  const current = body.match(TYPE_RE);
  if (current) {
    if (current[1] === collection) return src;
    return src.replace(TYPE_RE, `CollectionEntry<"${collection}">`);
  }
  if (/\b(?:interface|type)\s+Props\b/.test(body)) throw new Error('this card declares its own Props — change its type in Source');
  const v = entryVarOf(src);
  const destructure = body.match(new RegExp(String.raw`^.*\{[^}]*\b${v}\b(\s*:\s*[\w$]+)?[^}]*\}\s*=\s*Astro\.props.*$`, 'm'));
  if (!destructure) throw new Error('the card does not take its entry from Astro.props');
  // A renamed prop (`post: postProp`) means the card has a standalone fallback → optional.
  const optional = destructure[1] ? '?' : '';
  let next = body.replace(destructure[0], `type Props = { ${v}${optional}: CollectionEntry<"${collection}"> };\n${destructure[0]}`);
  if (!/\bCollectionEntry\b/.test(body)) next = `${IMPORT_LINE}\n${next}`;
  return src.replace(body, next);
}


export type SlotKind = 'text' | 'image';
/** The card's slots with their kind (an <img>/<Image> element = image). */
export function slotsOf(src: string): Array<{ name: string; kind: SlotKind }> {
  return fieldElements(src).map((e) => ({ name: e.field, kind: /^\{?[^<]*<(img|Image|Picture)\b/.test(src.slice(e.start, e.end)) ? 'image' : 'text' }));
}

/**
 * The setup a card gets for a newly assigned collection (design §4): same
 * name + kind → that field; an image slot → the first image field; the title
 * → `title`, else the first text field (it never leaves a card, C6); the rest
 * unmapped (renders nothing — never crashes).
 */
export function autoSetup(slots: ReadonlyArray<{ name: string; kind: SlotKind }>, fields: ReadonlyArray<{ name: string; type: string }>): Map<string, string | null> {
  const isImage = (t: string) => t === 'image';
  const firstImage = fields.find((f) => isImage(f.type))?.name ?? null;
  const firstText = fields.find((f) => !isImage(f.type))?.name ?? null;
  return new Map(slots.map(({ name, kind }): [string, string | null] => {
    const same = fields.find((f) => f.name === name && isImage(f.type) === (kind === 'image'));
    if (same) return [name, same.name];
    if (name === 'title') return [name, fields.some((f) => f.name === 'title') ? 'title' : firstText];
    return [name, kind === 'image' ? firstImage : null];
  }));
}

const TYPE_ANY_RE = /CollectionEntry<\s*["'][^"']+["']\s*>(?:\s*\|\s*CollectionEntry<\s*["'][^"']+["']\s*>)*/;

/** The collections a card's own code assigns it to: block rows, else its CollectionEntry<"x"> type names. */
export function cardCollectionsOf(src: string): string[] {
  const s = readSetup(src);
  if (s instanceof Map) return [...s.keys()];
  return [...new Set([...src.matchAll(/CollectionEntry<\s*["']([^"']+)["']\s*>/g)].map((m) => m[1]))];
}

function setTypeUnion(src: string, cols: readonly string[]): string {
  if (cols.length === 0) return src; // L8: never delete the user's type code
  const union = cols.map((c) => `CollectionEntry<"${c}">`).join(' | ');
  return (TYPE_ANY_RE.test(src) ? src : setCardCollection(src, cols[0])).replace(TYPE_ANY_RE, union);
}

function setupOf(src: string): Setup {
  const s = readSetup(src);
  if (s === 'custom') throw new Error('its fields block was edited by hand — change it in Source');
  // L19: a slot whose element was deleted leaves every row on the next write.
  const live = new Set(slotsOf(src).map((x) => x.name));
  for (const row of s?.values() ?? []) for (const slot of row.keys()) if (!live.has(slot)) row.delete(slot);
  return s ?? new Map();
}

/**
 * Card `src` also serves `collection` (design L2/L3/L4). `current` = the
 * collection a PLAIN card serves today (type, name or usage), null when
 * unassigned. An unassigned card whose every slot the collection has stays
 * plain (just its type line); anything else is promoted.
 */
export function assignCard(src: string, collection: string, fields: ReadonlyArray<{ name: string; type: string }>, current: string | null): string {
  if (!hasSetupBlock(src)) {
    if (current === collection) return src;
    const fits = current === null && slotsOf(src).every((s) => fields.some((f) => f.name === s.name && (f.type === 'image') === (s.kind === 'image')));
    if (fits) return setCardCollection(src, collection);
    src = promoteCard(src, current);
  }
  const setup = setupOf(src);
  if (setup.has(collection)) return src;
  const row = autoSetup(slotsOf(src), fields);
  // A slot no collection shows (hidden/unmapped in every row — e.g. one added
  // by an eye for another collection) stays hidden here: a name match is not a
  // design choice (owner 2026-10-11: a raw `date` line appeared on works).
  for (const [slot, field] of row) {
    if (slot === 'title' || !field || field.startsWith('!') || !setup.size) continue;
    if ([...setup.values()].every((r) => { const x = r.get(slot); return !x || x.startsWith('!'); })) row.set(slot, `!${field}`);
  }
  setup.set(collection, row);
  return setTypeUnion(writeSetup(src, setup), [...setup.keys()]);
}

function rowOf(setup: Setup, col: string): Map<string, string | null> {
  const row = setup.get(col);
  if (!row) throw new Error(`this card is not set up for ${col}`);
  return row;
}
const TITLE_STAYS = 'the title can never leave a card';

/** Block form: slot `slot` shows `field` (null = unmapped) for `col` only. */
export function setSlotField(src: string, col: string, slot: string, field: string | null): string {
  if (slot === 'title' && (field === null || field.startsWith('!'))) throw new Error(TITLE_STAYS);
  const setup = setupOf(src);
  rowOf(setup, col).set(slot, field);
  return writeSetup(src, setup);
}

/** Block form: per field of `col` — shown by a slot (on-card) or remembered by a hidden one. */
export function fieldStatesIn(src: string, col: string): Map<string, 'on-card' | 'hidden'> {
  const s = readSetup(src);
  const out = new Map<string, 'on-card' | 'hidden'>();
  // A row whose element was deleted no longer counts (owner 2026-10-11: a
  // deleted preview2 kept its Fields row until the next setup write).
  const live = new Set(slotsOf(src).map((x) => x.name));
  for (const [slot, x] of (s instanceof Map ? s.get(col) : undefined) ?? []) {
    if (!x || !live.has(slot)) continue;
    if (x[0] === '!') { if (!out.has(x.slice(1))) out.set(x.slice(1), 'hidden'); } else out.set(x, 'on-card');
  }
  return out;
}

/**
 * Block form eye for `field` in `col`: off = every slot showing it → '!field';
 * on = every '!field' slot back, else a NEW slot element (mapped here, null in
 * every other collection — L18).
 */
export function setFieldVisibleIn(src: string, col: string, field: string, visible: boolean, type = 'text'): string {
  const setup = setupOf(src);
  const row = rowOf(setup, col);
  if (!visible && row.get('title') === field) throw new Error(TITLE_STAYS);
  const from = visible ? `!${field}` : field;
  const to = visible ? field : `!${field}`;
  let hit = false;
  for (const [slot, x] of row) if (x === from) { row.set(slot, to); hit = true; }
  // Owner 2026-10-11: never a made-up element — no slot shows `field` → no-op.
  return hit ? writeSetup(src, setup) : src;
}
