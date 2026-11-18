import { describe, it, expect } from 'vitest';
import { postFileName } from '../postFileName';

describe('postFileName', () => {
  it('falls back to .mdx like post creation (a .md guess edits an .mdx post as plain markdown)', () => {
    expect(postFileName({ slug: 'a' })).toBe('a.mdx');
  });
  it('keeps the real file name when known', () => {
    expect(postFileName({ slug: 'a', filePath: 'src/content/blog/a.md' })).toBe('a.md');
  });
});
