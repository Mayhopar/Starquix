import { describe, it, expect } from 'vitest';
import { postBodyFallbackHtml } from '../mdxFallbackHtml';
import { markdownToHtml } from '../markdownToHtml';

// Owner report 2026-08-12: a post page rendered its own MDX SOURCE as copy —
// the import line and the <Media/> tag printed verbatim — whenever the real
// Astro render was unavailable (preview still booting, /__sq_post_view errored).
const OWNER_BODY = [
  "import Media from '../../components/Media.astro';",
  '',
  'test 1',
  '',
  '<Media items={["/uploads/7bb955a8-55445954468_822ed2e16a_k.jpg"]} class="col-span-8" />',
  '',
  'test 2',
  '',
].join('\n');

describe('postBodyFallbackHtml', () => {
  it('never prints the import line or the JSX tag as page copy', () => {
    const html = postBodyFallbackHtml(OWNER_BODY);
    expect(html).not.toContain('import Media');
    expect(html).not.toContain('components/Media.astro');
    expect(html).not.toContain('&lt;Media');
    expect(html).not.toContain('<Media');
    expect(html).not.toContain('items={');
  });

  it('keeps the prose around the component', () => {
    const html = postBodyFallbackHtml(OWNER_BODY);
    expect(html).toContain('test 1');
    expect(html).toContain('test 2');
  });

  it('stands one neutral block where the component was', () => {
    const html = postBodyFallbackHtml(OWNER_BODY);
    expect(html.match(/data-sq-mdx-placeholder/g)?.length).toBe(1);
  });

  it('matches markdownToHtml on a plain Markdown body', () => {
    const md = '# Title\n\nSome **bold** copy.\n\n![alt](/uploads/a.png)\n';
    expect(postBodyFallbackHtml(md).trim()).toBe(markdownToHtml(md).trim());
  });

  // The hand-rolled regex version deleted this import and stood a placeholder
  // where the sample was — a code block in a post is not a corner case.
  it('leaves a fenced code block alone, imports and JSX included', () => {
    const body = ['```js', "import Media from './Media.astro';", '<Media items={[null]} />', '```', ''].join('\n');
    const html = postBodyFallbackHtml(body);
    expect(html).toContain('import Media');
    expect(html).toContain('&lt;Media');
    expect(html).not.toContain('data-sq-mdx-placeholder');
  });

  // The regex version never matched a multi-line invocation, so its source
  // leaked as page copy — the exact bug the module exists to stop.
  it('replaces a MULTI-LINE component invocation, printing none of its source', () => {
    const body = 'before\n\n<Media\n  items={["/uploads/a.png"]}\n  class="col-span-8"\n/>\n\nafter\n';
    const html = postBodyFallbackHtml(body);
    expect(html).toContain('data-sq-mdx-placeholder');
    expect(html).not.toContain('items={');
    expect(html).not.toContain('col-span-8');
    expect(html).toContain('before');
    expect(html).toContain('after');
  });

  it('leaves lowercase HTML alone — Markdown renders it correctly', () => {
    const body = '<div class="note">hello</div>\n';
    expect(postBodyFallbackHtml(body).trim()).toBe(markdownToHtml(body).trim());
  });

  it('treats a component and its children as ONE block, printing no tag source', () => {
    const body = 'a\n\n<Credit>\nrole\n</Credit>\n\nb\n';
    const html = postBodyFallbackHtml(body);
    expect(html.match(/data-sq-mdx-placeholder/g)?.length).toBe(1);
    expect(html).not.toContain('Credit&gt;');
    expect(html).not.toContain('<Credit');
    expect(html).toContain('a');
    expect(html).toContain('b');
  });

  // The regex version emitted one placeholder per TAG, so a wrapper with two
  // children became three blocks. The parser sees one element.
  it('stands ONE placeholder for a wrapper component with children', () => {
    const body = 'a\n\n<CreditWrapper>\n  <Credit name="x" />\n  <Credit name="y" />\n</CreditWrapper>\n\nb\n';
    const html = postBodyFallbackHtml(body);
    expect(html.match(/data-sq-mdx-placeholder/g)?.length).toBe(1);
  });
});
