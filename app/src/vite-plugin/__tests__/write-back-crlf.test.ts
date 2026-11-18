import { expect, it } from 'vitest';
import { insertChildBeforeClosingTag, updateClassAttribute, updateImageAttribute, updateLinkAttribute, updateAttribute } from '../ast-updater';
import { createSourceIdentityMap } from '../source-transform-identity';
import type { SourceIdentityMap } from '@/services/durableEdits/types';

it.each(['\n', '\r\n'])('normalizes inserted CRLF markup once with source line ending %j', async ending => {
  const before = '<main></main><aside>Tail</aside>' + ending;
  const maps: SourceIdentityMap[] = [];
  const after = await insertChildBeforeClosingTag(before, { file: 'src/index.astro', line: 1, column: 1 },
    '<p>A</p>\r\n<p>B</p>', (old, next, spans) => maps.push(createSourceIdentityMap(old, next, spans)));
  expect(after).toBe(['<main>  <p>A</p>', '<p>B</p>', '</main><aside>Tail</aside>', ''].join(ending));
  expect(maps[0].entries).toContainEqual({ before: { line: 1, column: 14 }, after: { line: 3, column: 8 } });
});

it.each(['classes', 'image', 'link', 'attribute'] as const)('normalizes CRLF %s values before calculating preserved spans', async kind => {
  const file = 'src/index.astro', location = { file, line: 1, column: 1 };
  const attribute = kind === 'classes' ? 'class' : kind === 'image' ? 'alt' : kind === 'link' ? 'aria-label' : 'data-label';
  for (const ending of ['\n', '\r\n']) {
    const before = `<p ${attribute}="Old">A</p><aside>Tail</aside>${ending}`;
    const maps: SourceIdentityMap[] = [];
    const observe = (old: string, next: string, spans: Parameters<typeof createSourceIdentityMap>[2]) => maps.push(createSourceIdentityMap(old, next, spans));
    const value = 'First\r\nSecond';
    const after = kind === 'classes' ? await updateClassAttribute(before, file, location, value, undefined, observe)
      : kind === 'image' ? await updateImageAttribute(before, file, location, 'alt', value, observe)
      : kind === 'link' ? await updateLinkAttribute(before, file, location, 'aria-label', value, observe)
      : await updateAttribute(before, file, location, 'data-label', value, observe);
    expect(after).toBe(`<p ${attribute}="First${ending}Second">A</p><aside>Tail</aside>${ending}`);
    expect(maps[0].entries).toContainEqual({ before: { line: 1, column: before.indexOf('<aside>') + 1 }, after: { line: 2, column: 14 } });
  }
});
