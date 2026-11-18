import { Marked } from 'marked';
import { escapeHtml } from './escapeHtml';

/**
 * Markdown → HTML for the canvas post-body preview and the style picker.
 * Full CommonMark + GFM via marked (headings, images, bold/italic, links,
 * lists, code, blockquotes). Replaces the old headings-only toy parser.
 *
 * Untrusted input: theme markdown is third-party and the style picker renders
 * this into the EDITOR document (window.sqDesktop, every project, the stored
 * tokens). Raw HTML shows as text; only web links stay links.
 */
const marked = new Marked({ renderer: { html: ({ text }) => escapeHtml(text) } });

const isWebUrl = (href: string) => {
  try { return /^https?:$/.test(new URL(href, 'https://base.invalid/').protocol); } catch { return false; }
};

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown ?? '', { async: false }) as string;
  // Judge links on the parsed output: marked writes `&#106;avascript:` into
  // href verbatim and only the browser's parse decodes it.
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const a of doc.querySelectorAll('a[href]')) {
    if (!isWebUrl(a.getAttribute('href')!)) { a.replaceWith(...a.childNodes); continue; }
    // The desktop window never navigates away; a new-window link opens in the browser (main's window-open handler).
    a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
  }
  return doc.body.innerHTML;
}
