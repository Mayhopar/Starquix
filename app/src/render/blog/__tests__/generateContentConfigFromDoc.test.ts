import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildBasicBlogSlotDoc } from '../__fixtures__/basic-blog-slot';
import { generateContentConfigFromDoc } from '../generateContentConfigFromDoc';

describe('generateContentConfigFromDoc', () => {
  it('produces null when doc has no collections', () => {
    expect(generateContentConfigFromDoc(new Y.Doc())).toBeNull();
  });

  it('emits Astro 5 glob loader for each collection', () => {
    const src = generateContentConfigFromDoc(buildBasicBlogSlotDoc());
    expect(src).not.toBeNull();
    expect(src!).toContain("import { glob } from 'astro/loaders'");
    expect(src!).toContain('base: "./src/content/blog"');
    expect(src!).toContain("pattern: '**/*.{md,mdx}'");
    expect(src!).toContain('export const collections = { "blog": blog };');
  });

  it('matches the pinned golden file', async () => {
    const src = generateContentConfigFromDoc(buildBasicBlogSlotDoc())!;
    await expect(src).toMatchFileSnapshot(
      '../__fixtures__/content-config.basic.astro',
    );
  });
});
