// task-140 media fill: the container -> img/video tag-swap materializer.
// Imports THE plugin implementation (single source, parity law).
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line import/no-relative-packages
import { swapElementTag, swapElementTagWithUndo, restoreRegionAtLocation, updateImageAttribute } from '../../../../preview-template/src/plugins/sq-source-plugin.js';

const FILE = `---
const x = 1;
---
<section class="page">
  <div class="w-full aspect-video" data-sq-media="true"></div>
  <div class="with-text" data-sq-media="true">hello</div>
  <div class="parent"><span>child</span></div>
  <a class="link" href="/x"></a>
</section>
`;

const loc = (line: number, column: number) => ({ file: 'x.astro', line, column });

describe('swapElementTag', () => {
  it('div -> img keeps classes, drops data-sq-media, adds src+alt', async () => {
    const out = await swapElementTag(FILE, loc(5, 3), 'image', '/uploads/photo.jpg');
    expect(out).toContain('<img class="w-full aspect-video" src="/uploads/photo.jpg" alt="">');
    expect(out.match(/data-sq-media/g)?.length).toBe(1); // only the second div's attr remains
  });

  it('div -> video gets the ambient-loop attrs', async () => {
    const out = await swapElementTag(FILE, loc(5, 3), 'video', '/uploads/clip.mp4');
    expect(out).toContain('<video class="w-full aspect-video" src="/uploads/clip.mp4" autoplay muted loop playsinline></video>');
  });

  it('text-only content is replaced (design: confirm handled client-side)', async () => {
    const out = await swapElementTag(FILE, loc(6, 3), 'image', '/u/p.png');
    expect(out).toContain('<img class="with-text" src="/u/p.png" alt="">');
    expect(out).not.toContain('>hello<');
  });

  it('throws on element children', async () => {
    await expect(swapElementTag(FILE, loc(7, 3), 'image', '/u/p.png')).rejects.toThrow(/children/);
  });

  it('throws on non-container tags and unknown kinds', async () => {
    await expect(swapElementTag(FILE, loc(8, 3), 'image', '/u/p.png')).rejects.toThrow(/not an eligible container/);
    await expect(swapElementTag(FILE, loc(5, 3), 'audio', '/u/p.png')).rejects.toThrow(/unknown kind/);
  });

  it('escapes quotes in src', async () => {
    const out = await swapElementTag(FILE, loc(5, 3), 'image', '/u/a"b.png');
    expect(out).toContain('src="/u/a&quot;b.png"');
  });

  // task-141: reverse swap (un-resolve) + re-swap on existing media
  it('swaps img back to div, dropping media attrs, keeping class', async () => {
    const src = `<img class="w-full h-40" src="/uploads/a.jpg" alt="" data-x="1" />`;
    const out = await swapElementTag(src, { line: 1, column: 1 }, 'container', '');
    expect(out).toContain('<div class="w-full h-40" data-x="1"></div>');
    expect(out).not.toMatch(/src=|alt=/);
  });

  it('swaps video back to div, dropping playback attrs', async () => {
    const src = `<video class="w-full" src="/uploads/a.mp4" autoplay muted loop playsinline></video>`;
    const out = await swapElementTag(src, { line: 1, column: 1 }, 'container', '');
    expect(out).toContain('<div class="w-full"></div>');
  });

  it('re-swaps img src in place (kind image on existing img)', async () => {
    const src = `<img class="w-full" src="/uploads/old.jpg" alt="" />`;
    const out = await swapElementTag(src, { line: 1, column: 1 }, 'image', '/uploads/new.jpg');
    expect(out).toContain('src="/uploads/new.jpg"');
    expect(out).toContain('class="w-full"');
  });

  it('swaps img to video when a video is dropped on it', async () => {
    const src = `<img class="w-full" src="/uploads/old.jpg" alt="" />`;
    const out = await swapElementTag(src, { line: 1, column: 1 }, 'video', '/uploads/clip.mp4');
    expect(out).toMatch(/<video[^>]*src="\/uploads\/clip\.mp4"[^>]*autoplay/);
  });

  // Idempotent delete: 'remove media' on a line that is ALREADY a container
  // (stale selection after a successful un-resolve, double click) is a no-op
  // success, not an error.
  it('kind container from a container is a no-op (file unchanged)', async () => {
    const out = await swapElementTag(FILE, loc(5, 3), 'container', '');
    expect(out).toBe(FILE);
  });

  // Data-bound media: src={expr} means the image comes from frontmatter/props.
  // A file-level swap would sever the binding — refuse and point at the data.
  it('refuses img/video with an expression src (frontmatter/props binding)', async () => {
    const src = `<img class="w-full" src={frontmatter.image} alt="" />`;
    await expect(swapElementTag(src, { line: 1, column: 1 }, 'image', '/uploads/x.jpg'))
      .rejects.toThrow(/bound to data/);
    await expect(swapElementTag(src, { line: 1, column: 1 }, 'container', ''))
      .rejects.toThrow(/bound to data/);
  });

  // task-141: astro:assets <Image> in component sources renders an <img> in
  // the DOM (attrs forwarded), so the editor CAN select it — the writer must
  // name the real blocker instead of 'not an eligible container'.
  it('Astro component tags get a component-specific error', async () => {
    const src = `<Image class="w-full" src={hero} alt="" />`;
    await expect(swapElementTag(src, { line: 1, column: 1 }, 'container', ''))
      .rejects.toThrow(/Astro component/);
  });
});

it.each([
  '<img class="w-24" src="/old.png" alt="Release image" loading="eager" width="96" />',
  '<video src="/old.png" poster="/poster.png" controls preload="metadata">Fallback</video>',
])('same-kind replacement changes only src: %s', async input => {
  const kind = input.startsWith('<img') ? 'image' : 'video';
  const result = await swapElementTag(input, loc(1, 1), kind, '/new.png');
  expect(result).toBe(input.replace('/old.png', '/new.png'));
});

it.each([
  ['inline', '<main><img src="/old.png" alt="Release image" loading="eager" /><p>Sibling</p></main>', 1, 7],
  ['multiline', '<main>\n  <img\n    src="/old.png"\n    alt="Release image"\n    loading="eager" />\n  <p>Sibling</p>\n</main>\n', 2, 3],
  ['CRLF', '<main>\r\n  <img src="/old.png" alt="Release image" />\r\n</main>\r\n', 2, 3],
])('the acknowledged %s region restores exact source semantics through replace, conversion, Undo and Redo', async (_name, input, line, column) => {
  for (const kind of ['image', 'video', 'container']) {
    const { updated, extra } = await swapElementTagWithUndo(input, loc(line, column), kind, '/new.png');
    const at = loc(extra.replacedLine, 1);
    const undone = restoreRegionAtLocation(updated, at, extra.replacedLineCount, extra.originalSegment).content;
    expect(undone).toBe(input);
    expect(restoreRegionAtLocation(undone, at, extra.originalLineCount, extra.replacementSegment).content).toBe(updated);
  }
});

it.each([
  '<img data-src="/deferred.png" src="/old.png" alt="Release image" />',
  '<img title=\'example src="/decoy.png"\' src="/old.png" alt="Release image" />',
  '<img data-note={{ nested: { example: \'src="/decoy.png"\' } }} src="/old.png" alt="Release image" />',
  '<img title="example src={frontmatter.image}" src="/old.png" alt="Release image" />',
  '<video data-src="/deferred.png" src="/old.png" poster="/poster.png"></video>',
])('only the actual top-level src changes, with exact Undo/Redo: %s', async input => {
  const { updated, extra } = await swapElementTagWithUndo(input, loc(1, 1), input.startsWith('<video') ? 'video' : 'image', '/new.png');
  expect(updated).toBe(input.replace('src="/old.png"', 'src="/new.png"'));
  const at = loc(extra.replacedLine, 1);
  const undone = restoreRegionAtLocation(updated, at, extra.replacedLineCount, extra.originalSegment).content;
  expect(undone).toBe(input);
  expect(restoreRegionAtLocation(undone, at, extra.originalLineCount, extra.replacementSegment).content).toBe(updated);
});

it('adds a missing real src while preserving data-src and quoted lookalikes', async () => {
  const input = '<img data-src="/deferred.png" title=\'src="/decoy.png"\' alt="Release image" />';
  expect(await swapElementTag(input, loc(1, 1), 'image', '/new.png')).toBe(input.replace('<img', '<img src="/new.png"'));
});

it('replaces an unquoted real src without duplicating it and escapes replacement quotes', async () => {
  const input = '<img data-src="/deferred.png" src=/old.png alt="Release image" />';
  expect(await swapElementTag(input, loc(1, 1), 'image', '/new"file.png')).toBe('<img data-src="/deferred.png" src="/new&quot;file.png" alt="Release image" />');
});

it('refuses the actual dynamic src despite preceding static src lookalikes', async () => {
  const input = '<img data-src="/deferred.png" title=\'src="/decoy.png"\' src={frontmatter.image} />';
  await expect(swapElementTag(input, loc(1, 1), 'image', '/new.png')).rejects.toThrow(/bound to data/);
});


it.each([
  `<img title={'src="decoy"' /* src="comment" */} src="/old.png" />`,
  '<img title={`nested ${`src="decoy"`} end`} src="/old.png" />',
])('preserves nested template/comment expression boundaries: %s', async input => {
  expect(await swapElementTag(input, loc(1, 1), 'image', '/new.png')).toBe(input.replace('src="/old.png"', 'src="/new.png"'));
});

it.each([
  '<img src="/a.png" src="/b.png" />',
  '<img title={/}/.test(value)} src="/old.png" />',
  '<img title={{ nested: "unclosed" } src="/old.png" />',
])('refuses ambiguous or unsupported attribute boundaries: %s', async input => {
  await expect(swapElementTag(input, loc(1, 1), 'image', '/new.png')).rejects.toThrow();
});

it('the actual image-attribute helper changes only top-level alt, preserving lookalikes', async () => {
  const input = `<img data-alt="untouched" title='alt="decoy"' src="/old.png" alt="Old" />`;
  expect(await updateImageAttribute(input, loc(1, 1), 'alt', 'New "quoted" & literal')).toBe(input.replace('alt="Old"', 'alt="New &quot;quoted&quot; &amp; literal"'));
});

it('the actual image helper retains existing expression replacement and missing attribute behavior', async () => {
  const input = `<img title={{ nested: { text: 'loading="decoy"' } }} alt={description} />`;
  expect(await updateImageAttribute(input, loc(1, 1), 'alt', 'New')).toBe(input.replace('alt={description}', 'alt="New"'));
  expect(await updateImageAttribute(input, loc(1, 1), 'loading', 'lazy')).toBe(input.replace('<img', '<img loading="lazy"'));
});

it.each([
  '<img data-src="/deferred.png" SRC="/old.png" alt="Release image" />',
  '<img title=\'SRC="/decoy.png"\' sRc = "/old.png" alt="Release image" />',
  '<video data-SRC="/deferred.png" SrC="/old.png" poster="/poster.png"></video>',
])('case-insensitive HTML src identity preserves spelling and exact Undo/Redo: %s', async input => {
  const { updated, extra } = await swapElementTagWithUndo(input, loc(1, 1), input.startsWith('<video') ? 'video' : 'image', '/new.png');
  expect(updated).toBe(input.replace('/old.png', '/new.png'));
  const at = loc(extra.replacedLine, 1);
  const undone = restoreRegionAtLocation(updated, at, extra.replacedLineCount, extra.originalSegment).content;
  expect(undone).toBe(input);
  expect(restoreRegionAtLocation(undone, at, extra.originalLineCount, extra.replacementSegment).content).toBe(updated);
});

it.each([
  '<img data-src="/deferred.png" SRC={frontmatter.image} />',
  '<img title=\'src="/decoy.png"\' sRc={frontmatter.image} />',
  '<video SrC={frontmatter.video}></video>',
])('refuses case-variant bound src before producing a changed receipt: %s', async input => {
  await expect(swapElementTagWithUndo(input, loc(1, 1), input.startsWith('<video') ? 'video' : 'image', '/new.png')).rejects.toThrow(/bound to data/);
});

it.each([
  '<img SRC="/first.png" src="/second.png" />',
  '<img src="/first.png" SRC="/second.png" />',
  '<video sRc="/first.png" SrC="/second.png"></video>',
])('refuses HTML-equivalent duplicate src attributes: %s', async input => {
  await expect(swapElementTagWithUndo(input, loc(1, 1), input.startsWith('<video') ? 'video' : 'image', '/new.png')).rejects.toThrow(/Ambiguous image attribute/);
});

it('shared image helper preserves the spelling and separator of an existing HTML attribute', async () => {
  const input = '<img data-ALT="untouched" ALT = "Old" src="/image.png" />';
  expect(await updateImageAttribute(input, loc(1, 1), 'alt', 'New')).toBe(input.replace('"Old"', '"New"'));
});
