/**
 * Owner 2026-09-30 (audit): code blocks, dividers and tables showed as raw
 * markdown in grey boxes while the page renders them. The display now comes
 * from the post model's OWN parse (mdast) — no second markdown parser — and the
 * source attr is untouched (round-trip is the schema/postModel tests' job).
 */
import { describe, it, expect } from 'vitest';
import { parsePostBody } from '@/postmodel/postModel';
import { passthroughDom } from '../schema';

const displayOf = (src: string) => {
  const b = parsePostBody(src, 'mdx').blocks.find(x => x.kind === 'passthrough');
  return b && b.kind === 'passthrough' ? b.display ?? null : null;
};

describe('passthroughDom', () => {
  it('code: the parsed value (fences, info string, longer fences all handled by the parser), text only', () => {
    const src = "````js title=x\nconst a = '<b>';\n````";
    const el = passthroughDom('code', src, displayOf(src));
    expect(el.tagName).toBe('PRE');
    expect(el.classList.contains('sq-code')).toBe(true);
    expect(el.textContent).toBe("const a = '<b>';");
    expect(el.querySelector('b')).toBeNull();
  });
  it('divider: an <hr> (the page draws its dots)', () => {
    expect(passthroughDom('thematicBreak', '---').tagName).toBe('HR');
  });
  it('table: header + rows from the parsed table — an escaped pipe stays in its cell (GFM rules, same as the page)', () => {
    const src = '| Day | Note |\n|---|:--:|\n| 1 | a \\| b |\n| 2 | `code` <i>k</i> |';
    const el = passthroughDom('table', src, displayOf(src));
    expect(el.tagName).toBe('TABLE');
    expect([...el.querySelectorAll('th')].map(t => t.textContent)).toEqual(['Day', 'Note']);
    const cells = [...el.querySelectorAll('tbody tr')].map(r => [...r.querySelectorAll('td')].map(c => c.textContent));
    expect(cells[0]).toEqual(['1', 'a | b']);
    expect(cells[1][1]).toContain('code');
    expect(el.querySelector('i')).toBeNull();
  });
  it('anything without a display keeps the verbatim source', () => {
    expect(passthroughDom('html', '<div>x</div>').textContent).toBe('<div>x</div>');
    expect(passthroughDom('table', '| a |\n| b |').tagName).toBe('PRE');
    for (const t of ['code', 'table', 'thematicBreak', 'html']) expect(passthroughDom(t, '---').dataset.sqPassthrough).toBe(t);
  });
});
