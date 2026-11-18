/** The writing view's header shows what PostLayout shows (owner 2026-09-30: "make it look as close as possible"). */
import { describe, it, expect } from 'vitest';
import { postHeaderView, pickSubtitleKey, countWords, SUBTITLE_KEYS, COVER_KEYS, DATE_KEYS, WORDS_PER_MINUTE, DEFAULT_POST_HEADER } from '../postHeaderView';
import { postLayoutSource } from '../postLayoutSource';

const quoted = (keys: readonly string[]) => keys.map(k => `'${k}'`).join(', ');

describe('postHeaderView', () => {
  it('uses the same key lists as the PostLayout the page renders', () => {
    const src = postLayoutSource(null);
    expect(src).toContain(`pick(${quoted(SUBTITLE_KEYS)})`);
    expect(src).toContain(`pick(${quoted(COVER_KEYS)})`);
    expect(src).toContain(`pick(${quoted(DATE_KEYS)})`);
    expect(src).toContain(`words / ${WORDS_PER_MINUTE}`);
  });
  it('subtitle = description when the post has one (the showcase post: the editor showed none)', () => {
    const text = new Set(['title', 'description', 'subtitle']);
    expect(pickSubtitleKey({ description: 'Five days…' }, text)).toBe('description');
    expect(pickSubtitleKey({ subtitle: 'x', description: 'seo' }, text)).toBe('subtitle'); // explicit subtitle wins
    expect(pickSubtitleKey({}, text)).toBe('subtitle');
    expect(pickSubtitleKey({}, new Set(['title']))).toBeNull();
  });
  it('byline + toggles + per-post hide flags', () => {
    const fm = { author: { name: 'Ada' }, date: '2026-09-28' };
    const v = postHeaderView(fm, DEFAULT_POST_HEADER, countWords('word '.repeat(500)), true);
    expect(v.meta).toEqual(['Ada', 'Sep 28, 2026', '2 min read']);
    const off = { ...DEFAULT_POST_HEADER, toggles: { ...DEFAULT_POST_HEADER.toggles, showAuthor: false } };
    expect(postHeaderView(fm, off, 0, true).meta).toEqual(['Sep 28, 2026']);
    expect(postHeaderView({ ...fm, hideDate: true }, DEFAULT_POST_HEADER, 0, true).meta).toEqual(['Ada']);
  });
  it('names the key the byline date reads (the writing view edits it there), only when it draws it', () => {
    expect(postHeaderView({ pubDate: '2026-09-28' }, DEFAULT_POST_HEADER, 0, true).byline).toMatchObject({ date: 'Sep 28, 2026', dateKey: 'pubDate' });
    // the page picks the first present key; it cannot draw 'soon', so nothing is drawn or edited there
    expect(postHeaderView({ date: 'soon', pubDate: '2026-09-28' }, DEFAULT_POST_HEADER, 0, true).byline).toMatchObject({ date: null, dateKey: null });
    expect(postHeaderView({ date: '2026-09-28', hideDate: true }, DEFAULT_POST_HEADER, 0, true).byline.dateKey).toBeNull();
  });
  it('cover variant without an image falls back to classic; showCover off hides it', () => {
    const cover = { ...DEFAULT_POST_HEADER, header: 'cover' as const };
    expect(postHeaderView({}, cover, 0, false)).toMatchObject({ variant: 'classic', showCover: false });
    expect(postHeaderView({}, cover, 0, true)).toMatchObject({ variant: 'cover', showCover: true });
    const noCover = { ...DEFAULT_POST_HEADER, toggles: { ...DEFAULT_POST_HEADER.toggles, showCover: false } };
    expect(postHeaderView({}, noCover, 0, true).showCover).toBe(false);
  });
});
