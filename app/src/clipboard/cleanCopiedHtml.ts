// Regex-based ON PURPOSE (same rule as stripSqIds / the override helpers):
// copied strings may carry Astro expressions a DOMParser round-trip would mangle.
export const STRIP_ATTRS = [
  'data-key', 'data-sq-id', 'data-sq-source', 'data-sq-placement',
  'data-sq-p', 'data-sq-lp', 'data-sq-lq', 'data-sq-usage',
  'data-sq-source-version', 'data-sq-usage-version',
  'data-astro-source-file', 'data-astro-source-loc',
  'contenteditable',
  'data-sq-selection-highlight', 'data-sq-post-slug', 'data-sq-post-link',
  'data-sq-blog-placeholder', 'data-sq-blog-clone',
  'data-sq-ai-busy', 'data-sq-ai-orig', 'data-sq-ai-typing', 'data-sq-ai-preview',
  'data-sq-ai-preview-content', 'data-sq-ai-preview-badge', 'data-sq-ai-active',
  'data-sq-ai-highlight',
] as const;

const STRIP_RE = new RegExp(
  `\\s(?:${STRIP_ATTRS.join('|')})(?=[\\s=>/])(?:="[^"]*"|='[^']*')?`,
  'g',
);

export function cleanCopiedHtml(html: string): string {
  return html.replace(STRIP_RE, '');
}
