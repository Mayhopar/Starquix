/**
 * Shared constants and utilities for the editor store.
 */

/** Ephemeral page ID for the single-component editor view. */
export const COMPONENT_EDITOR_PAGE_ID = '__component-editor';

/**
 * Tags to skip when processing staticMarkup for data-key attributes.
 * Non-visual tags and SVG INTERNALS. Root <svg> is deliberately keyable —
 * shapes are content and get a Layers row like <img> (2026-07-24).
 */
export const SKIP_TAGS = [
  'script',
  'style',
  'path',
  'circle',
  'rect',
  'line',
  'polygon',
  'polyline',
  'ellipse',
  'text',
  'tspan',
  'g',
  'defs',
  'clippath',
  'mask',
  'use',
  'symbol',
  'pattern',
  'lineargradient',
  'radialgradient',
  'stop',
  'marker',
  // Nested-component placeholder (componentPlaceholders.ts wire format) — never
  // selectable; stamping would also corrupt its data-sq-* attrs.
  'sq-child',
] as const;

/**
 * Strip all data-key attributes from an HTML string.
 */
export function stripDataKeys(html: string): string {
  return html.replace(/\s*data-key="[^"]*"/g, '');
}

/**
 * Selector of a markup's ROOT element in the canonical `<tag>-<index>` scheme
 * (the first tag is always occurrence 0 — same vocabulary as addDataKeysToHtml
 * and vite-plugin/key-to-position). Null when no tag is found.
 */
export function rootSelectorForMarkup(markup: string): string | null {
  const tag = /<([a-zA-Z][\w-]*)/.exec(markup)?.[1]?.toLowerCase();
  return tag ? `${tag}-0` : null;
}

/**
 * Extract the class attribute value from the Nth occurrence of a given tag in HTML markup.
 * Returns null if the tag or index is not found.
 */
export function extractClassByTagIndex(
  markup: string,
  tagName: string,
  tagIndex: number
): string | null {
  const regex = new RegExp(`<${tagName}[^>]*\\bclass="([^"]*)"`, 'gi');
  let count = 0;
  let match;
  while ((match = regex.exec(markup)) !== null) {
    if (count === tagIndex) {
      return match[1];
    }
    count++;
  }
  return null;
}

/**
 * Add data-key attributes to all elements in HTML markup.
 * Handles both regular tags (`<div>`) and self-closing tags (`<img />`).
 *
 * @param html - The HTML string to process
 * @param makeKey - Function that receives a selector (e.g. "div-0") and returns the data-key value
 * @param skipExisting - If true, skip elements that already have a data-key attribute
 */
export function addDataKeysToHtml(
  html: string,
  makeKey: (selector: string) => string,
  skipExisting?: boolean
): string {
  const tagCounts: Record<string, number> = {};

  // Tag pattern allows hyphens: `<sq-child>` used to half-match as tag `sq`,
  // splicing the data-key MID-TAG (`<sq data-key=…-child`) and corrupting it.
  return html.replace(/<([a-zA-Z][\w-]*)([^>]*?)(\s*\/?>)/gi, (match, tag, attrs, close) => {
    const tagLower = tag.toLowerCase();
    if (SKIP_TAGS.includes(tagLower as typeof SKIP_TAGS[number])) return match;
    if (skipExisting && attrs && /data-key\s*=/.test(attrs)) return match;

    const index = tagCounts[tagLower] || 0;
    tagCounts[tagLower] = index + 1;
    const selector = `${tagLower}-${index}`;
    const dataKey = ` data-key="${makeKey(selector)}"`;

    // Strip any existing data-key so re-stamping replaces rather than
    // emits a duplicate attribute (browser keeps the first, the second
    // becomes silent dead weight in source files like generated post pages).
    const cleanedAttrs = attrs.replace(/\s+data-key\s*=\s*"[^"]*"/gi, '');

    return `<${tag}${dataKey}${cleanedAttrs}${close}`;
  });
}
