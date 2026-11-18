/**
 * Pure staticMarkup helpers — string/markup utilities for instance
 * staticMarkup (the saved source-HTML snapshot of a component instance).
 * Extracted verbatim from ClassStoreContext (godfile decomposition Phase C).
 *
 * These are REGEX-BASED ON PURPOSE for non-DOM string markup that may lack
 * data-key attributes (they run it through addDataKeyToMarkup first). The
 * DOMParser-based sibling is utils/markupQuery.ts — do not merge them unless
 * semantic equivalence is proven (design §5.2 / open question 2).
 */
import { addDataKeysToHtml } from '@/store/constants';
import { escapeRegex } from '@/utils/regex';
import { findElementBySelectorInMarkup } from '@/utils/markupQuery';

/**
 * Add data-key attributes to all elements in HTML.
 * Used to process legacy staticMarkup that doesn't have data-key attributes.
 * Note: This adds simple selectors without instanceId prefix - just for lookup purposes.
 */
export function addDataKeyToMarkup(html: string): string {
  return addDataKeysToHtml(html, (sel) => sel, true);
}

/**
 * Get an original HTML attribute from staticMarkup for a selector.
 * Uses DOMParser for reliable extraction (regex is too fragile for HTML).
 * Selector format: "tag-index" (e.g., "img-0", "section-0").
 * Exported for direct testing (task-049 II-3).
 */
export function getOriginalAttributeFromMarkup(staticMarkup: string, selector: string, attribute: string): string | null {
  try {
    const el = findElementBySelectorInMarkup(staticMarkup, selector);
    return el ? el.getAttribute(attribute) : null;
  } catch {
    return null;
  }
}

/**
 * Same as getOriginalAttributeFromMarkup, but observable on failure: the
 * undo-restore paths used to silently no-op when no element existed at the
 * selector, leaving the iframe showing the removed override (task-049 II-3).
 */
export function getOriginalAttributeOrWarn(
  staticMarkup: string,
  selector: string,
  attribute: string,
  restoreKey: string,
): string | null {
  const original = getOriginalAttributeFromMarkup(staticMarkup, selector, attribute);
  if (original === null) {
    console.warn(
      `[ClassStore] cannot restore original ${attribute} — no element at selector`,
      selector,
      'for',
      restoreKey,
    );
  }
  return original;
}

/**
 * Get the original text content from staticMarkup for a selector within an instance.
 * Parses the staticMarkup HTML to find the element with data-key ending in ":selector".
 */
export function getOriginalTextFromMarkup(staticMarkup: string, selector: string): string {
  // Process markup to ensure all elements have data-key
  const processedMarkup = addDataKeyToMarkup(staticMarkup);

  // Extract the tag name from selector (e.g., "h1-0" -> "h1")
  const tagMatch = selector.match(/^([a-z]+)-\d+$/i);
  if (!tagMatch) return '';

  const tagName = tagMatch[1].toLowerCase();
  const escapedSelector = escapeRegex(selector);

  // Pattern to find the element by data-key and extract its content
  // Matches both "instanceId:selector" and simple "selector" formats
  const pattern = new RegExp(
    `<${tagName}[^>]*data-key=["'][^"']*:?${escapedSelector}["'][^>]*>([\\s\\S]*?)</${tagName}>`,
    'i'
  );

  const match = processedMarkup.match(pattern);
  if (match) {
    // Strip any nested HTML tags to get just the text
    return match[1].replace(/<[^>]+>/g, '').trim();
  }

  return '';
}

/**
 * HTML void elements that cannot have children or closing tags.
 * Used by getSelectorsWithDescendants to avoid searching for non-existent closing tags.
 */
export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img',
  'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

/**
 * Get all selectors from staticMarkup that are descendants of the given selector.
 * If selector is null, returns all selectors (for resetting entire instance).
 * Returns array including the selector itself and all its descendants.
 *
 * Uses a simple stack-based parser to understand DOM hierarchy.
 */
export function getSelectorsWithDescendants(staticMarkup: string, targetSelector: string | null): string[] {
  // Process markup to ensure all elements have data-key
  const processedMarkup = addDataKeyToMarkup(staticMarkup);

  // Extract all data-key values with their positions
  // Pattern matches both "selector" and "instanceId:selector" formats
  const selectorPositions: Array<{ selector: string; start: number; end: number }> = [];
  const dataKeyPattern = /<(\w+)[^>]*data-key=["']([^"']+)["'][^>]*>/gi;
  let match;

  while ((match = dataKeyPattern.exec(processedMarkup)) !== null) {
    const tagName = match[1].toLowerCase();
    // Extract selector - handles both "selector" and "instanceId:selector" formats
    const rawValue = match[2];
    const selector = rawValue.includes(':') ? rawValue.split(':').pop()! : rawValue;
    const startPos = match.index;

    // Void elements (img, br, hr, input, etc.) cannot have children.
    // Their range is just the opening tag — no closing tag to search for.
    if (VOID_ELEMENTS.has(tagName)) {
      selectorPositions.push({ selector, start: startPos, end: startPos + match[0].length });
      continue;
    }

    // Count nesting to find the correct closing tag
    let depth = 1;
    let searchPos = startPos + match[0].length;
    let endPos = processedMarkup.length;

    const openingPattern = new RegExp(`<${tagName}(?:\\s|>)`, 'gi');
    const closingPattern = new RegExp(`</${tagName}>`, 'gi');

    while (depth > 0 && searchPos < processedMarkup.length) {
      openingPattern.lastIndex = searchPos;
      closingPattern.lastIndex = searchPos;

      const nextOpen = openingPattern.exec(processedMarkup);
      const nextClose = closingPattern.exec(processedMarkup);

      if (!nextClose) break;

      if (nextOpen && nextOpen.index < nextClose.index) {
        depth++;
        searchPos = nextOpen.index + nextOpen[0].length;
      } else {
        depth--;
        if (depth === 0) {
          endPos = nextClose.index + nextClose[0].length;
        }
        searchPos = nextClose.index + nextClose[0].length;
      }
    }

    selectorPositions.push({ selector, start: startPos, end: endPos });
  }

  // If no target selector, return all selectors
  if (targetSelector === null) {
    return selectorPositions.map(sp => sp.selector);
  }

  // Find the target selector's range
  const target = selectorPositions.find(sp => sp.selector === targetSelector);
  if (!target) {
    // Target not found, return just the target (might be dynamically generated)
    return [targetSelector];
  }

  // Return target + all selectors contained within its range
  return selectorPositions
    .filter(sp => sp.start >= target.start && sp.end <= target.end)
    .map(sp => sp.selector);
}
