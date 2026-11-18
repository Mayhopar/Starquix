import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateCardComponent } from '../generateCardComponent';

function makeCardElement(markup: string): { doc: Y.Doc; el: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const el = new Y.Map();
  el.set('staticMarkup', markup);
  doc.getMap('elements').set('slot-1:blogcard', el);
  return { doc, el };
}

describe('generateCardComponent', () => {
  it('wraps card markup in Astro frontmatter', () => {
    const { doc, el } = makeCardElement('<article><h3>{title}</h3></article>');
    const out = generateCardComponent({
      collectionName: 'blog',
      bindings: { 'h3-0': 'title' },
      cardElement: el,
      doc,
    });
    expect(out).toContain('const { post } = Astro.props;');
    expect(out).toContain('<article>');
    expect(out).toContain('{post.data.title}');
  });

  it('substitutes every {field} binding with {post.data.field}', () => {
    const { doc, el } = makeCardElement('<h3>{title}</h3><p>{body}</p><time>{date}</time>');
    const out = generateCardComponent({
      collectionName: 'blog',
      bindings: { 'h3-0': 'title', 'p-0': 'body', 'time-0': 'date' },
      cardElement: el,
      doc,
    });
    expect(out).toContain('{post.data.title}');
    expect(out).toContain('{post.data.body}');
    expect(out).toContain('{post.data.date}');
    expect(out).not.toContain('{title}');
  });

  it('returns a minimal stub when staticMarkup is empty', () => {
    const { doc, el } = makeCardElement('');
    const out = generateCardComponent({
      collectionName: 'blog',
      bindings: {},
      cardElement: el,
      doc,
    });
    // Stub must be valid Astro and must not crash the build
    expect(out).toContain('const { post } = Astro.props;');
    expect(out).toMatch(/<article[^>]*>.*<\/article>/s);
  });
});
