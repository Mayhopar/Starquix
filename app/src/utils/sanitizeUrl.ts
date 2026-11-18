/**
 * Sanitize a URL by blocking dangerous schemes (javascript:, vbscript:, file:, data:text/html).
 * Returns the trimmed URL, empty string for falsy input, or null for blocked URLs.
 */

const DANGEROUS_SCHEMES = /^(javascript|vbscript|file):|^data:text\/html/i;

export function sanitizeUrl(url: string): string | null {
  if (!url) return '';
  const trimmed = url.trim();
  if (DANGEROUS_SCHEMES.test(trimmed)) return null;
  return trimmed;
}
