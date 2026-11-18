import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '@astrojs/compiler';
import type { AcceptedPlugin, Root } from 'postcss';
import { normalizeImageFillSource } from '../../../../preview-template/src/plugins/sq-image-fill.js';

// Exercise the project's installed Tailwind v3, which scans Astro source
// before HTML entities are decoded by the installed Astro compiler.
const requirePreview = createRequire(resolve(dirname(fileURLToPath(import.meta.url)), '../../../../preview-template/package.json'));
const tailwind = requirePreview('tailwindcss') as (config: object) => AcceptedPlugin;
const postcss = requirePreview('postcss') as (plugins: AcceptedPlugin[]) => { process(css: string, options: object): Promise<{ root: Root }> };
const loc = { line: 1, column: 1 };
const source = '<img src="/hero.png" alt="Mountain" class="w-64 h-40 object-cover">';

async function expectCompiledImage(source: string, url: string) {
  const { code } = await transform(source);
  // This fixture is a static element. Inspect the compiler's actual emitted
  // template bytes, not a second HTML decode of the original source.
  const emitted = code.match(/<div\b[^>]*><\/div>/)?.[0];
  expect(emitted).toBeDefined();
  const element = new DOMParser().parseFromString(emitted!, 'text/html').body.firstElementChild!;
  const { root } = await postcss([tailwind({ content: [{ raw: source, extension: 'astro' }] })]).process('@tailwind utilities;', { from: undefined });
  const matchingImages: string[] = [];
  root.walkRules(rule => {
    rule.walkDecls('background-image', declaration => {
      if (element.matches(rule.selector)) matchingImages.push(declaration.value);
    });
  });
  expect(matchingImages).toEqual([`url('${url}')`]);
}

describe('image Fill source, Astro and generated CSS agree', () => {
  it.each(['original', 'replacement'] as const)('refuses or faithfully compiles an ampersand query in the %s URL', async target => {
    const url = '/new.png?x=1&y=2';
    const input = target === 'original' ? source.replace('/hero.png', '/new.png?x=1&amp;y=2') : source;
    let updated: string;
    try {
      updated = normalizeImageFillSource(input, loc, {
        expectedTag: input,
        change: target === 'original' ? { type: 'description', value: 'New description' } : { type: 'replace', src: url },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/image fill:.*URL/i);
      return;
    }
    // Before the guard, Astro emits '&' but Tailwind compiles '&amp;'. The
    // actual generated image selector fails to match and this assertion is RED.
    await expectCompiledImage(updated, url);
  });

  it.each(['/new.png?version=2', 'https://images.example/new.png?version=2'])('accepted source %s produces a matching selector and exact URL', async url => {
    const updated = normalizeImageFillSource(source, loc, { expectedTag: source, change: { type: 'replace', src: url } });
    await expectCompiledImage(updated, url);
  });
});
