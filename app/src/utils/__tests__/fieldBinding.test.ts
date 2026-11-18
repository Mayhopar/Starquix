// Field binding in the BlogCard master (task-240 Phase 2): a text element bound
// to a collection field reads `{post.data.<field>}`; an <img> reads
// `src={post.data.<field>?.src ?? post.data.<field>}` (image() metadata OR a
// plain path, no schema knowledge needed). Pure transforms over the file.
import { IMPORTED_CARD } from './fixtures/cards';
import { describe, it, expect } from 'vitest';
import { readFieldBinding, fieldExpression, bindingKindFor, applyFieldBinding, canBindField, readDateFormat, DATE_FORMATS } from '../fieldBinding';

const CARD = `---
const { post } = Astro.props;
---
<article class="card">
  <img src="/placeholder.png" alt="cover" />
  <h3 class="font-semibold">Sample post</h3>
  <p class="text-sm">A short description.</p>
</article>
`;
const IMG = { file: 'src/components/BlogCard.astro', line: 5, column: 3 };
const H3 = { file: 'src/components/BlogCard.astro', line: 6, column: 3 };

describe('readFieldBinding', () => {
  it('text expression → field', () => {
    expect(readFieldBinding('<h3 class="a">{post.data.title}</h3>', 'h3')).toBe('title');
    expect(readFieldBinding('<span>{ post.data.year }</span>', 'span')).toBe('year');
    expect(readFieldBinding('<span>{post.data.image?.src ?? post.data.image}</span>', 'span')).toBe('image');
  });
  it('img src expression → field', () => {
    expect(readFieldBinding('<img src={post.data.image?.src ?? post.data.image} alt="x" />', 'img')).toBe('image');
    expect(readFieldBinding('<img class="w-full" src={post.data.cover} />', 'img')).toBe('cover');
  });
  it('static content / other expressions → null', () => {
    expect(readFieldBinding('<h3>Static</h3>', 'h3')).toBeNull();
    expect(readFieldBinding('<h3>{title}</h3>', 'h3')).toBeNull();
    expect(readFieldBinding('<h3>Hi {post.data.title}</h3>', 'h3')).toBeNull();
    expect(readFieldBinding('<img src="/x.png" />', 'img')).toBeNull();
    expect(readFieldBinding('<br />', 'br')).toBeNull();
  });
});

describe('fieldExpression / bindingKindFor', () => {
  it('image fields resolve metadata or a path; everything else is the field', () => {
    expect(fieldExpression('title', 'text')).toBe('post.data.title');
    expect(fieldExpression('image', 'image')).toBe('post.data.image?.src ?? post.data.image');
  });
  it('text-editable tags are text, img is img, a div is a box, the rest is not bindable', () => {
    expect(bindingKindFor('h3')).toBe('text');
    expect(bindingKindFor('img')).toBe('img');
    expect(bindingKindFor('div')).toBe('box');
    expect(bindingKindFor('article')).toBeNull();
  });
});

describe('applyFieldBinding', () => {
  it('binds a text element and reads back', async () => {
    const out = await applyFieldBinding(CARD, H3, 'h3', 'title', 'text');
    expect(out).toContain('<h3 class="font-semibold">{post.data.title}</h3>');
    expect(out.replace('{post.data.title}', 'Sample post')).toBe(CARD);
  });
  it('unbinding a text element writes a static placeholder', async () => {
    const bound = await applyFieldBinding(CARD, H3, 'h3', 'title', 'text');
    const out = await applyFieldBinding(bound, H3, 'h3', null, 'text');
    expect(out).toContain('<h3 class="font-semibold">Title</h3>');
  });
  it('binds an img src as an expression (replacing the static src)', async () => {
    const out = await applyFieldBinding(CARD, IMG, 'img', 'image', 'image');
    expect(out).toContain('<img src={post.data.image?.src ?? post.data.image} alt="cover" />');
    expect(readFieldBinding('<img src={post.data.image?.src ?? post.data.image} alt="cover" />', 'img')).toBe('image');
  });
  it('binds an img with no src by adding the attribute', async () => {
    const noSrc = CARD.replace('<img src="/placeholder.png" alt="cover" />', '<img alt="cover" />');
    const out = await applyFieldBinding(noSrc, IMG, 'img', 'cover', 'text');
    expect(out).toContain('<img src={post.data.cover} alt="cover" />');
  });
  it('refuses a tag that is not bindable', async () => {
    await expect(applyFieldBinding(CARD, { ...H3, line: 4 }, 'article', 'title', 'text')).rejects.toThrow();
  });
});

describe('an IMAGE field on a TEXT element replaces it with a bound <img>', () => {
  it('the library card placeholder span becomes an img that fills its box', async () => {
    const card = `---
const { post } = Astro.props;
---
<article class="card">
  <div class="aspect-video bg-gray-100 flex items-center justify-center">
    <span class="text-gray-400 text-sm">{post.data.thumbnail}</span>
  </div>
</article>
`;
    const out = await applyFieldBinding(card, { file: 'src/components/BlogCard.astro', line: 6, column: 5 }, 'span', 'coverImage', 'image');
    expect(out).toBe(card.replace(
      '    <span class="text-gray-400 text-sm">{post.data.thumbnail}</span>',
      '    <img src={post.data.coverImage?.src ?? post.data.coverImage} alt="" class="w-full h-full object-cover" />',
    ));
    expect(readFieldBinding('<img src={post.data.coverImage?.src ?? post.data.coverImage} alt="" class="w-full h-full object-cover" />', 'img')).toBe('coverImage');
  });

  it('a text field on a text element still binds the text (unchanged contract)', async () => {
    const out = await applyFieldBinding(CARD, H3, 'h3', 'title', 'text');
    expect(out).toContain('<h3 class="font-semibold">{post.data.title}</h3>');
  });
});

describe('a placeholder BOX takes an image field (the library card\'s aspect-video div)', () => {
  const card = `---
const { post } = Astro.props;
---
<article class="card">
  <div class="aspect-video bg-gray-100 flex items-center justify-center">
    <span class="text-gray-400 text-sm">{post.data.thumbnail}</span>
  </div>
  <div class="p-4 bg-white h-full">
    <h3 class="font-semibold text-lg text-black">{post.data.title}</h3>
  </div>
</article>
`;
  const BOX = { file: 'src/components/BlogCard.astro', line: 5, column: 3 };
  const TEXT_BOX = { file: 'src/components/BlogCard.astro', line: 8, column: 3 };

  it('kind: div/figure/picture are boxes; a box is bindable only while it holds no block children', () => {
    expect(bindingKindFor('div')).toBe('box');
    expect(bindingKindFor('figure')).toBe('box');
    expect(bindingKindFor('article')).toBeNull();
    expect(canBindField('<div class="x"><span>Thumb</span></div>', 'div')).toBe(true);
    expect(canBindField('<div class="x"></div>', 'div')).toBe(true);
    expect(canBindField('<div class="x"><img src="/a.png" /></div>', 'div')).toBe(true);
    expect(canBindField('<div class="x"><h3>{post.data.title}</h3></div>', 'div')).toBe(false);
  });

  it('binding replaces the box CONTENT with a bound <img>, keeping the box and its classes', async () => {
    const out = await applyFieldBinding(card, BOX, 'div', 'coverImage', 'image');
    expect(out).toBe(card.replace(
      '  <div class="aspect-video bg-gray-100 flex items-center justify-center">\n    <span class="text-gray-400 text-sm">{post.data.thumbnail}</span>\n  </div>',
      '  <div class="aspect-video bg-gray-100 flex items-center justify-center">\n    <img src={post.data.coverImage?.src ?? post.data.coverImage} alt="" class="w-full h-full object-cover" />\n  </div>',
    ));
    expect(readFieldBinding('<div class="aspect-video">\n    <img src={post.data.coverImage?.src ?? post.data.coverImage} alt="" class="w-full h-full object-cover" />\n  </div>', 'div')).toBe('coverImage');
  });

  it('refuses a non-image field on a box, and a box that holds block children', async () => {
    await expect(applyFieldBinding(card, BOX, 'div', 'title', 'text')).rejects.toThrow(/image field/);
    await expect(applyFieldBinding(card, TEXT_BOX, 'div', 'coverImage', 'image')).rejects.toThrow(/other elements/);
  });
});

describe('legacy `.src ??` form (files bound before the `?.` emit, 2026-09-12)', () => {
  // A post without the field crashed the render (TypeError: reading 'src' of
  // undefined — the BlogCard master's standalone fallback has no image); the
  // emit is now `?.src`, and files written with the old form still read as bound.
  it('still reads as bound on img, span and box', () => {
    expect(readFieldBinding('<img src={post.data.image.src ?? post.data.image} alt="x" />', 'img')).toBe('image');
    expect(readFieldBinding('<span>{post.data.image.src ?? post.data.image}</span>', 'span')).toBe('image');
    expect(readFieldBinding('<div class="aspect-video">\n    <img src={post.data.cover.src ?? post.data.cover} alt="" />\n  </div>', 'div')).toBe('cover');
  });
});

describe('imported cards (any entry name, Astro <Image>)', () => {
  const lines = IMPORTED_CARD.split('\n');
  const at = (needle: string) => { const i = lines.findIndex((l) => l.includes(needle)); return { file: 'src/components/FeaturedWork.astro', line: i + 1, column: lines[i].indexOf('<') + 1 }; };
  it('reads a `work.data.x` binding', () => {
    expect(readFieldBinding('<h1 class="a">\n  {work.data.title}\n</h1>', 'h1')).toBe('title');
  });
  it('writes with the card\'s own entry name; an <Image> takes the plain field', async () => {
    const text = await applyFieldBinding(IMPORTED_CARD, at('<p class="description'), 'p', 'title', 'text');
    expect(text).toContain('{work.data.title}');
    expect(text).not.toContain('post.data');
    const img = await applyFieldBinding(IMPORTED_CARD, at('<Image'), 'img', 'cover', 'image');
    expect(img).toContain('src={work.data.cover}');
  });
});

describe('readSlotBinding (block-form cards)', () => {
  it('reads the slot of a text, img and box element', async () => {
    const { readSlotBinding } = await import('../fieldBinding');
    expect(readSlotBinding("<h3>{f('year')}</h3>", 'h3')).toBe('year');
    expect(readSlotBinding("<img src={f('preview1')?.src ?? f('preview1')} alt=\"\" />", 'img')).toBe('preview1');
    expect(readSlotBinding("<div class=\"box\">{f('cover') && <img src={f('cover')?.src ?? f('cover')} />}</div>", 'div')).toBe('cover');
    expect(readSlotBinding('<h3>{post.data.title}</h3>', 'h3')).toBeNull();
  });
});

describe('date format (owner 2026-10-10)', () => {
  const P = { file: 'src/components/BlogCard.astro', line: 7, column: 3 };
  const inner = (src: string) => src.split('\n')[6];

  it('each format renders exactly its label (Date or string field), as plain Astro in the card; read back', async () => {
    for (const d of DATE_FORMATS) {
      const el = inner(await applyFieldBinding(CARD, P, 'p', 'date', 'date', d.value)).trim();
      expect(readDateFormat(el, 'p')).toBe(d.value);
      const expr = el.slice(el.indexOf('>{') + 2, el.lastIndexOf('}<'));
      for (const date of [new Date('2026-10-08'), '2026-10-08']) expect(new Function('post', `return ${expr}`)({ data: { date } })).toBe(d.label);
      expect(new Function('post', `return ${expr}`)({ data: {} })).toBeUndefined(); // a post without a date renders nothing
    }
  });

  it('bind with a format → field + format read back; switch; back to as stored', async () => {
    const on = await applyFieldBinding(CARD, P, 'p', 'date', 'date', 'long');
    expect(inner(on)).toBe(`  <p class="text-sm">{post.data.date && new Date(post.data.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</p>`);
    expect(readFieldBinding(inner(on).trim(), 'p')).toBe('date');
    expect(readDateFormat(inner(on).trim(), 'p')).toBe('long');
    const iso = await applyFieldBinding(on, P, 'p', 'date', 'date', 'iso');
    expect(readDateFormat(inner(iso).trim(), 'p')).toBe('iso');
    const raw = await applyFieldBinding(iso, P, 'p', 'date', 'date', '');
    expect(inner(raw)).toBe('  <p class="text-sm">{post.data.date}</p>');
    expect(readDateFormat(inner(raw).trim(), 'p')).toBe('');
  });

  it('static text / a hand-written expression → no format we write', () => {
    expect(readDateFormat('<p>Static</p>', 'p')).toBeNull();
    expect(readDateFormat('<time>{dateText}</time>', 'time')).toBeNull();
    expect(readDateFormat('<div>{post.data.date}</div>', 'div')).toBeNull(); // not a text element
  });
});
