/**
 * Auto-rename a NEW post's file to its title ("The MDX file takes the name of
 * the title"). resolveRenamedSlug is THE decision function: it may only ever
 * offer a rename for an untitled-* .mdx file (a user's own file is never
 * touched, and a post renamed once no longer matches — stable URLs).
 */
import { describe, it, expect } from 'vitest';
import { resolveRenamedSlug } from '../renamePost';

const base = {
  fileName: 'untitled-1786224810096.mdx',
  oldSlug: 'untitled-1786224810096',
  existingSlugs: ['untitled-1786224810096'],
};

describe('resolveRenamedSlug', () => {
  it('slugifies the title via THE shared slugify', () => {
    expect(resolveRenamedSlug({ ...base, title: 'My First Post' })).toBe('my-first-post');
    expect(resolveRenamedSlug({ ...base, title: '  Q&A: Stuff!  ' })).toBe('q-a-stuff');
  });

  it('appends -2 on a collision, case-insensitively', () => {
    expect(
      resolveRenamedSlug({
        ...base,
        title: 'My First Post',
        existingSlugs: [...base.existingSlugs, 'MY-FIRST-POST'],
      }),
    ).toBe('my-first-post-2');
  });

  it('keeps counting past -2', () => {
    expect(
      resolveRenamedSlug({
        ...base,
        title: 'My First Post',
        existingSlugs: [...base.existingSlugs, 'my-first-post', 'my-first-post-2'],
      }),
    ).toBe('my-first-post-3');
  });

  it('empty, whitespace, or non-string title → null', () => {
    expect(resolveRenamedSlug({ ...base, title: '' })).toBeNull();
    expect(resolveRenamedSlug({ ...base, title: '   ' })).toBeNull();
    expect(resolveRenamedSlug({ ...base, title: undefined })).toBeNull();
    expect(resolveRenamedSlug({ ...base, title: 42 })).toBeNull();
  });

  it('non-untitled file → null (never rename a user file; never rename twice)', () => {
    expect(
      resolveRenamedSlug({
        title: 'New Name',
        fileName: 'my-first-post.mdx',
        oldSlug: 'my-first-post',
        existingSlugs: ['my-first-post'],
      }),
    ).toBeNull();
  });

  it('untitled .md file → null (.mdx only)', () => {
    expect(
      resolveRenamedSlug({
        title: 'My First Post',
        fileName: 'untitled-123.md',
        oldSlug: 'untitled-123',
        existingSlugs: ['untitled-123'],
      }),
    ).toBeNull();
  });

  it('title that slugifies to the current slug → null (no-op rename)', () => {
    expect(resolveRenamedSlug({ ...base, title: 'Untitled 1786224810096' })).toBeNull();
  });

  it('collision list excluding itself: own slug present never forces a suffix', () => {
    // The collection listing includes the post being renamed; that entry must
    // not count as a collision for an unrelated new name.
    expect(
      resolveRenamedSlug({ ...base, existingSlugs: ['untitled-1786224810096'], title: 'Fresh' }),
    ).toBe('fresh');
  });
});

// Verifier finding 1 (2026-08-10): a fail-open [] on discovery failure let
// createPost silently OVERWRITE an existing post. Discovery must fail CLOSED.
import { fetchCollectionSlugs } from '../renamePost';
import { contentOps } from '../content-ops';

describe('fetchCollectionSlugs — fail-closed', () => {
  it('null on fetch failure', async () => {
    const spy = vi.spyOn(contentOps, 'fetchCollections').mockRejectedValue(new Error('down'));
    expect(await fetchCollectionSlugs('works', 'untitled-1')).toBeNull();
    spy.mockRestore();
  });

  it('null when the collection is missing from the result', async () => {
    const spy = vi.spyOn(contentOps, 'fetchCollections').mockResolvedValue([] as never);
    expect(await fetchCollectionSlugs('works', 'untitled-1')).toBeNull();
    spy.mockRestore();
  });

  it('null when the renaming post itself is absent (stale discovery)', async () => {
    const spy = vi.spyOn(contentOps, 'fetchCollections').mockResolvedValue([
      { name: 'works', posts: [{ slug: 'other' }], inferredFields: [] },
    ] as never);
    expect(await fetchCollectionSlugs('works', 'untitled-1')).toBeNull();
    spy.mockRestore();
  });

  it('returns the slugs when the post is present', async () => {
    const spy = vi.spyOn(contentOps, 'fetchCollections').mockResolvedValue([
      { name: 'works', posts: [{ slug: 'untitled-1' }, { slug: 'a' }], inferredFields: [] },
    ] as never);
    expect(await fetchCollectionSlugs('works', 'untitled-1')).toEqual(['untitled-1', 'a']);
    spy.mockRestore();
  });
});

// Imported-adoption Task 2.1: nested slugs (2024/post) now reach the CMS.
// The untitled-gate must keep them out of rename-on-title — an imported
// nested post is the user's own file and its URL must stay stable.
describe('nested imported posts are excluded from rename-on-title', () => {
  it('nested post file never renames (basename fails the untitled gate)', () => {
    expect(
      resolveRenamedSlug({
        title: 'A real title',
        fileName: 'post.mdx', // postFileName() of src/content/blog/2024/post.mdx
        oldSlug: '2024/post',
        existingSlugs: ['2024/post'],
      })
    ).toBeNull();
  });

  it('untitled rename still works with nested slugs in the collision set', () => {
    expect(
      resolveRenamedSlug({
        title: 'Hello',
        fileName: 'untitled-123.mdx',
        oldSlug: 'untitled-123',
        existingSlugs: ['untitled-123', '2024/hello'],
      })
    ).toBe('hello');
  });
});
