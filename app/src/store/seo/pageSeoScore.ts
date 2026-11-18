/**
 * How ready a page is for search results and share cards — over the fields
 * that change them (design §3). Scores what the page will SHOW: its own value,
 * else the layout default it inherits.
 */
import type { PageSeoState, SeoFieldState } from './headSeo';

export interface PageSeoScore {
  percentage: number;
  color: 'green' | 'yellow' | 'red';
  /** The most valuable thing left to do, or null. */
  hint: string | null;
  /** Every open item, most valuable first (read_page_seo returns them). */
  todo: Array<{ field: string; label: string }>;
}

export const TITLE_MAX = 60;
export const DESCRIPTION_MAX = 160;

/** What the page shows for a field: its own value, else what it inherits. */
export function shownValue(st: SeoFieldState): string {
  return (typeof st.value === 'string' && st.value) || st.placeholder || '';
}

export function scorePageSeo(state: PageSeoState): PageSeoScore {
  const shown = (k: keyof PageSeoState['fields']) => shownValue(state.fields[k]);
  const title = shown('title'), description = shown('description'), image = shown('image');
  const checks: Array<{ ok: boolean; weight: number; field: string; label: string }> = [
    { ok: !!title, weight: 3, field: 'title', label: 'Add a title' },
    { ok: !!description, weight: 3, field: 'description', label: 'Add a description' },
    { ok: !!image, weight: 2, field: 'image', label: 'Add a share image' },
    { ok: !image || !!shown('imageAlt'), weight: 1, field: 'imageAlt', label: 'Describe the share image' },
    { ok: title.length <= TITLE_MAX, weight: 1, field: 'title', label: `Shorten the title to ${TITLE_MAX} characters` },
    { ok: description.length <= DESCRIPTION_MAX, weight: 1, field: 'description', label: `Shorten the description to ${DESCRIPTION_MAX} characters` },
  ];
  const max = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const percentage = Math.round((got / max) * 100);
  const todo = checks.filter((c) => !c.ok).sort((a, b) => b.weight - a.weight).map(({ field, label }) => ({ field, label }));
  if (state.fields.noindex.value === true) todo.unshift({ field: 'noindex', label: 'Hidden from search engines' });
  return { percentage, color: percentage >= 90 ? 'green' : percentage >= 60 ? 'yellow' : 'red', hint: todo[0]?.label ?? null, todo };
}
