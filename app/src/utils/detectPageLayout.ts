// Pure + dependency-light (no writers, no window): the files-truth driver's
// on-open migrations import it before any editor module exists.
import { FRONTMATTER_RE } from '@/utils/blogBinding';

export interface DetectedLayout {
  name: string;
  importPath: string;
}

/**
 * The page's current layout, detected from the file itself: a frontmatter
 * default import from a layouts/ path whose component tag wraps the whole
 * template body (opening tag first, closing tag last — or one self-closing
 * tag on an empty page).
 * // ponytail: default imports only — a renamed/named layout import is not
 * // detected and reads as "no layout" (apply then confirms before wrapping).
 */
export function detectPageLayout(source: string): DetectedLayout | null {
  const fm = source.match(FRONTMATTER_RE);
  if (!fm) return null;
  const body = source.slice(fm[0].length).trim();
  for (const m of fm[1].matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]*layouts\/[^'"]+)['"]/g)) {
    const [, name, spec] = m;
    const opens = new RegExp(`^<${name}[\\s/>]`).test(body);
    if (!opens) continue;
    if (body.endsWith(`</${name}>`)) return { name, importPath: spec };
    if (new RegExp(`^<${name}\\b[^<]*/>$`).test(body)) return { name, importPath: spec };
  }
  return null;
}
