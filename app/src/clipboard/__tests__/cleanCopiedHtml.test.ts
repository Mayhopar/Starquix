import { describe, it, expect } from 'vitest';
import { cleanCopiedHtml, STRIP_ATTRS } from '../cleanCopiedHtml';

describe('cleanCopiedHtml', () => {
  it('strips runtime/tagger attrs', () => {
    const html = `<div data-key="el-1:div-0" data-sq-id="sabc123" data-sq-source="a" data-sq-source-version="s12:40" data-sq-p="s q p" data-sq-lp="x" data-sq-lq="y" data-sq-usage="u" data-sq-usage-version="s13:40" data-sq-placement="p" data-astro-source-file="f" data-astro-source-loc="1:1" contenteditable="true" data-sq-selection-highlight="1" data-sq-post-slug="s" class="p-4">hi</div>`;
    const out = cleanCopiedHtml(html);
    for (const attr of STRIP_ATTRS) expect(out).not.toContain(attr);
    expect(out).toBe('<div class="p-4">hi</div>');
  });

  it('keeps semantic sq attrs', () => {
    const html = `<div data-sq-slot="main" data-sq-db-field="email" data-sq-form-field="1" data-sq-media-path="/uploads/a.png">x</div>`;
    expect(cleanCopiedHtml(html)).toBe(html);
  });

  it('does not mangle Astro expressions (string-based, no DOM round-trip)', () => {
    const html = `<div data-key="k">{items.map(i => <span>{i}</span>)}</div>`;
    expect(cleanCopiedHtml(html)).toBe(`<div>{items.map(i => <span>{i}</span>)}</div>`);
  });
});
