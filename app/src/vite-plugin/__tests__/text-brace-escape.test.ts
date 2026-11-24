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

describe('instance writer — a markup commit never writes HTML its source lacks (audit #3 follow-up)', () => {
  const REFUSAL = /edit it in the Source tab/;

  it("refuses a component's rendered output (<Icon/> became <svg>)", async () => {
    await expect(instanceUpdateTextContent(page('Save <Icon name="check" />'), LOC,
      'Save now <svg viewBox="0 0 24 24"><path d="M5 12l5 5"></path></svg>')).rejects.toThrow(REFUSAL);
  });

  it('refuses markup a script swapped in (<i class="fa"> replaced by <svg>)', async () => {
    await expect(instanceUpdateTextContent(page('Done <i class="fa fa-check"></i>'), LOC,
      'Done! <svg class="svg-inline--fa"></svg>')).rejects.toThrow(REFUSAL);
  });

  it("refuses a link component: its rendered <a> must not replace the call", async () => {
    await expect(instanceUpdateTextContent(page('Read <Link href="/docs">docs</Link>'), LOC,
      'Read the <a href="/en/docs">docs</a>')).rejects.toThrow(REFUSAL);
  });

  it("writes text edits of the element's own markup, typed line breaks and the link tool's <a>", async () => {
    const span = 'Build <span class="text-indigo-600">faster</span> sites';
    expect(await instanceUpdateTextContent(page(span), LOC, `${span} today`)).toBe(page(`${span} today`));
    expect(await instanceUpdateTextContent(page('Two lines'), LOC, 'Two<br>lines')).toBe(page('Two<br>lines'));
    expect(await instanceUpdateTextContent(page('Read the docs'), LOC, 'Read the <a href="/docs">docs</a>'))
      .toBe(page('Read the <a href="/docs">docs</a>'));
  });
});
