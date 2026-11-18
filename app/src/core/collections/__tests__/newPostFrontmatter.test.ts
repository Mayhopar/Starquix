// Regression for the local-mode "add a post blanks the whole preview" bug
// (2026-08-14): the hardcoded {title, date, description} triple ignored the
// collection's real shape. A files-truth project whose schema requires e.g.
// `pubDate: z.coerce.date()` got a post without it → InvalidContentEntryDataError
// → Astro's error overlay covered every route. A new post must be shaped like
// the EXISTING posts: every inferred field present with a type-correct default.
import { describe, it, expect } from 'vitest';
import { newPostFrontmatter } from '../content-ops';
import type { PostMeta } from '../types';

const post = (frontmatter: Record<string, unknown>): PostMeta => ({
  slug: 's',
  frontmatter,
  body: '',
  filePath: 'src/content/blog/s.md',
});

describe('newPostFrontmatter', () => {
  it('fills every field the existing posts carry, with type-correct defaults', () => {
    const fm = newPostFrontmatter([
      post({ title: 'First', pubDate: '2026-01-01', description: 'hello', draft: false, tags: ['a'] }),
    ]);
    expect(fm.title).toBe('');
    expect(fm.pubDate).toMatch(/^\d{4}-\d{2}-\d{2}$/); // date default = today, not '' (z.coerce.date('') is Invalid)
    expect(fm.description).toBe('');
    expect(fm.draft).toBe(false);
    expect(fm.tags).toEqual([]);
  });

  it('title is always present and empty (editor autofocuses it)', () => {
    const fm = newPostFrontmatter([post({ pubDate: '2026-01-01' })]);
    expect(fm.title).toBe('');
  });

  it('leaves the reserved slug override absent so each new filename supplies its own slug', () => {
    const source = post({ title: 'First', slug: 'custom-first', description: 'hello' });
    expect(newPostFrontmatter([source])).toEqual({ title: '', description: '' });
    expect(source.frontmatter.slug).toBe('custom-first');
  });

  it('empty collection falls back to the title/date/description triple', () => {
    const fm = newPostFrontmatter([]);
    expect(Object.keys(fm).sort()).toEqual(['date', 'description', 'title']);
    expect(fm.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
