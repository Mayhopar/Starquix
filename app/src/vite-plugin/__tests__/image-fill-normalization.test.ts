import { describe, expect, it } from 'vitest';
import { normalizeImageFillSource } from '../../../../preview-template/src/plugins/sq-image-fill.js';
import { swapElementTagWithUndo, restoreRegionAtLocation } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

const loc = { line: 1, column: 1 };
const tag = '<img data-src="/deferred.png" SRC="/hero.png" alt="Mountain &amp; sky" class="w-64 h-40 rounded-lg object-cover" />';
const normalize = (input: string, change: Record<string, unknown>, expectedTag = input) =>
  swapElementTagWithUndo(input, loc, 'image-fill', '', { expectedTag, change });

describe('atomic image Fill normalization', () => {
  it('retains source pixels, explicit box classes and accessible name on a fit change', async () => {
    const { updated } = await normalize(tag, { type: 'fit', value: 'contain' });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['w-64', 'h-40', 'rounded-lg', "bg-[url('/hero.png')]", 'bg-contain', 'bg-center', 'bg-no-repeat']));
    expect(el.className).not.toContain('object-');
    expect(el.getAttribute('role')).toBe('img');
    expect(el.getAttribute('aria-label')).toBe('Mountain & sky');
    expect(el.getAttribute('data-src')).toBe('/deferred.png');
    expect(el.hasAttribute('src')).toBe(false);
    expect(el.hasAttribute('alt')).toBe(false);
  });

  it('replaces the image and preserves unrelated expression bytes', async () => {
    const input = tag.replace('data-src="/deferred.png"', 'data-note={{ nested: { example: \'src="decoy"\' } }}');
    const { updated } = await normalize(input, { type: 'replace', src: '/new.png?version=2' });
    expect(updated).toContain('data-note={{ nested: { example: \'src="decoy"\' } }}');
    expect(updated).toContain("bg-[url('/new.png?version=2')]");
    expect(updated).not.toContain('/hero.png');
  });

  it('normalizes decorative and removed images without inventing an accessible name', async () => {
    const decorative = await normalize(tag.replace('Mountain &amp; sky', ''), { type: 'position', value: 'right-top' });
    expect(decorative.updated).not.toMatch(/role=|aria-label=/);
    const removed = await normalize(tag, { type: 'remove' });
    const el = new DOMParser().parseFromString(removed.updated, 'text/html').body.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.className).toBe('w-64 h-40 rounded-lg');
    expect(el.hasAttribute('role')).toBe(false);
    expect(el.hasAttribute('aria-label')).toBe(false);
  });

  it('preserves a pre-existing authored accessible name and permits an explicit empty description', async () => {
    const named = tag.replace(' alt=', ' aria-label="Authored name" alt=');
    expect((await normalize(named, { type: 'fit', value: 'cover' })).updated).toContain('aria-label="Authored name"');
    const cleared = (await normalize(tag, { type: 'description', value: '' })).updated;
    expect(cleared).not.toMatch(/aria-label=|role=/);
  });

  it('translates responsive fit tokens without flattening unrelated variants', async () => {
    const input = tag.replace('rounded-lg object-cover', 'rounded-lg md:w-80 object-cover md:object-contain hover:opacity-50');
    const { updated } = await normalize(input, { type: 'fit', value: 'fill', variant: 'md:' });
    expect(updated).toContain('md:w-80');
    expect(updated).toContain('hover:opacity-50');
    expect(updated).toContain('bg-cover');
    expect(updated).toContain('md:bg-[length:100%_100%]');
    expect(updated).not.toContain('md:bg-contain');
  });

  it.each(['\n', '\r\n'])('Undo and Redo restore exact acknowledged source regions with %j', async newline => {
    const input = '<main>' + newline + '  ' + tag + newline + '  <p>Sibling</p>' + newline + '</main>' + newline;
    const { updated, extra } = await swapElementTagWithUndo(input, { line: 2, column: 3 }, 'image-fill', '', { expectedTag: tag, change: { type: 'fit', value: 'contain' } });
    const at = { line: extra.replacedLine, column: 1 };
    const undone = restoreRegionAtLocation(updated, at, extra.replacedLineCount, extra.originalSegment).content;
    expect(undone).toBe(input);
    expect(restoreRegionAtLocation(undone, at, extra.originalLineCount, extra.replacementSegment).content).toBe(updated);
  });

  it.each([
    tag.replace('SRC="/hero.png"', 'src={hero}'),
    tag.replace('SRC="/hero.png"', 'src="/hero.png" style="object-fit:contain"'),
    tag.replace('SRC="/hero.png"', 'src="/hero.png" role="button"'),
    tag.replace('SRC="/hero.png"', 'src="/hero.png" {...props}'),
    tag.replace('object-cover', 'object-scale-down'),
    tag.replace(' alt=', ' ALT="Duplicate" alt='),
  ])('refuses source a container cannot carry (expression src, style, authored role, spreads, custom fitting, duplicates): %s', async input => {
    await expect(normalize(input, { type: 'fit', value: 'cover' })).rejects.toThrow(/image fill:/i);
  });

  // Figma model (2026-09-19): delivery hints are image-only → dropped; layout
  // classes ride along; an earlier background fill is replaced. Never a refusal.
  it.each([
    ['srcset', tag.replace('SRC="/hero.png"', 'src="/hero.png" srcset="/wide.png 2x"'), (el: Element) => expect(el.hasAttribute('srcset')).toBe(false)],
    ['sizes', tag.replace('SRC="/hero.png"', 'src="/hero.png" sizes="50vw"'), (el: Element) => expect(el.hasAttribute('sizes')).toBe(false)],
    ['loading', tag.replace('SRC="/hero.png"', 'src="/hero.png" loading="lazy"'), (el: Element) => expect(el.hasAttribute('loading')).toBe(false)],
    ['decoding', tag.replace('SRC="/hero.png"', 'src="/hero.png" decoding="async"'), (el: Element) => expect(el.hasAttribute('decoding')).toBe(false)],
    ['fetchpriority', tag.replace('SRC="/hero.png"', 'src="/hero.png" fetchpriority="high"'), (el: Element) => expect(el.hasAttribute('fetchpriority')).toBe(false)],
    ['inline', tag.replace('object-cover', 'inline object-cover'), (el: Element) => expect(el.classList.contains('inline')).toBe(true)],
    ['md:inline', tag.replace('object-cover', 'object-cover md:inline'), (el: Element) => expect(el.classList.contains('md:inline')).toBe(true)],
    ['align-baseline', tag.replace('object-cover', 'align-baseline object-cover'), (el: Element) => expect(el.classList.contains('align-baseline')).toBe(true)],
    ['min-h-min', tag.replace('h-40', 'h-40 min-h-min'), (el: Element) => expect(el.classList.contains('min-h-min')).toBe(true)],
    ['md:h-auto', tag.replace('h-40', 'h-40 md:h-auto'), (el: Element) => expect(el.classList.contains('md:h-auto')).toBe(true)],
    ['old bg url', tag.replace('object-cover', "bg-[url('/old.png')] object-cover"), (el: Element) => { expect(el.className).not.toContain('/old.png'); expect(el.className).toContain("bg-[url('/hero.png')]"); }],
    ['old gradient', tag.replace('object-cover', 'bg-gradient-to-r object-cover'), (el: Element) => expect(el.className).not.toContain('bg-gradient')],
  ])('converts instead of refusing — %s', async (_name, input, check) => {
    const { updated } = await normalize(input, { type: 'fit', value: 'cover' });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['w-64', 'h-40', 'rounded-lg', "bg-[url('/hero.png')]", 'bg-cover']));
    check(el);
  });

  it('an unsized <img> needs the rendered box (no box → refusal, box → aspect + width classes)', async () => {
    await expect(normalize(tag.replace('w-64 h-40', 'w-full'), { type: 'fit', value: 'cover' })).rejects.toThrow(/explicit width and height/i);
    const { updated } = await swapElementTagWithUndo(tag.replace('w-64 h-40', 'w-64 h-auto'), loc, 'image-fill', '', { expectedTag: tag.replace('w-64 h-40', 'w-64 h-auto'), change: { type: 'fit', value: 'cover' }, box: { width: 256, height: 128 } });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['w-64', 'aspect-[2/1]'])); expect(el.className).not.toContain('h-auto');
  });

  it('refuses stale expected source instead of converting another selection', async () => {
    await expect(normalize(tag, { type: 'fit', value: 'cover' }, tag.replace('/hero.png', '/stale.png'))).rejects.toThrow(/changed/i);
  });

  it.each(['blob:https://editor/preview', 'javascript:alert(1)', '/quote\'break.png', '/space break.png'])('refuses unsafe persistent background URLs: %s', async src => {
    await expect(normalize(tag, { type: 'replace', src })).rejects.toThrow(/image fill:/i);
  });
  it.each([
    tag.replace('SRC="/hero.png"', 'src="/hero.png" aria-hidden="true"'),
    tag.replace('SRC="/hero.png"', 'src="/hero.png" aria-labelledby="caption"'),
    tag.replace('class="', 'class:list={[extra]} class="'),
    tag.replace('object-cover', 'object-[25%_40%]'),
    tag.replace('object-cover', 'object-cover object-contain'),
    tag.replace(' alt=', ' onload="start()" alt='),
  ])('also refuses ambiguous naming and presentation a container cannot carry: %s', async input => {
    await expect(normalize(input, { type: 'fit', value: 'contain' })).rejects.toThrow(/image fill:/i);
  });

  it('refuses a picture ancestor even if srcset is outside the selected tag', async () => {
    const input = '<picture>\n  <source srcset="/wide.png" />\n  ' + tag + '\n</picture>';
    await expect(swapElementTagWithUndo(input, { line: 3, column: 3 }, 'image-fill', '', { expectedTag: tag, change: { type: 'fit', value: 'contain' } })).rejects.toThrow(/image fill:/i);
  });

  it('accepts plain void img syntax and preserves fallback color while replacing the image', async () => {
    const input = tag.replace(' />', '>').replace('rounded-lg', 'rounded-lg bg-black');
    const { updated } = await normalize(input, { type: 'replace', src: '/next.png' });
    expect(updated).toContain('bg-black');
    expect(updated).toContain("bg-[url('/next.png')]");
    expect(updated).toContain('</div>');
  });

  it('fill kinds are exclusive: a colour edit and a gradient both REPLACE the image (Figma model 2026-09-20)', async () => {
    const color = await normalize(tag, { type: 'color', value: 'bg-black', variant: '' });
    expect(color.updated).not.toContain("bg-[url(");
    expect(color.updated).toContain('bg-black');
    const gradient = await normalize(tag, { type: 'gradient', value: 'bg-gradient-to-r from-black to-white', variant: '' });
    expect(gradient.updated).toContain('bg-gradient-to-r from-black to-white');
    expect(gradient.updated).not.toMatch(/url\(|aria-label=|role=/);
  });

  it.each(['lg:evil:', '[&>img]:', 'hover: ', 'md:!'])('rejects unsupported class scope %s', async variant => {
    await expect(normalize(tag, { type: 'fit', value: 'contain', variant })).rejects.toThrow(/image fill:/i);
  });

  it.each(['/new.png?x=1&y=2', '/new.png?x=1&amp;y=2'])('refuses a replacement URL requiring HTML entity escaping: %s', async src => {
    await expect(normalize(tag, { type: 'replace', src })).rejects.toThrow(/image fill:.*URL/i);
  });

  it.each([
    'portrait:object-contain', 'lg:portrait:object-contain', 'group-hover:object-cover',
    '[&>img]:object-contain', '!object-contain', 'md:!object-cover', 'object-contain!',
    'portrait:h-auto', 'md:h-auto!', 'supports-[display:grid]:h-auto',
    'min-[800px]:inline', '!inline', "!bg-[url('/other.png')]", 'portrait:min-h-min',
  ])('refuses unsupported existing scope or important syntax before retaining %s', async token => {
    const input = tag.replace('object-cover', token);
    await expect(normalize(input, { type: 'description', value: 'New description' })).rejects.toThrow(/image fill:/i);
  });

  it.each([
    'p-4', 'px-4', 'py-2', 'pt-px', 'pr-4', 'pb-4', 'pl-4', 'ps-2', 'pe-2',
    'p-[12px]', 'md:p-4', 'hover:px-2', 'p-4 md:p-0', 'p-0 md:px-6',
  ])('keeps authored padding on the container (Figma model: the fill covers the box): %s', async padding => {
    const input = tag.replace('rounded-lg', `rounded-lg bg-black ${padding}`);
    const { updated } = await normalize(input, { type: 'description', value: 'New description' });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.className.split(' ')).toEqual(expect.arrayContaining([...padding.split(' '), 'bg-black', 'rounded-lg']));
  });

  it('allows explicit zero padding while retaining fallback color and radius', async () => {
    const input = tag.replace('rounded-lg', 'rounded-lg bg-black p-0 md:px-0');
    const { updated } = await normalize(input, { type: 'description', value: 'New description' });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['rounded-lg', 'bg-black', 'p-0', 'md:px-0', "bg-[url('/hero.png')]", 'bg-cover']));
  });

  it.each(['hero.png', './hero.png', '../hero.png', '?version=2', '#photo'])('refuses document-relative original and replacement URLs: %s', async src => {
    const original = tag.replace('/hero.png', src);
    await expect(normalize(original, { type: 'description', value: 'New description' })).rejects.toThrow(/image fill:.*URL/i);
    await expect(normalize(tag, { type: 'replace', src })).rejects.toThrow(/image fill:.*URL/i);
  });

  it('marks normalized image ownership and edits its description with exact source Undo', async () => {
    const first = await normalize(tag, { type: 'fit', value: 'contain' });
    expect(first.updated).toContain('data-sq-image-fill="true"');
    const opening = first.updated.slice(0, first.updated.indexOf('>') + 1);
    const changed = await swapElementTagWithUndo(first.updated, loc, 'image-fill', '', { expectedTag: opening, change: { type: 'description', value: 'New image name' } });
    expect(changed.updated).toContain('aria-label="New image name"');
    expect(changed.updated).toContain("bg-[url('/hero.png')]");
    expect(restoreRegionAtLocation(changed.updated, { line: changed.extra.replacedLine, column: 1 }, changed.extra.replacedLineCount, changed.extra.originalSegment).content).toBe(first.updated);
    const changedOpening = changed.updated.slice(0, changed.updated.indexOf('>') + 1);
    const removed = await swapElementTagWithUndo(changed.updated, loc, 'image-fill', '', { expectedTag: changedOpening, change: { type: 'remove' } });
    expect(removed.updated).not.toMatch(/aria-label=|role=|bg-\[url/);
    expect(removed.updated).toContain('w-64 h-40 rounded-lg');
  });

  it('refuses description changes on unowned or nonempty divs', async () => {
    for (const input of ['<div class="w-24 h-24" role="img" aria-label="Authored"></div>', '<div data-sq-image-fill="true" class="w-24 h-24">Meaningful child</div>']) {
      const expectedTag = input.slice(0, input.indexOf('>') + 1);
      await expect(swapElementTagWithUndo(input, loc, 'image-fill', '', { expectedTag, change: { type: 'description', value: 'Changed' } })).rejects.toThrow(/image fill:/i);
    }
  });

});

it('preserves the verified Tailwind image max-width rule without baking viewport pixels', () => {
  const source = '<img src="/hero.png" class="w-60 h-40">';
  const output = normalizeImageFillSource(source, { line: 1, column: 1 }, { expectedTag: source, change: { type: 'fit', value: 'cover' }, preserveMaxWidth: true });
  expect(output).toContain('max-w-full');
  expect(output).not.toContain('240px');
});
it('replaces an already-normalized gradient without leaving competing gradient stops', () => {
  const source = '<div data-sq-image-fill="true" class="w-60 h-40 bg-gradient-to-r from-white to-black"></div>';
  const output = normalizeImageFillSource(source, { line: 1, column: 1 }, { expectedTag: source.slice(0, source.indexOf('>') + 1), change: { type: 'gradient', value: 'bg-gradient-to-b from-black to-white' } });
  expect(output).not.toContain('bg-gradient-to-r'); expect(output).not.toContain('from-white'); expect(output).not.toContain('to-black'); expect(output).toContain('bg-gradient-to-b from-black to-white');
});
it.each(['h-full', 'h-1/2', 'h-[50%]', 'w-full', 'w-1/2', 'w-[50%]'])('percentage sizing is a sized box on the container too (Figma model 2026-09-19): %s', size => {
  const source = `<img src="/hero.png" class="${size.startsWith('h-') ? 'w-60' : 'h-40'} ${size}">`;
  const output = normalizeImageFillSource(source, { line: 1, column: 1 }, { expectedTag: source, change: { type: 'fit', value: 'cover' } });
  expect(output).toContain(size); expect(output).not.toMatch(/aspect-|w-\[\d+px\]/);
});

describe('Figma model: the element is one thing, its fill converts under the hood (2026-09-19)', () => {
  const fluid = '<img src="/hero.png" alt="Mountain" class="w-full h-auto rounded-lg" loading="lazy" decoding="async">';
  it('a gradient on a fluid <img> (w-full h-auto, loading/decoding) becomes a container that keeps its rendered box — no refusal', async () => {
    const { updated } = await swapElementTagWithUndo(fluid, loc, 'image-fill', '', { expectedTag: fluid, change: { type: 'gradient', value: 'bg-gradient-to-r from-pink-500 to-yellow-500' }, box: { width: 1200, height: 675 } });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.getAttribute('data-sq-image-fill')).toBe('true');
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['w-full', 'rounded-lg', 'aspect-[16/9]', 'bg-gradient-to-r', 'from-pink-500', 'to-yellow-500']));
    expect(el.className).not.toMatch(/h-auto|bg-\[url/);
    expect(el.hasAttribute('loading')).toBe(false); expect(el.hasAttribute('src')).toBe(false);
  });
  it('an <img> with no size classes gets its rendered width too; an explicit h-* keeps it and gets no aspect', async () => {
    const bare = '<img src="/hero.png" alt="" class="rounded">';
    const a = new DOMParser().parseFromString((await swapElementTagWithUndo(bare, loc, 'image-fill', '', { expectedTag: bare, change: { type: 'gradient', value: 'bg-gradient-to-b from-white to-black' }, box: { width: 300, height: 200 } })).updated, 'text/html').body.firstElementChild!;
    expect(a.className.split(' ')).toEqual(expect.arrayContaining(['rounded', 'w-[300px]', 'aspect-[3/2]']));
    const sized = '<img src="/hero.png" alt="" class="w-64 h-40">';
    const b = new DOMParser().parseFromString((await swapElementTagWithUndo(sized, loc, 'image-fill', '', { expectedTag: sized, change: { type: 'gradient', value: 'bg-gradient-to-b from-white to-black' }, box: { width: 256, height: 160 } })).updated, 'text/html').body.firstElementChild!;
    expect(b.className).not.toMatch(/aspect-|w-\[/);
  });
  it('vice versa: an owned container given an image becomes an <img> again, box classes kept, fit/position mapped back', async () => {
    const owned = '<div data-sq-image-fill="true" class="w-full rounded-lg aspect-[16/9] bg-gradient-to-r from-pink-500 to-yellow-500" role="img" aria-label="Mountain"></div>';
    const { updated } = await swapElementTagWithUndo(owned, loc, 'image-fill', '', { expectedTag: owned.slice(0, owned.indexOf('></div>') + 1), change: { type: 'replace', src: '/uploads/new_photo.png' } });
    const el = new DOMParser().parseFromString(updated, 'text/html').body.firstElementChild!;
    expect(el.tagName).toBe('IMG');
    expect(el.getAttribute('src')).toBe('/uploads/new_photo.png'); expect(el.getAttribute('alt')).toBe('Mountain');
    expect(el.className.split(' ')).toEqual(expect.arrayContaining(['w-full', 'rounded-lg', 'aspect-[16/9]', 'object-cover']));
    expect(el.className).not.toMatch(/bg-|from-|to-/); expect(el.hasAttribute('data-sq-image-fill')).toBe(false); expect(el.hasAttribute('role')).toBe(false);
    expect(updated).not.toContain('</div>');
    const cover = '<div data-sq-image-fill="true" class="w-64 h-40 bg-[url(\'/a.png\')] bg-contain bg-top bg-no-repeat"></div>';
    const c = new DOMParser().parseFromString((await swapElementTagWithUndo(cover, loc, 'image-fill', '', { expectedTag: cover.slice(0, cover.indexOf('></div>') + 1), change: { type: 'replace', src: '/b.png' } })).updated, 'text/html').body.firstElementChild!;
    expect(c.tagName).toBe('IMG'); expect(c.className.split(' ')).toEqual(['w-64', 'h-40', 'object-contain', 'object-top']);
  });
});

it('an <img> whose src has an underscore is still inspected and converted — the URL rule applies only to a kept background image', async () => {
  const under = '<img src="/uploads/my_photo.png" alt="" class="w-64 h-40">';
  const { updated } = await swapElementTagWithUndo(under, loc, 'image-fill', '', { expectedTag: under, change: { type: 'color', value: 'bg-white' } });
  expect(updated).toBe('<div data-sq-image-fill="true" class="w-64 h-40 bg-white"></div>');
  await expect(swapElementTagWithUndo(under, loc, 'image-fill', '', { expectedTag: under, change: { type: 'fit', value: 'cover' } })).rejects.toThrow(/unsupported characters/);
});
