import { expect, it } from 'vitest';
import { applyWriteBackOverrides, type WriteBackOverrides } from '../write-back-apply';
import { invertIdentityMaps, projectCoordinate } from '@/services/durableEdits/sourceIdentity';

const file = 'src/pages/index.astro';
async function transform(source: string, overrides: WriteBackOverrides) {
  const result = await applyWriteBackOverrides(source, file, overrides);
  if (!result.ok) throw new Error('Unexpected root-removal refusal');
  return result;
}

it('preserves every descendant in a same-line subtree permutation with identical sibling bytes', async () => {
  const before = '<main><p><b>X</b></p><p><b>X</b></p></main>\n';
  const result = await transform(before, { orderOverrides: ['p-1', 'p-0'] });
  expect(result.content).toBe(before);
  expect(projectCoordinate({ file, line: 1, column: 10 }, result.identityMaps)).toMatchObject({ line: 1, column: 25 });
  expect(projectCoordinate({ file, line: 1, column: 25 }, result.identityMaps)).toMatchObject({ line: 1, column: 10 });
});

it('retains other identities and restores only the deleted identity through the exact inverse', async () => {
  const before = '<main><p>X</p><p>X</p><p>X</p></main>\n';
  const result = await transform(before, { deletedSelectors: ['p-1'] });
  expect(result.content).toBe('<main><p>X</p><p>X</p></main>\n');
  const target = { file, line: 1, column: 15 };
  expect(projectCoordinate(target, result.identityMaps)).toBeNull();
  expect(projectCoordinate({ file, line: 1, column: 23 }, result.identityMaps)).toMatchObject({ line: 1, column: 15 });
  expect(projectCoordinate(target, [...result.identityMaps, ...invertIdentityMaps(result.identityMaps)])).toMatchObject(target);
});

it('resolves a selector resurrected by its accepted inverse map', async () => {
  const before = '<main><p>A</p><p>B</p></main>';
  const removed = await transform(before, { deletedSelectors: ['p-1'] });
  const result = await applyWriteBackOverrides(before, file, { textOverrides: { 'p-1': 'Edited' } }, {
    source: before, maps: [...removed.identityMaps, ...invertIdentityMaps(removed.identityMaps)],
  });
  expect(result).toMatchObject({ ok: true, content: '<main><p>A</p><p>Edited</p></main>' });
});

it('captures image and link attribute shifts without changing the following source identity', async () => {
  const result = await transform('<main><img src="a"/><a href="a">A</a><p>B</p></main>', {
    imageOverrides: { 'img-0': { src: 'long-image.png' } }, linkOverrides: { 'a-0': { href: '/long-link' } },
  });
  expect(projectCoordinate({ file, line: 1, column: 38 }, result.identityMaps)).toMatchObject({ line: 1, column: 60 });
});

it('maps both removed drawn subtrees and inserted markup while preserving the parent and following sibling', async () => {
  const before = '<main>\n  <p>A</p>\n  <div data-sq-drawn="old"><b>X</b></div>\n</main>\n<aside>B</aside>\n';
  const result = await transform(before, { drawnReconcile: [{ parentSelector: 'main-0', markup: '<section data-sq-drawn="new">N</section>' }] });
  expect(result.content).toBe('<main>\n  <p>A</p>\n  <section data-sq-drawn="new">N</section>\n</main>\n<aside>B</aside>\n');
  expect(projectCoordinate({ file, line: 3, column: 3 }, result.identityMaps)).toBeNull();
  expect(projectCoordinate({ file, line: 5, column: 1 }, result.identityMaps)).toMatchObject({ line: 5, column: 1 });
});

it('carries a nested pre subtree through a reparent without modifying its internal spaces', async () => {
  const before = '<main>\n<pre>\n  a  b\n</pre>\n<section></section>\n</main>\n';
  const result = await transform(before, { reparentOverrides: [{ selector: 'pre-0', newParentSelector: 'section-0' }] });
  expect(result.content).toBe('<main>\n\n<section>  <pre>\n  a  b\n</pre>\n</section>\n</main>\n');
  expect(projectCoordinate({ file, line: 2, column: 1 }, result.identityMaps)).toMatchObject({ line: 3, column: 12 });
  expect(projectCoordinate({ file, line: 5, column: 1 }, result.identityMaps)).toMatchObject({ line: 3, column: 1 });
});

it('keeps selectors attached to their original nodes across markup insertion and deletion in one batch', async () => {
  const result = await transform('<main><section>Old</section><p>Keep</p><p>Remove</p><p>Last</p></main>', {
    textOverrides: { 'section-0': '<p>Added</p>' },
    attributeOverrides: { 'p-0': { title: 'kept' } },
    deletedSelectors: ['p-1'], orderOverrides: ['p-2', 'p-0'],
  });
  expect(result.content).toBe('<main><section><p>Added</p></section><p>Last</p><p title="kept">Keep</p></main>');
});

it('deletes an overlapping parent/child selection once and retains the following sibling', async () => {
  const result = await transform('<main><section><p>A</p></section><aside>B</aside></main>', { deletedSelectors: ['section-0', 'p-0'] });
  expect(result.content).toBe('<main><aside>B</aside></main>');
  expect(projectCoordinate({ file, line: 1, column: 34 }, result.identityMaps)).toMatchObject({ line: 1, column: 7 });
});

it('normalizes CRLF replacement markup once while retaining the following element coordinate', async () => {
  const result = await transform('<main>\r\n  <p>Old</p>\r\n  <aside>Keep</aside>\r\n</main>\r\n', {
    textOverrides: { 'p-0': 'New\r\nText' },
  });
  expect(result.content).toBe('<main>\r\n  <p>New\r\nText</p>\r\n  <aside>Keep</aside>\r\n</main>\r\n');
  expect(projectCoordinate({ file, line: 3, column: 3 }, result.identityMaps)).toMatchObject({ line: 4, column: 3 });
});
