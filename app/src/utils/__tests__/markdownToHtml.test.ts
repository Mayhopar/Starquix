import { describe, it, expect } from 'vitest';
import { markdownToHtml } from '../markdownToHtml';

/**
 * Regression: the old parser only handled headings + paragraphs, so images,
 * bold/italic, links and lists rendered as literal text. These fail against
 * that toy parser and pass with marked.
 */
describe('markdownToHtml', () => {
  it('renders headings', () => {
    expect(markdownToHtml('## Here is a header')).toContain('<h2>Here is a header</h2>');
  });

  it('renders images (was literal text before)', () => {
    const html = markdownToHtml('![Alt text](/images/x.jpg)');
    expect(html).toContain('<img');
    expect(html).toContain('src="/images/x.jpg"');
    expect(html).toContain('alt="Alt text"');
    expect(html).not.toContain('![Alt text]');
  });

  it('renders bold and italic (was literal text before)', () => {
    const html = markdownToHtml('**bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders links (was literal text before)', () => {
    // target=_blank: the desktop window never navigates away; main opens a new-window link in the browser.
    expect(markdownToHtml('[docs](https://example.com)')).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>'
    );
  });

  it('renders lists (was literal text before)', () => {
    const html = markdownToHtml('- one\n- two');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
  });

  it('handles empty / nullish input without throwing', () => {
    expect(markdownToHtml('')).toBe('');
    // @ts-expect-error exercising the nullish guard
    expect(markdownToHtml(undefined)).toBe('');
  });
});

// Security (audit 2026-10-18): the style picker renders this into the EDITOR
// document; theme markdown is third-party.
describe('markdownToHtml — untrusted input', () => {
  it('escapes raw HTML instead of rendering it', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)>\n\ntext <b onclick="x()">b</b>');
    expect(html).not.toMatch(/<img|<b /);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('drops non-http(s) links, keeping their text', () => {
    // marked emits `&#106;` raw into href — the browser decodes it to `j`.
    const html = markdownToHtml('[a](javascript:alert(1)) [b](data:text/html,x) [c](https://ok.example) [d](/rel) <javascript:alert(2)> [e](&#106;avascript:alert(3)) [f](javascript&colon;alert(4))');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect([...doc.querySelectorAll('a')].map(a => a.getAttribute('href'))).toEqual(['https://ok.example', '/rel']);
    expect(doc.body.textContent?.trim()).toBe('a b c d javascript:alert(2) e f');
  });
});
