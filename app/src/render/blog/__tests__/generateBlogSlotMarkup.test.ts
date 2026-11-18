import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { generateBlogSlotMarkup } from '../generateBlogSlotMarkup';

function makeSlot(markup: string): Y.Map<unknown> {
  const doc = new Y.Doc();
  const el = new Y.Map();
  doc.getMap('elements').set('slot-1', el);
  el.set('componentType', 'BlogSlot');
  el.set('isDrawn', true);
  el.set('staticMarkup', markup);
  return el;
}

describe('generateBlogSlotMarkup', () => {
  const settings = {
    postsPerPage: 9,
    sortBy: 'date-desc',
    layout: 'grid',
    columns: 3,
    gap: 'gap-4',
    postLinkMode: 'auto',
  } as const;

  it('preserves outer section + inner wrapper; replaces <article> with map expression', () => {
    const slot = makeSlot(
      '<section class="bg-white">' +
        '<div class="grid grid-cols-3 gap-4 p-5">' +
          '<article class="card">template</article>' +
        '</div>' +
      '</section>',
    );
    const out = generateBlogSlotMarkup({
      slotElement: slot,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings,
    });
    expect(out).toMatch(/<section[^>]*class="[^"]*bg-white/);
    expect(out).toMatch(/<div[^>]*class="[^"]*grid grid-cols-3 gap-4 p-5/);
    expect(out).not.toContain('<article class="card">template</article>');
    expect(out).toContain('blogPosts');
    expect(out).toContain('<BlogCard post={post} />');
    expect(out).toContain('href={`/blog/posts/${post.id}`}');
  });

  it('omits the post-link wrapper when postLinkMode is none', () => {
    const slot = makeSlot('<section><article>x</article></section>');
    const out = generateBlogSlotMarkup({
      slotElement: slot,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings: { ...settings, postLinkMode: 'none' },
    });
    expect(out).toContain('<BlogCard post={post} />');
    expect(out).not.toContain('href=');
  });

  it('sort + slice respect settings', () => {
    const slot = makeSlot('<section><article>x</article></section>');
    const out = generateBlogSlotMarkup({
      slotElement: slot,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings: { ...settings, sortBy: 'title-asc', postsPerPage: 3 },
    });
    expect(out).toContain('a.data.title.localeCompare(b.data.title)');
    expect(out).toContain('.slice(0, 3)');
  });

  it('falls back to a flat section when no <article> exists in markup', () => {
    const slot = makeSlot('<section class="custom"></section>');
    const out = generateBlogSlotMarkup({
      slotElement: slot,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings,
    });
    expect(out).toContain('blogPosts');
    expect(out).toContain('<BlogCard post={post} />');
  });

  it('reconstructs <section><div class="grid ...">...</div></section> when staticMarkup is empty', () => {
    const slot = makeSlot('');
    const out = generateBlogSlotMarkup({
      slotElement: slot,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings,
    });
    // Preserves the two-level BlogSlot master structure: outer section, inner
    // grid/flex wrapper.
    expect(out).toMatch(/<section[^>]*class="[^"]*bg-white[^"]*"/);
    expect(out).toMatch(/<div[^>]*class="[^"]*grid grid-cols-3 gap-4[^"]*p-5[^"]*"/);
    expect(out).toContain('blogPosts');
    expect(out).toContain('<BlogCard post={post} />');
  });

  it('uses sourceClasses overrides for slot + :posts when present', () => {
    const doc = new Y.Doc();
    const el = new Y.Map();
    el.set('staticMarkup', '');
    doc.getMap('elements').set('slot-1', el);

    const sourceClasses = doc.getMap('sourceClasses');
    const slotEntry = new Y.Map();
    slotEntry.set('classes', 'custom-slot-class my-12');
    sourceClasses.set('slot-1', slotEntry);

    const postsEntry = new Y.Map();
    postsEntry.set('classes', 'grid grid-cols-4 gap-8 p-8');
    sourceClasses.set('slot-1:posts', postsEntry);

    const out = generateBlogSlotMarkup({
      slotElement: el,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings,
    });
    expect(out).toContain('class="custom-slot-class my-12"');
    expect(out).toContain('class="grid grid-cols-4 gap-8 p-8"');
    expect(out).not.toContain('bg-white'); // override replaced the default
  });

  it('nested articles: only the direct-child article in the posts wrapper is replaced', () => {
    const slot = makeSlot(
      '<section><div class="posts">' +
        '<article>outer<article>inner</article></article>' +
      '</div></section>',
    );
    const out = generateBlogSlotMarkup({
      slotElement: slot,
      slotElementId: 'slot-1',
      collectionName: 'blog',
      cardComponentName: 'BlogCard',
      settings,
    });
    expect(out).not.toContain('outer');
    expect(out).not.toContain('inner');
    expect(out).toContain('<BlogCard post={post} />');
  });
});
