/**
 * What the post header SHOWS — the same picks PostLayout.astro makes
 * (postLayoutSource.ts frontmatter script), so the writing view renders the
 * header the page will: which key is the subtitle, the byline, the cover.
 * postLayoutSource.ts interpolates these same constants (postHeaderView.test.ts).
 */
import type { PostLayoutSettings } from './postLayoutProps';
export { DEFAULT_POST_HEADER } from './postLayoutProps';

/** An explicit `subtitle` wins over the SEO `description` (same order on the page). */
export const SUBTITLE_KEYS = ['subtitle', 'description', 'excerpt'] as const;
export const COVER_KEYS = ['image', 'cover', 'heroImage', 'thumbnail'] as const;
export const DATE_KEYS = ['date', 'pubDate', 'publishDate'] as const;
export const WORDS_PER_MINUTE = 230;

/** Words of prose in a post body (imports/exports and tags dropped) — the page's reading-time count. */
export function countWords(body: string): number {
  return body.replace(/^(import|export)\s.*$/gm, ' ').replace(/<[^>]*>/g, ' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

export interface PostHeaderView {
  /** 'classic' | 'centered' | 'cover' — cover without an image falls back to classic, like the page */
  variant: PostLayoutSettings['header'];
  showSubtitle: boolean;
  showCover: boolean;
  /** author · date · N min read, already filtered by the toggles */
  meta: string[];
  /** The same parts by role (null = not drawn). `dateKey` = the key the drawn date reads — the writing view edits it there. */
  byline: { author: string | null; date: string | null; dateKey: string | null; reading: string | null };
}

const present = (v: unknown) => v !== undefined && v !== null && v !== '';

/** The subtitle key among the editable text keys: the first with a value, else the first that exists. */
export function pickSubtitleKey(frontmatter: Record<string, unknown>, textKeys: ReadonlySet<string>): string | null {
  const candidates = SUBTITLE_KEYS.filter(k => textKeys.has(k));
  return candidates.find(k => present(frontmatter[k])) ?? candidates[0] ?? null;
}

export function postHeaderView(
  frontmatter: Record<string, unknown>,
  settings: PostLayoutSettings,
  /** countWords(body) — memoize it; the body does not change on a property keystroke */
  bodyWords: number,
  hasCover: boolean,
): PostHeaderView {
  const hidden = (k: string) => frontmatter[k] === true;
  const t = settings.toggles;
  const author = t.showAuthor && !hidden('hideAuthor') ? frontmatter.author : undefined;
  const authorName = typeof author === 'string' ? author : (author as { name?: string } | undefined)?.name;
  const dateKey = t.showDate && !hidden('hideDate') ? DATE_KEYS.find(k => present(frontmatter[k])) ?? null : null;
  const date = dateKey ? new Date(frontmatter[dateKey] as string) : null;
  const dateText = date && !isNaN(date.getTime())
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    : null;
  const words = t.showReadingTime && !hidden('hideReadingTime') ? bodyWords : 0;
  const reading = words ? `${Math.max(1, Math.round(words / WORDS_PER_MINUTE))} min read` : null;
  const showCover = t.showCover && !hidden('hideCover') && hasCover;
  const byline = { author: authorName || null, date: dateText, dateKey: dateText ? dateKey : null, reading };
  return {
    variant: settings.header === 'cover' && !showCover ? 'classic' : settings.header,
    showSubtitle: t.showSubtitle && !hidden('hideSubtitle'),
    showCover,
    meta: [byline.author, byline.date, byline.reading].filter((x): x is string => !!x),
    byline,
  };
}
