// @vitest-environment node
// Agent multiplayer (owner 2026-11-08: newest change wins). Ledger A in
// docs/plans/2026-11-08-agent-multiplayer-design.md.
import { expect, it } from 'vitest';
import { mergeText } from '../rebase';

const page = '<html>\n<head>\n<title>T</title>\n</head>\n<body>\n<main class="p-2">Привет</main>\n<p class="x">Two</p>\n</body>\n</html>\n';
const edited = page.replace('p-2', 'p-4');
const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

it('A1–A3: passes the trivial states through', () => {
  expect(mergeText(page, page, edited)).toBe(edited);
  expect(mergeText(page, edited, page)).toBe(edited);
  expect(mergeText(page, edited, edited)).toBe(edited);
});

it('A4: lands the edit next to an outside write elsewhere in the file', () => {
  const outside = page.replace('</head>', '<link rel="stylesheet" href="/sq-fonts.css">\n</head>');
  expect(mergeText(page, edited, outside)).toBe(outside.replace('p-2', 'p-4'));
});

it('A4: lands an inserted line between unchanged neighbours', () => {
  const inserted = page.replace('<p class="x">', '<hr>\n<p class="x">');
  const outside = '---\nconst a = 1;\n---\n' + page;
  expect(mergeText(page, inserted, outside)).toBe('---\nconst a = 1;\n---\n' + inserted);
});

it('A4: keeps typing in a short post when the outside edit touched the very next paragraph', () => {
  expect(mergeText('One.\n\nTwo.\n', 'One, mine.\n\nTwo.\n', 'One.\n\nTwo, agent.\n')).toBe('One, mine.\n\nTwo, agent.\n');
});

it('A5: keeps every region of one save around an outside edit (title + body)', () => {
  const post = '---\ntitle: "Hi"\n---\nOne.\n\nTwo.\n\nThree.\n';
  const mine = post.replace('"Hi"', '"Hello"').replace('Three.', 'Three, mine.');
  const agent = post.replace('Two.', 'Two, agent.');
  expect(mergeText(post, mine, agent)).toBe(agent.replace('"Hi"', '"Hello"').replace('Three.', 'Three, mine.'));
});

it('A6: the same characters keep the newer text', () => {
  expect(mergeText(page, edited, page.replace('p-2', 'p-8'))).toBe(page.replace('p-2', 'p-8'));
  expect(mergeText('date: x\ndraft: "fals"\n---\n', 'date: x\ndraft: "false"\n---\n', 'date: x\ndraft: true\n---\n')).toBe('date: x\ndraft: true\n---\n');
});

it('A7: both typed at the same spot: both texts stay', () => {
  const merged = mergeText('One paragraph.\n\nTwo.\n', 'One paragraph. Mine.\n\nTwo.\n', 'One paragraph. Agent.\n\nTwo.\n');
  expect(merged).toContain(' Mine.'); expect(merged).toContain(' Agent.');
});

it('A8: an older delete of text the newer side edited keeps the newer edit', () => {
  const base = 'Keep this line.\n\nDrop me please, it is long.\n\nThe end.\n';
  expect(mergeText(base, base.replace('Drop me please, it is long.\n\n', ''), base.replace('it is long', 'the agent rewrote it')))
    .toBe(base.replace('it is long', 'the agent rewrote it'));
});

it('A9: a newer delete wins over an older edit inside it', () => {
  const base = 'Keep this line.\n\nEdit me somewhere.\n\nThe end.\n';
  const newer = base.replace('Edit me somewhere.\n\n', '');
  expect(mergeText(base, base.replace('somewhere', 'right here'), newer)).toBe(newer);
});

it('A10: never applies a change the newer side already carries', () => {
  const outside = edited.replace('Two', 'Три');
  expect(mergeText(page, edited, outside)).toBe(outside);
  const post = 'Ship it.\n\nMore.\n';
  expect(mergeText(post, post.replace('Ship it.', 'Ship it now.'), post.replace('Ship it.', 'Ship it now.').replace('More.', 'More, agent.')))
    .toBe(post.replace('Ship it.', 'Ship it now.').replace('More.', 'More, agent.'));
});

it('A11: lands on the right copy of repeated text', () => {
  const twice = '<ul>\n<li>A</li>\n<li class="x">i</li>\n<li>B</li>\n<li class="x">i</li>\n</ul>\n';
  const ours = twice.replace('<li>B</li>\n<li class="x">i</li>', '<li>B</li>\n<li class="y">i</li>');
  const outside = twice.replace('<li>A</li>', '<li>A2</li>');
  expect(mergeText(twice, ours, outside)).toBe(ours.replace('<li>A</li>', '<li>A2</li>'));
});

it('A12: stays fast on a large file', () => {
  const big = Array.from({ length: 4000 }, (_, i) => `Paragraph ${i} with some words in it.`).join('\n\n') + '\n';
  const t = performance.now();
  const merged = mergeText(big, big.replace('Paragraph 10 ', 'Paragraph ten '), big.replace('Paragraph 3990 ', 'Paragraph 3990, agent, '));
  expect(performance.now() - t).toBeLessThan(2000);
  expect(merged).toContain('Paragraph ten '); expect(merged).toContain('Paragraph 3990, agent, ');
});

it('A13: keeps CRLF and BOM bytes as they are', () => {
  const crlf = '﻿---\r\ntitle: T\r\n---\r\nOne.\r\n\r\nTwo.\r\n';
  expect(mergeText(crlf, crlf.replace('One.', 'One!'), crlf.replace('Two.', 'Two?'))).toBe(crlf.replace('One.', 'One!').replace('Two.', 'Two?'));
});

it('A14: never leaves half an emoji', () => {
  const base = 'Hi 👋 there, friend.\n';
  const merged = mergeText(base, 'Hi 👋👋 there, friend.\n', 'Hi 👋 there, my friend.\n');
  expect(lone.test(merged)).toBe(false);
});

it('A15: a file the newer side emptied stays empty', () => {
  expect(mergeText(page, edited, '')).toBe('');
});

it('never refuses a no-op edit, even when the outside write moved its anchor line', () => {
  const outside = page.replace('</html>', '</html><!-- agent -->');
  expect(mergeText(page, page, outside)).toBe(outside);
});
