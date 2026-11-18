/**
 * Shared constants for SEO panel sections.
 *
 * Keeps visual consistency across all sections and avoids
 * duplicating the same Tailwind class strings in every file.
 */

/** Classes applied to the expandable Row wrapper on every section header. */
export const SECTION_ROW_CLS = 'pl-1 pr-0';

/** Classes applied to the section icon inside every header Row. */
export const SECTION_ICON_CLS = 'w-4 h-4 text-text-muted group-hover:text-text transition-colors';

/** Classes applied to the content container inside every expanded section. */
export const SECTION_CONTENT_CLS = 'space-y-1 pl-7 pr-8 pb-2';

export { shownValue } from '@/store/seo/pageSeoScore';
