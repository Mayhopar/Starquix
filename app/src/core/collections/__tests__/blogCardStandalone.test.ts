// Local-mode materialize copies library blog components VERBATIM into real
// Astro projects. BlogSlot's slot fallback invokes <BlogCard /> with NO post
// prop — the library source must therefore be standalone-safe: a bare
// invocation may never throw. (Live incident 2026-08-22: post.data TypeError
// crashed the user's /blog page the moment BlogSlot was dropped.)
// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readFieldBinding } from '../../../utils/fieldBinding';

const LIB = resolve(__dirname, '../../../../../preview-template/src/components/library');

const frontmatter = (file: string): string => {
  const raw = readFileSync(resolve(LIB, file), 'utf8');
  const m = raw.match(/^---([\s\S]*?)---/);
  return m ? m[1] : '';
};

describe('library blog components are standalone-safe', () => {
  it('BlogCard guards the post prop with a fallback before the template derefs it', () => {
    const fm = frontmatter('BlogCard.astro');
    // The template reads post.data.* — the frontmatter must give `post` a
    // fallback value so <BlogCard /> (BlogSlot's slot fallback) cannot throw.
    expect(fm).toMatch(/const post = \w+ \?\?/);
  });

  it('pagination components take no REQUIRED props (task-240: page / pageSize are optional)', () => {
    expect(frontmatter('BlogPaginationNumbered.astro')).toMatch(/const \{ page \} = Astro\.props/);
    expect(frontmatter('BlogPaginationLoadMore.astro')).toMatch(/const \{ pageSize = 3 \} = Astro\.props/);
  });

  // task-240: the post LINK is page markup around the card (`<a … class="block">
  // <BlogCard post={post} /></a>`) so an imported site's own card links too —
  // the library card itself must never wrap itself in an anchor (nesting).
  it('BlogCard never links itself — the bound page wraps it in the post link', () => {
    const raw = readFileSync(resolve(LIB, 'BlogCard.astro'), 'utf8');
    expect(raw.replace(/^---[\s\S]*?---/, '')).not.toMatch(/<a\b/);
    expect(frontmatter('BlogCard.astro')).not.toContain('href');
  });

  // Owner report 2026-09-12: "I upload an image to the post, the card doesn't
  // show it" — the scaffold declares `image` in the collection schema, so the
  // card it materializes ships with its image box ALREADY bound to that field
  // (the canonical bound-box form the DesignBar reads back), never a
  // placeholder the user has to know to bind. `?.` keeps a post without the
  // field (and the standalone fallback) from crashing the render.
  it('BlogCard ships its image box bound to the `image` field, crash-proof', () => {
    const raw = readFileSync(resolve(LIB, 'BlogCard.astro'), 'utf8');
    const box = raw.match(/<div class="aspect-video[^"]*">[\s\S]*?<\/div>/)?.[0] ?? '';
    expect(readFieldBinding(box, 'div')).toBe('image');
    expect(box).toContain('post.data.image?.src ?? post.data.image');
    expect(raw).not.toContain('post.data.image.src');
    expect(raw).not.toContain('thumbnail');
  });
});
