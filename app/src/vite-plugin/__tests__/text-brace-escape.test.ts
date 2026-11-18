// Security (audit 2026-10-18): `{…}` in .astro markup runs as server-side
// code. Text typed on the canvas (or sent by an agent / a bridge message) lands
// through these writers — braces in it must be written as entities.
import { describe, it, expect } from 'vitest';
import { updateTextContent } from '../ast-updater';
// @ts-expect-error plain-JS instance module
import { updateTextContent as instanceUpdateTextContent } from '../../../../preview-template/src/plugins/sq-source-transforms.js';

const FILE = 'src/pages/index.astro';
const LOC = { file: FILE, line: 3, column: 1 };
const page = (inner: string) => `---\n---\n<p class="a">${inner}</p>\n`;

describe('text writers — typed braces are text', () => {
  it('editor writer (durable text edits) writes {x} as entities', async () => {
    expect(await updateTextContent(page('old'), FILE, LOC, '{x}')).toBe(page('&#123;x&#125;'));
  });

  it('instance writer writes {x} as entities', async () => {
    expect(await instanceUpdateTextContent(page('old'), LOC, '{x}')).toBe(page('&#123;x&#125;'));
  });

  it('a markup-form override fallback escapes too; a value-form one keeps its JSON string', async () => {
    const markup = (m: string) => page(`{Astro.props.pHtml ? <Fragment set:html={Astro.props.pHtml} /> : <>${m}</>}`);
    expect(await updateTextContent(markup('old <b>x</b>'), FILE, LOC, 'new <b>{y}</b>')).toBe(markup('new <b>&#123;y&#125;</b>'));
    expect(await instanceUpdateTextContent(markup('old <b>x</b>'), LOC, 'new <b>{y}</b>')).toBe(markup('new <b>&#123;y&#125;</b>'));
    const value = page('{Astro.props.pText ?? "old"}');
    expect(await updateTextContent(value, FILE, LOC, 'a {z}')).toBe(page('{Astro.props.pText ?? "a {z}"}'));
  });
});
