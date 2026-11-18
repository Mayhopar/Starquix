/**
 * Custom code (owner 2026-11-04): MDX reads `<div>x</div>` on ONE line as a
 * paragraph of inline JSX, so a writer's own one-line markup came back from
 * disk as prose with chips — not editable as Custom code. A paragraph made only
 * of HTML elements is the writer's markup: a raw-element passthrough (verbatim).
 */
import { describe, it, expect } from 'vitest';
import { parsePostBody, serializePostDoc } from '../postModel';

const kinds = (src: string) => parsePostBody(src, 'mdx').blocks.map(b => b.kind === 'passthrough' ? `passthrough:${b.nodeType}` : b.kind);

describe('a paragraph of only HTML elements is a raw-element block', () => {
  it('one-line element', () => {
    const src = 'Intro\n\n<div class="note">Hello <b>there</b></div>\n';
    expect(kinds(src)).toEqual(['paragraph', 'passthrough:mdxJsxFlowElement']);
    expect(serializePostDoc(parsePostBody(src))).toBe(src);
  });
  it('several elements on adjacent lines stay ONE block', () => {
    const src = '<div>a</div>\n<span>b</span>\n';
    expect(kinds(src)).toEqual(['passthrough:mdxJsxFlowElement']);
    expect(serializePostDoc(parsePostBody(src))).toBe(src);
  });
  it('prose around an element stays prose', () => {
    expect(kinds('Text with <b>bold html</b> inside\n')).toEqual(['paragraph']);
    expect(kinds('<b>lead</b> then words\n')).toEqual(['paragraph']);
  });
  it('a component (capitalised) in a paragraph is not the writer\'s markup', () => {
    expect(kinds('<Badge>New</Badge>\n')).toEqual(['paragraph']);
  });
  it('.md files are untouched (their raw HTML is already opaque)', () => {
    expect(parsePostBody('<div>x</div>\n', 'md').blocks.map(b => b.kind === 'passthrough' ? b.nodeType : b.kind)).toEqual(['html']);
  });
});
