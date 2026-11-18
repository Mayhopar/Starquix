// Regression: collection/field names are user input ("Blog collection") and
// were emitted verbatim as JS identifiers — `const Blog collection = …` broke
// `astro sync` on Vercel builds (Expected ";" but found "collection").
import { describe, it, expect } from 'vitest';
import { generateContentConfig } from '../content-config-generator';
import type { ContentCollection } from '../../core/collections/types';

const col = (name: string, fields: Array<[string, boolean]>): ContentCollection =>
  ({
    id: 'c1',
    name,
    fields: fields.map(([n, required], i) => ({
      id: `f${i}`,
      name: n,
      type: 'text',
      required,
    })),
  }) as ContentCollection;

describe('generateContentConfig — non-identifier names', () => {
  it('sanitizes var names, quotes keys, keeps raw name for glob base + collections key', () => {
    const src = generateContentConfig([col('Blog collection', [['title', true], ['read time', false]])]);
    expect(src).toContain('const Blog_collection = defineCollection(');
    expect(src).toContain('base: "./src/content/Blog collection"');
    expect(src).toContain('"read time": z.string().optional()');
    expect(src).toContain('export const collections = { "Blog collection": Blog_collection };');
    // no raw multi-word identifier anywhere
    expect(src).not.toMatch(/const \w+ \w+ =/);
  });

  it('emits z.coerce.date() so quoted frontmatter dates (strings) pass the schema', () => {
    const c = col('blog', [['title', true]]);
    c.fields.push({ id: 'fd', name: 'date', type: 'date', required: true } as any);
    expect(generateContentConfig([c])).toContain('"date": z.coerce.date()');
  });

  it('prefixes names starting with a digit', () => {
    const src = generateContentConfig([col('2024 posts', [['title', true]])]);
    expect(src).toContain('const _2024_posts = defineCollection(');
    expect(src).toContain('"2024 posts": _2024_posts');
  });
});
