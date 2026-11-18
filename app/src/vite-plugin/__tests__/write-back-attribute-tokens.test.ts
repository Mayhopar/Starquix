import { expect, it } from 'vitest';
import { updateAttribute, updateAttributeExpression, updateLinkAttribute } from '../ast-updater';

const file = 'src/pages/index.astro', loc = { file, line: 1, column: 1 };

it('generic attribute replacement matches the full token and escapes a quoted value', async () => {
  expect(await updateAttribute('<p data-name="Keep" name="Old">Text</p>', file, loc, 'name', 'New "quoted" & $&'))
    .toBe('<p data-name="Keep" name="New &quot;quoted&quot; &amp; $&amp;">Text</p>');
});
it.each([
  ['<slot data-name="Keep" name={current}/>', '<slot data-name="Keep"/>'],
  ['<slot data-name="Keep"/>', '<slot data-name="Keep"/>'],
  ['<slot name="Remove" data-name="Keep"/>', '<slot data-name="Keep"/>'],
])('generic empty attribute removal preserves unrelated names in %s', async (input, expected) => {
  expect(await updateAttribute(input, file, loc, 'name', ' ')).toBe(expected);
});
it('expression replacement does not match a nested quoted attribute name', async () => {
  const input = '<img title=\'src="literal"\' data-src="Keep" src={old} />';
  expect(await updateAttributeExpression(input, loc, 'src', 'entry.image')).toBe('<img title=\'src="literal"\' data-src="Keep" src={entry.image} />');
});
it('link attribute replacement preserves unrelated attributes and literal replacement metacharacters', async () => {
  expect(await updateLinkAttribute('<a data-href="Keep" href="old">Link</a>', file, loc, 'href', '/new?label="a"&x=$&'))
    .toBe('<a data-href="Keep" href="/new?label=&quot;a&quot;&amp;x=$&amp;">Link</a>');
});
it('an ambiguous duplicate generic attribute refuses instead of choosing one', async () => {
  await expect(updateAttribute('<slot name="One" NAME="Two"/>', file, loc, 'name', 'Next')).rejects.toThrow(/ambiguous/i);
});
