/**
 * The `<PostLayout …>` invocation in a post route ↔ its settings (design A3).
 * Pure: read the open tag's attributes, rewrite ONLY that tag canonically.
 * Defaults are omitted (header="classic", every show* true), so an untouched
 * route stays `<PostLayout post={post}>`.
 */
export type PostHeader = 'classic' | 'centered' | 'cover';
export const POST_TOGGLES = ['showSubtitle', 'showAuthor', 'showDate', 'showReadingTime', 'showCover'] as const;
export type PostToggle = typeof POST_TOGGLES[number];
export interface PostLayoutSettings { header: PostHeader; toggles: Record<PostToggle, boolean> }
/** What an untouched `<PostLayout post={post}>` means: classic, everything shown. */
export const DEFAULT_POST_HEADER: PostLayoutSettings = {
  header: 'classic',
  toggles: Object.fromEntries(POST_TOGGLES.map(t => [t, true])) as Record<PostToggle, boolean>,
};

const OPEN = /<PostLayout\b([^>]*?)(\/?)>/;
const HEADERS: readonly PostHeader[] = ['classic', 'centered', 'cover'];

export function readPostLayoutSettings(route: string): PostLayoutSettings | null {
  const m = OPEN.exec(route);
  if (!m) return null;
  const attrs = m[1];
  const header = /\bheader=["'](\w+)["']/.exec(attrs)?.[1] as PostHeader | undefined;
  const toggles = Object.fromEntries(POST_TOGGLES.map(t => {
    const v = new RegExp(`\\b${t}(?:=\\{(true|false)\\}|=["'](true|false)["'])?(?=[\\s/>]|$)`).exec(attrs);
    return [t, v ? (v[1] ?? v[2] ?? 'true') !== 'false' : true];
  })) as Record<PostToggle, boolean>;
  return { header: header && HEADERS.includes(header) ? header : DEFAULT_POST_HEADER.header, toggles };
}

/** null = no `<PostLayout` open tag, or an attribute we don't model (never corrupt it). */
export function writePostLayoutSettings(route: string, next: PostLayoutSettings): string | null {
  const m = OPEN.exec(route);
  if (!m) return null;
  const known = new RegExp(`^(post=\\{post\\}|header=["']\\w+["']|(${POST_TOGGLES.join('|')})(=\\{(true|false)\\}|=["'](true|false)["'])?)$`);
  const parts = m[1].trim().split(/\s+/).filter(Boolean);
  if (!parts.every(p => known.test(p))) return null;
  const attrs = ['post={post}'];
  if (next.header !== 'classic') attrs.push(`header="${next.header}"`);
  for (const t of POST_TOGGLES) if (!next.toggles[t]) attrs.push(`${t}={false}`);
  return route.slice(0, m.index) + `<PostLayout ${attrs.join(' ')}${m[2] ? ' /' : ''}>` + route.slice(m.index + m[0].length);
}

/** The selected placement is OUR PostLayout (either location) → show its settings. */
export const isPostLayoutFile = (file: string | null | undefined): boolean =>
  !!file && /(^|\/)src\/layouts\/(sq\/)?PostLayout\.astro$/.test(file);
