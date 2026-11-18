import { SKIP_TAGS } from '@/store/constants';

/**
 * Find an element in staticMarkup by its selector (e.g., "img-0", "section-1").
 * Parses the selector as "tagName-index", uses DOMParser to parse the HTML,
 * then returns the Nth element matching that tag.
 *
 * Returns null if the selector is invalid, the tag doesn't exist, or the index is out of range.
 */
// Single-slot parse cache: divergence selectors re-query the SAME markup for
// every selector on every doc update — without this, each query re-runs a
// full DOMParser over multi-KB markup on keystroke/drag hot paths.
let lastParsedMarkup: string | null = null;
let lastParsedDoc: Document | null = null;
function parseMarkup(staticMarkup: string): Document {
  if (staticMarkup !== lastParsedMarkup) {
    lastParsedMarkup = staticMarkup;
    lastParsedDoc = new DOMParser().parseFromString(staticMarkup, 'text/html');
  }
  return lastParsedDoc!;
}

export function findElementBySelectorInMarkup(staticMarkup: string, selector: string): Element | null {
  const tagMatch = selector.match(/^([a-z][a-z0-9]*)-(\d+)$/i);
  if (!tagMatch) return null;
  const [, tag, indexStr] = tagMatch;
  const idx = parseInt(indexStr, 10);

  const doc = parseMarkup(staticMarkup);
  const elements = doc.querySelectorAll(tag);
  if (idx >= elements.length) return null;
  return elements[idx];
}

/**
 * Get the original `class` attribute value for a selector (`tag-index`) within staticMarkup.
 *
 * Uses DOMParser instead of regex so it correctly handles edge cases the previous
 * regex implementation got wrong: escaped quotes inside attributes, multi-line
 * `class="..."` declarations, nested elements, missing class attribute, attribute
 * order independence, and elements without a data-key.
 *
 * Selector format mirrors `addDataKeysToHtml` numbering: tags listed in SKIP_TAGS
 * (svg internals, script, style) do not contribute to the index and are skipped
 * here as well, keeping selector counts in sync with the data-key stamper.
 *
 * Returns the literal class attribute string (possibly empty) when found, or `''`
 * when the selector cannot be resolved (matching legacy behavior so callers
 * downstream do not need to special-case `null`).
 */
export function getOriginalClassesFromMarkup(staticMarkup: string, selector: string): string {
  const tagMatch = selector.match(/^([a-z][a-z0-9]*)-(\d+)$/i);
  if (!tagMatch) return '';
  const [, rawTag, indexStr] = tagMatch;
  const tag = rawTag.toLowerCase();
  if ((SKIP_TAGS as readonly string[]).includes(tag)) return '';
  const idx = parseInt(indexStr, 10);
  if (!Number.isFinite(idx) || idx < 0) return '';

  let doc: Document;
  try {
    doc = parseMarkup(staticMarkup);
  } catch {
    return '';
  }

  // Walk in document order, counting only tags that addDataKeysToHtml would have keyed.
  // querySelectorAll(tag) is case-insensitive in HTML mode and yields document order.
  const candidates = doc.querySelectorAll(tag);
  if (idx >= candidates.length) return '';
  const el = candidates[idx];
  return el.getAttribute('class') ?? '';
}
