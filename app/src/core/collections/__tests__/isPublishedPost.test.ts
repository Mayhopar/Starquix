import { describe, it, expect } from 'vitest';
import { isPublishedPost } from '../isPublishedPost';

describe('isPublishedPost', () => {
  it('keeps posts with no draft field', () => {
    expect(isPublishedPost({ frontmatter: { title: 'hi' } })).toBe(true);
  });

  it('keeps posts with draft: false', () => {
    expect(isPublishedPost({ frontmatter: { title: 'hi', draft: false } })).toBe(true);
  });

  it('drops posts with draft: true', () => {
    expect(isPublishedPost({ frontmatter: { title: 'hi', draft: true } })).toBe(false);
  });

  it('treats falsy non-boolean values as published (defensive)', () => {
    // YAML might serialize the field as the string "false" — treat anything
    // that is not strictly `true` as published, so authoring quirks don't
    // accidentally hide posts.
    expect(isPublishedPost({ frontmatter: { draft: 'false' } as Record<string, unknown> })).toBe(true);
    expect(isPublishedPost({ frontmatter: { draft: 0 } as Record<string, unknown> })).toBe(true);
    expect(isPublishedPost({ frontmatter: {} })).toBe(true);
  });

  it('keeps posts with no frontmatter at all', () => {
    expect(isPublishedPost({})).toBe(true);
  });
});
