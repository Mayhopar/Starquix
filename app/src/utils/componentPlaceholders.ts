/**
 * Nested-component placeholder primitives (task-098). A parent master stores
 * nested components as `<sq-child>` wire-format tags instead of frozen inlined
 * child HTML:
 *
 *   <sq-child data-sq-astro-source="…/BlogCard.astro" data-sq-placement="posts"
 *             data-sq-slot-fallback="posts"></sq-child>
 *
 * `data-sq-slot-fallback` is present only when the component tag sat inside a
 * `<slot name="…">` fallback; then `data-sq-placement` equals the slot name.
 * Non-slot placements key as `${lowername}-${occurrenceIndex}` (header-0).
 */
import * as Y from 'yjs';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { selectMasterMarkup, selectMasterChildOverrides } from '@/store/masters';
import { applyChildOverrideClasses } from './childOverrideClasses';


export interface ChildPlacement {
  name: string;
  path: string;
  placementKey: string;
  slotFallback?: string;
}

const SLOT_SPAN_RE = /<slot\b([^>]*)>([\s\S]*?)<\/slot>/gi;
const SLOT_NAME_ATTR_RE = /\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/i;
/** THE <sq-child> tag matcher — this module owns the wire format; import, don't fork. */
export const SQ_CHILD_RE = /<sq-child\b([^>]*?)\/>|<sq-child\b([^>]*)>\s*<\/sq-child>/gi;

export function attrOf(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return m?.[1];
}

function placeholderTag(path: string, placementKey: string, slotFallback?: string): string {
  const slotAttr = slotFallback ? ` data-sq-slot-fallback="${slotFallback}"` : '';
  return `<sq-child data-sq-astro-source="${path}" data-sq-placement="${placementKey}"${slotAttr}></sq-child>`;
}

/**
 * Component tags (`<BlogCard />`, `<Header class=… />`) → `<sq-child>`
 * placeholders + placement list. Same tag-match semantics as
 * expandComponentTags (canvasHtml.ts) — opening/self-closing tag only.
 */
export function extractComponentPlaceholders(
  html: string,
  library: ScannedComponent[],
): { html: string; placements: ChildPlacement[] } {
  const byName = new Map<string, ScannedComponent>();
  for (const c of library) {
    if (c.html) byName.set(c.name, c);
  }
  const present = new Set<string>();
  for (const match of html.matchAll(/<([A-Z][A-Za-z0-9_]*)\b/g)) {
    if (byName.has(match[1])) present.add(match[1]);
  }
  if (present.size === 0) return { html, placements: [] };

  // Named-slot fallback spans: component tags inside them key by slot name.
  const slotSpans: Array<{ start: number; end: number; name: string }> = [];
  for (const sm of html.matchAll(SLOT_SPAN_RE)) {
    const nameMatch = sm[1].match(SLOT_NAME_ATTR_RE);
    const name = (nameMatch?.[1] ?? nameMatch?.[2] ?? '').trim();
    if (name) slotSpans.push({ start: sm.index!, end: sm.index! + sm[0].length, name });
  }

  const placements: ChildPlacement[] = [];
  const counters = new Map<string, number>();
  const re = new RegExp(`<(${Array.from(present).join('|')})\\b[^>]*\\/?>`, 'g');
  const out = html.replace(re, (full, name: string, offset: number) => {
    const comp = byName.get(name)!;
    const span = slotSpans.find((s) => offset > s.start && offset < s.end);
    if (span) {
      placements.push({ name, path: comp.path, placementKey: span.name, slotFallback: span.name });
      return placeholderTag(comp.path, span.name, span.name);
    }
    const n = counters.get(name) ?? 0;
    counters.set(name, n + 1);
    const key = `${name.toLowerCase()}-${n}`;
    placements.push({ name, path: comp.path, placementKey: key });
    return placeholderTag(comp.path, key);
  });
  return { html: out, placements };
}

/**
 * Expand every `<sq-child>` inline: base = masters[childPath].markup ?? library
 * html, then apply the parent's childOverrides[placementKey]. Recurses (a child
 * master may itself hold placeholders); a path already in the ancestry chain is
 * a cycle → replaced by '' + console.warn. Missing child → '' + warn.
 */
export function expandPlaceholders(
  doc: Y.Doc,
  markup: string,
  parentAstroSource: string,
  library: ScannedComponent[],
): string {
  return expandWithAncestry(doc, markup, parentAstroSource, library, new Set([parentAstroSource]));
}

function expandWithAncestry(
  doc: Y.Doc,
  markup: string,
  parentAstroSource: string,
  library: ScannedComponent[],
  ancestry: Set<string>,
): string {
  if (!markup.includes('<sq-child')) return markup;
  const parentOverrides = selectMasterChildOverrides(doc, parentAstroSource);
  return markup.replace(SQ_CHILD_RE, (_full, selfAttrs: string, openAttrs: string) => {
    const attrs = selfAttrs ?? openAttrs ?? '';
    const path = attrOf(attrs, 'data-sq-astro-source');
    const placementKey = attrOf(attrs, 'data-sq-placement');
    if (!path || !placementKey) return '';
    if (ancestry.has(path)) {
      console.warn(`[componentPlaceholders] cycle: ${path} already in ancestry — dropped`);
      return '';
    }
    const base = selectMasterMarkup(doc, path) ?? library.find((c) => c.path === path)?.html;
    if (base === undefined) {
      console.warn(`[componentPlaceholders] no master or library entry for ${path} — dropped`);
      return '';
    }
    const layered = applyChildOverrideClasses(base, parentOverrides[placementKey]);
    return expandWithAncestry(doc, layered, path, library, new Set(ancestry).add(path));
  });
}
