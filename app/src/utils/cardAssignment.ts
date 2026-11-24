/**
 * Card ↔ collection assignment (design 2026-10-09-collection-cards-design §5,
 * C11). The assignment IS the card's type line `CollectionEntry<"x">`; nothing
 * else stores it. Pure functions over file sources.
 */
import { cardTagsOf, FRONTMATTER_RE, importStatementRe, parseBlogBindings, renameCardTags, resolveImportPath, slotSpans, type EmitOptions } from '@/utils/blogBinding';
import { CARD_FILE, cardCollectionOf, cardLinksItself, cardNameFor, DEFAULT_CARD, entryVarOf, isCardSource } from '@/utils/cardFields';
import { importSpecifierFor } from '@/utils/localStructural';
import { assignCard, cardCollectionsOf, setCardCollection } from '@/utils/cardSetup';

export { setCardCollection };


/** The one collection a file feeds its components: its own `getCollection('x')`, or — a list, not a card — its `CollectionEntry<"x">` type (WorkList). */
export function fedCollection(src: string): string | null {
  const fetched = new Set([...src.matchAll(/\bgetCollection\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
  if (fetched.size === 1) return [...fetched][0];
  if (fetched.size === 0 && !isCardSource(src)) return cardCollectionOf(src);
  return null;
}

/** [tag name, resolved file] of every imported component the file's template renders. */
export function renderedComponents(file: string, src: string): Array<[string, string]> {
  const template = src.slice(src.match(FRONTMATTER_RE)?.[0].length ?? 0);
  const out = new Map<string, string>();
  for (const m of template.matchAll(/<([A-Z][\w$]*)\b/g)) {
    const spec = src.match(importStatementRe(m[1]))?.[1];
    if (spec?.startsWith('.')) out.set(m[1], resolveImportPath(file, spec));
  }
  return [...out];
}

/**
 * component file → collections whose entries a page/list renders it with: a
 * file fetching exactly ONE collection, or a list typed for one (posts reach
 * WorkCard through WorkList's props). Two = ambiguous. Includes non-card
 * components (Layout, BlogSlot) — callers look up card files only.
 */
export function usageCollections(files: Record<string, string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [file, src] of Object.entries(files)) {
    const collection = fedCollection(src);
    if (!collection) continue;
    for (const [, card] of renderedComponents(file, src)) (out.get(card) ?? out.set(card, new Set()).get(card)!).add(collection);
  }
  return out;
}

/** The prop a card takes its entry by (`post` for `{ post: postProp }`, `work` for `{ work }`). */
export function entryPropOf(src: string): string {
  const v = entryVarOf(src);
  const fm = src.match(FRONTMATTER_RE)?.[1] ?? '';
  for (const part of fm.match(/\{([^}]*)\}\s*=\s*Astro\.props/)?.[1].split(',') ?? []) {
    const [key, binding = key] = part.split(':').map((x) => x.trim().replace(/\s*=.*$/, ''));
    if (key === v || binding === v) return key;
  }
  return v;
}

/** How a page renders `cardFile` in a Blog slot — its import, the prop it takes its entry by, whether it links itself (bind, quiet re-emit and the list converter all ask this). */
export function cardEmitOptions(pageFile: string, cardFile: string, cardSrc: string | null): EmitOptions {
  return { cardImport: importSpecifierFor(pageFile, cardFile), cardProp: cardSrc ? entryPropOf(cardSrc) : undefined, cardLinks: cardSrc ? cardLinksItself(cardSrc) : undefined };
}

/**
 * Listing card pick (design 2026-10-09-cards-any-collection §3, L21): the
 * listing(s) fetching `collection` — only `onlyFile` when given (Blog Settings
 * → Card is per listing) — render `cardFile` instead of their card (import,
 * tag and entry prop swapped: `<BlogCard post={post} />` → `<WorkCard
 * work={post} />`), and the card is assigned to the collection first when it
 * is not (utils/cardSetup.assignCard: unmapped fields hidden, mapped ones
 * guarded — it never crashes on the new posts). `current` = the collection a
 * plain card serves today (default: its own type). Returns ONLY the files
 * that change; `listings` = the rewired files.
 */
export function planCardMove(
  files: Record<string, string>, cardFile: string, collection: string,
  fields: ReadonlyArray<{ name: string; type: string }> = [],
  { onlyFile, current, slot, missing }: { onlyFile?: string; current?: string | null; slot?: number; /** deleted card files the listing still renders — swapped too */ missing?: ReadonlySet<string> } = {},
): { writes: Record<string, string>; listings: string[] } {
  const cardSrc = files[cardFile];
  if (cardSrc == null) throw new Error('the card file could not be read');
  const name = cardFile.replace(/^.*\//, '').replace(/\.astro$/, '');
  const prop = entryPropOf(cardSrc);
  const writes: Record<string, string> = {};
  for (const [file, src] of Object.entries(files)) {
    if (file === cardFile || (onlyFile && file !== onlyFile) || !/\bgetCollection\(/.test(src)) continue;
    // One slot of a multi-slot page (task-244 L19): only THAT block's card swaps.
    const span = slot === undefined ? undefined : slotSpans(src)[slot];
    const fed = slot === undefined ? fedCollection(src) : span && parseBlogBindings(src)[slot]?.collection;
    if (fed !== collection) continue;
    const fmLen = src.match(FRONTMATTER_RE)?.[0].length ?? 0;
    const [from, to] = span ? [span.start, span.end] : [fmLen, src.length];
    let fm = src.slice(0, fmLen);
    const head = src.slice(fmLen, from), foot = src.slice(to);
    let tpl = src.slice(from, to);
    const ownImport = fm.match(importStatementRe(name))?.[1];
    if (ownImport && resolveImportPath(file, ownImport) !== cardFile) continue; // ponytail: name taken by another component — leave the file
    let swapped = false;
    for (const [tag, target] of renderedComponents(file, fm + tpl)) {
      const gone = !!missing?.has(target) && files[target] == null;
      if (target === cardFile || (!gone && (files[target] == null || !isCardSource(files[target])))) continue;
      tpl = renameCardTags(tpl, tag, name, gone ? null : entryPropOf(files[target]), prop);
      // The old card's import goes only when no other slot still renders it.
      if (!new RegExp(String.raw`<${tag}\b`).test((head + tpl + foot).replace(/<!--[\s\S]*?-->|\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ''))) fm = fm.replace(new RegExp(String.raw`^[ \t]*import\s+${tag}\s+from\s+['"][^'"]+['"];?[ \t]*\r?\n`, 'm'), '');
      swapped = true;
    }
    if (!swapped) continue;
    if (!ownImport) {
      const line = `import ${name} from '${importSpecifierFor(file, cardFile)}';\n`;
      const lastImport = [...fm.matchAll(/^[ \t]*import\b.*$/gm)].pop();
      fm = lastImport ? fm.slice(0, lastImport.index! + lastImport[0].length) + '\n' + line.trimEnd() + fm.slice(lastImport.index! + lastImport[0].length)
        : fm.replace(/^---[ \t]*\r?\n/, (m) => m + line);
    }
    writes[file] = fm + head + tpl + foot;
  }
  const listings = Object.keys(writes);
  const card = assignCard(cardSrc, collection, fields, current === undefined ? cardCollectionsOf(cardSrc)[0] ?? null : current);
  if (card !== cardSrc) writes[cardFile] = card;
  return { writes, listings };
}


/**
 * Delete `cardFile` (owner 2026-10-10): every Blog slot rendering it switches to
 * another card serving that slot's collection (typed first), else the Blog's
 * basic BlogCard (added from the library when the project lacks it) — the
 * deletion and the rewiring are ONE batch. `null` = the file is deleted.
 */
export function planCardDelete(files: Readonly<Record<string, string>>, cardFiles: readonly string[],
  assignments: ReadonlyMap<string, CardAssignment>, fieldsOf: (collection: string) => ReadonlyArray<{ name: string; type: string }>,
  { knownFieldsOnly = false }: { /** skip a slot whose collection's fields are not known yet (never map blind) */ knownFieldsOnly?: boolean } = {}): Record<string, string | null> {
  const gone = new Set(cardFiles);
  const next: Record<string, string> = { ...files };
  for (const f of gone) delete next[f];
  const writes: Record<string, string | null> = {};
  const replacementFor = (collection: string) => {
    const serving = [...assignments].filter(([f, a]) => a.card && a.collections.includes(collection) && next[f] != null);
    return (serving.find(([, a]) => a.typed === collection) ?? serving[0])?.[0] ?? CARD_FILE;
  };
  for (const page of Object.keys(files).filter((f) => f.startsWith('src/pages/'))) {
    for (const b of parseBlogBindings(next[page])) {
      const span = slotSpans(next[page])[b.slot];
      const fmLen = next[page].match(FRONTMATTER_RE)?.[0].length ?? 0;
      const renders = renderedComponents(page, next[page].slice(0, fmLen) + next[page].slice(span.start, span.end)).some(([, f]) => gone.has(f));
      if (!b.collection || !renders || (knownFieldsOnly && !fieldsOf(b.collection).length)) continue;
      const replacement = replacementFor(b.collection);
      if (next[replacement] == null) next[replacement] = writes[replacement] = DEFAULT_CARD;
      const plan = planCardMove(next, replacement, b.collection, fieldsOf(b.collection),
        { onlyFile: page, slot: b.slot, current: assignments.get(replacement)?.collections[0] ?? null, missing: gone });
      Object.assign(next, plan.writes);
      Object.assign(writes, plan.writes);
    }
  }
  for (const f of gone) if (f in files) writes[f] = null;
  return writes;
}

/**
 * Blog slots rendering a card file that no longer exists (deleted outside the
 * delete gesture — the owner's site 2026-10-10) switch cards by the same rule
 * as planCardDelete. `exists` = the project's component files on disk.
 */
export function planMissingCards(files: Readonly<Record<string, string>>, exists: (file: string) => boolean,
  assignments: ReadonlyMap<string, CardAssignment>, fieldsOf: (collection: string) => ReadonlyArray<{ name: string; type: string }>): Record<string, string> {
  const missing = new Set<string>();
  for (const page of Object.keys(files).filter((f) => f.startsWith('src/pages/'))) {
    const src = files[page];
    const cardTags = new Set(slotSpans(src).flatMap((sp) => cardTagsOf(src.slice(sp.start, sp.end))));
    const fm = src.match(FRONTMATTER_RE)?.[0] ?? '';
    for (const [, f] of renderedComponents(page, fm + [...cardTags].map((t) => `<${t} />`).join(''))) if (f.startsWith('src/components/') && !exists(f)) missing.add(f);
  }
  if (!missing.size) return {};
  return planCardDelete(files, [...missing], assignments, fieldsOf, { knownFieldsOnly: true }) as Record<string, string>; // nothing missing is in `files`: no null
}

export interface CardAssignment {
  /** A card (renders ONE entry it is handed — Fields, eyes, title lock) vs a related component (a list, a post layout). */
  card: boolean;
  /** The collections it serves (any number; [] = an unassigned card, design L1). */
  collections: string[];
  /** The collection its type line names (may be missing on disk), else null. */
  typed: string | null;
  /** Collections it is rendered with that are not its own — a real bug in the site. */
  conflict: string[];
}

/**
 * THE assignment rule (the only place it lives), over every component:
 * - a card: its own code (fields-block rows, else its CollectionEntry type
 *   union — design 2026-10-09-cards-any-collection) > card name (`WorksCard` /
 *   `WorksPostCard`; `blog` owns `BlogCard`, C1) > the one collection it is
 *   rendered with > unassigned ([]);
 * - any other component: its type (`CollectionEntry<"x">[]`) or its own one
 *   `getCollection('x')`, else none (absent from the map). Never by usage: a
 *   page fetching `works` also renders its chrome (Main, Header) — those are
 *   not works components.
 */
export function assignCards({ components, usage, collections }: {
  components: Record<string, string>; usage: ReadonlyMap<string, ReadonlySet<string>>; collections: readonly string[];
}): Map<string, CardAssignment> {
  const out = new Map<string, CardAssignment>();
  for (const [file, src] of Object.entries(components)) {
    const card = isCardSource(src);
    const used = [...(usage.get(file) ?? [])].filter((c) => collections.includes(c));
    let typed = cardCollectionOf(src);
    if (!card && !typed) {
      const fetched = new Set([...(src.match(FRONTMATTER_RE)?.[1] ?? '').matchAll(/\bgetCollection\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]));
      if (fetched.size === 1) typed = [...fetched][0];
    }
    const base = file.replace(/^.*\//, '').replace(/\.astro$/, '');
    const named = card ? collections.find((c) => base === cardNameFor(c) || base === cardNameFor(c).replace(/Card$/, 'PostCard')) : undefined;
    if (!card) {
      if (typed && collections.includes(typed)) out.set(file, { card, collections: [typed], typed, conflict: [] });
      continue;
    }
    // A card serves every collection its own code names (block rows / type union, L9: existing ones only).
    const own = cardCollectionsOf(src).filter((c) => collections.includes(c));
    const list = own.length ? own : named ? [named] : used.length === 1 ? [used[0]] : [];
    out.set(file, { card, collections: list, typed, conflict: used.filter((c) => !list.includes(c)) });
  }
  return out;
}
