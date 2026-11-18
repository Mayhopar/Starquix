/**
 * Page-anatomy order for picker categories (⌘K v2 design 2026-07-09).
 * These are the REAL @category names from preview-template/src/components/library.
 */
export const CATEGORY_ANATOMY_ORDER = [
  'Header', 'Hero', 'Logos', 'Feature', 'Metrics', 'Testimonials',
  'Team', 'Pricing', 'FAQ', 'CTA', 'Blog', 'Embed', 'Media', 'Forms', 'Footer',
] as const;

/**
 * Anatomy first (fixed sequence), unknown categories alphabetical after
 * Footer, then 'Layouts', then 'Project' (theme categories are appended by
 * the caller after these — see pickerCategories.ts).
 */
export function orderCategories(names: string[]): string[] {
  const remaining = new Set(names);
  const out: string[] = [];
  for (const n of CATEGORY_ANATOMY_ORDER) {
    if (remaining.delete(n)) out.push(n);
  }
  const hasLayouts = remaining.delete('Layouts');
  const hasProject = remaining.delete('Project');
  out.push(...[...remaining].sort());
  if (hasLayouts) out.push('Layouts');
  if (hasProject) out.push('Project');
  return out;
}
