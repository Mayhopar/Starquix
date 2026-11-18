/**
 * Add data-key attributes to HTML elements that don't have them.
 * Uses format: tagName-N (e.g., div-0, p-1, span-2)
 */

const SKIP_TAGS = new Set([
  'script', 'style', 'link', 'meta', 'title', 'head', 'html', 'body',
  'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'g', 'defs', 'use',
  'br', 'hr', 'img', 'input', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr'
]);

export function addDataKeys(html: string): string {
  // Track existing data-key values to avoid duplicates
  const existingKeys = new Set<string>();
  const keyRegex = /data-key="([^"]+)"/g;
  let match;
  while ((match = keyRegex.exec(html)) !== null) {
    existingKeys.add(match[1]);
  }

  // Track counts per tag for generating unique keys
  const tagCounts: Record<string, number> = {};

  // Match opening tags (not self-closing, not already having data-key)
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?(\/?)>/g;

  return html.replace(tagPattern, (fullMatch, tagName, attrs = '', selfClose) => {
    const tagLower = tagName.toLowerCase();

    // Skip certain tags
    if (SKIP_TAGS.has(tagLower)) {
      return fullMatch;
    }

    // Skip if already has data-key
    if (attrs && attrs.includes('data-key=')) {
      return fullMatch;
    }

    // Skip self-closing tags
    if (selfClose === '/') {
      return fullMatch;
    }

    // Generate unique key
    const count = tagCounts[tagLower] || 0;
    tagCounts[tagLower] = count + 1;

    let key = `${tagLower}-${count}`;
    // Ensure uniqueness
    while (existingKeys.has(key)) {
      tagCounts[tagLower]++;
      key = `${tagLower}-${tagCounts[tagLower] - 1}`;
    }
    existingKeys.add(key);

    // Insert data-key attribute
    if (attrs) {
      return `<${tagName}${attrs} data-key="${key}">`;
    } else {
      return `<${tagName} data-key="${key}">`;
    }
  });
}
