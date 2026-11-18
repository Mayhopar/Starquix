import { describe, it, expect } from 'vitest';
import { linkElementAfterScan, movedKey, noteInlineLinkAdded, noteLinkKeyMove, removeLinkSource, setLinkAttribute, wrapLinkSource } from '../linkSource';

const FILE = 'src/pages/index.astro';
const PAGE = `---
const url = '/x';
---
<main>
  <h2 class="text-2xl">Title</h2>
  <div class="grid">
    <img src="/a.png" alt="A" />
  </div>
  <a href="/about" class="text-blue-500" id="styled">Styled</a>
  <a href="/plain">Plain text</a>
  <a href={url} class="card"><p>Inside</p></a>
  <a
    href="/multi"
    target="_blank"
  >
    <h3>Multi</h3>
  </a>
</main>
`;
const H2 = { line: 5, column: 3 };
const IMG = { line: 7, column: 5 };
const STYLED = { line: 9, column: 3 };
const PLAIN = { line: 10, column: 3 };
const EXPR = { line: 11, column: 3 };
const MULTI = { line: 12, column: 3 };

describe('wrapLinkSource', () => {
  it('puts the element inside a link to the home page, on its own line', () => {
    const { source, element } = wrapLinkSource(PAGE, H2, 'h2', false);
    expect(source.split('\n')[4]).toBe('  <a href="/"><h2 class="text-2xl">Title</h2></a>');
    expect(element).toEqual({ line: 5, column: 3 + '<a href="/">'.length });
  });

  it('a flex or grid item stays the item: the link box is display:contents', () => {
    const { source } = wrapLinkSource(PAGE, IMG, 'img', true);
    expect(source.split('\n')[6]).toBe('    <a href="/" class="contents"><img src="/a.png" alt="A" /></a>');
  });

  it('refuses a location that no longer holds the selected element', () => {
    expect(() => wrapLinkSource(PAGE, H2, 'div', false)).toThrow(/select the element again/);
  });
});

describe('removeLinkSource', () => {
  it('a plain wrapper goes away: + then − gives the original bytes back', async () => {
    const added = wrapLinkSource(PAGE, H2, 'h2', false);
    const removed = await removeLinkSource(added.source, FILE, H2, added.element);
    expect(removed.source).toBe(PAGE);
    expect(removed.element).toEqual(H2);
  });

  it('the display:contents wrapper goes away too', async () => {
    const added = wrapLinkSource(PAGE, IMG, 'img', true);
    expect((await removeLinkSource(added.source, FILE, IMG, added.element)).source).toBe(PAGE);
  });

  it('a styled link keeps its look: the element stays, only the link goes', async () => {
    const { source } = await removeLinkSource(PAGE, FILE, STYLED, null);
    expect(source.split('\n')[8]).toBe('  <span class="text-blue-500" id="styled">Styled</span>');
  });

  it('text with no element of its own stays an element, so the selection has one', async () => {
    const { source } = await removeLinkSource(PAGE, FILE, PLAIN, null);
    expect(source.split('\n')[9]).toBe('  <span>Plain text</span>');
  });

  it('a link set by code loses the expression, and the child keeps its place in the line', async () => {
    const child = { line: 11, column: 3 + '<a href={url} class="card">'.length };
    const { source, element } = await removeLinkSource(PAGE, FILE, EXPR, child);
    expect(source.split('\n')[10]).toBe('  <span class="card"><p>Inside</p></span>');
    expect(element).toEqual({ line: 11, column: 3 + '<span class="card">'.length });
  });

  it('a wrapper laid out on several lines leaves its child where the link started', async () => {
    const { source, element } = await removeLinkSource(PAGE, FILE, MULTI, { line: 16, column: 5 });
    expect(source).toContain('</a>\n  <h3>Multi</h3>\n</main>');
    expect(element).toEqual({ line: 12, column: 3 });
  });

  it('refuses anything but a link', async () => {
    await expect(removeLinkSource(PAGE, FILE, H2, null)).rejects.toThrow(/not a link/);
  });
});

describe('setLinkAttribute', () => {
  it('writes the href in place', async () => {
    const { source } = await setLinkAttribute(PAGE, FILE, STYLED, 'href', '/blog');
    expect(source.split('\n')[8]).toBe('  <a href="/blog" class="text-blue-500" id="styled">Styled</a>');
  });

  it('an empty value drops the attribute: new tab off means no target at all', async () => {
    expect((await setLinkAttribute(PAGE, FILE, MULTI, 'target', '')).source).not.toContain('target=');
  });

  it('never overwrites a link set by code', async () => {
    await expect(setLinkAttribute(PAGE, FILE, EXPR, 'href', '/blog')).rejects.toThrow(/set by code/);
  });

  it('other attributes of a link set by code are fine', async () => {
    const line = (await setLinkAttribute(PAGE, FILE, EXPR, 'target', '_blank')).source.split('\n')[10];
    expect(line).toContain('target="_blank"');
    expect(line).toContain('href={url}');
  });

  it('reports where the selected child lands when the opening tag grows', async () => {
    const added = wrapLinkSource(PAGE, H2, 'h2', false);
    const { element } = await setLinkAttribute(added.source, FILE, H2, 'href', '/about', added.element);
    expect(element).toEqual({ line: 5, column: 3 + '<a href="/about">'.length });
  });
});

describe('selection across a link edit', () => {
  const row = (key: string, tagName: string) => ({ key, tagName });

  it('rebuilds the key at the new position, keeping placement and copy suffixes', () => {
    expect(movedKey('src/a.astro:5:3', { line: 5, column: 15 })).toBe('src/a.astro:5:15');
    expect(movedKey('src/a.astro:5:3~sabc#2', { line: 6, column: 1 })).toBe('src/a.astro:6:1~sabc#2');
  });

  it('stays on the element when the new <a> takes its key, and comes back on ⌘Z', () => {
    noteLinkKeyMove('src/b.astro:5:3', 'src/b.astro:5:15', 'h2');
    const added = [row('src/b.astro:5:3', 'a'), row('src/b.astro:5:15', 'h2')];
    expect(linkElementAfterScan('src/b.astro:5:3', added)?.key).toBe('src/b.astro:5:15');
    const undone = [row('src/b.astro:5:3', 'h2')];
    expect(linkElementAfterScan('src/b.astro:5:15', undone)?.key).toBe('src/b.astro:5:3');
  });

  it('walks every position: + then a longer href, then ⌘Z twice', () => {
    noteLinkKeyMove('src/d.astro:5:3', 'src/d.astro:5:15', 'h2');
    noteLinkKeyMove('src/d.astro:5:15', 'src/d.astro:5:20', 'h2');
    expect(linkElementAfterScan('src/d.astro:5:20', [row('src/d.astro:5:3', 'a'), row('src/d.astro:5:15', 'h2')])?.key).toBe('src/d.astro:5:15');
    expect(linkElementAfterScan('src/d.astro:5:15', [row('src/d.astro:5:3', 'h2')])?.key).toBe('src/d.astro:5:3');
  });

  it('leaves a selection alone while its key still shows the element', () => {
    noteLinkKeyMove('src/e.astro:5:3', 'src/e.astro:5:15', 'h2');
    expect(linkElementAfterScan('src/e.astro:5:3', [row('src/e.astro:5:3', 'h2')])).toBeNull();
    expect(linkElementAfterScan('src/never.astro:1:1', [])).toBeNull();
  });

  describe('linked text', () => {
    const P = 'src/f.astro:7:5';
    const INLINE = 'src/f.astro:7:17';
    const LOC = { file: 'src/f.astro', line: 7, column: 17 };
    const inline = { key: INLINE, tagName: 'a', parentKey: P, linkHref: '/', sourceLocation: LOC };
    const paragraph = { key: P, tagName: 'p', parentKey: null };

    it('moves to the new link once it is in the file: the paragraph has no link of its own', () => {
      noteInlineLinkAdded(P);
      const unsaved = { ...inline, key: 'dynamic:a:0', sourceLocation: undefined };
      expect(linkElementAfterScan(P, [paragraph, unsaved])).toBeNull();
      expect(linkElementAfterScan(P, [paragraph, inline])?.key).toBe(INLINE);
    });

    it('moves once: the paragraph can be selected again', () => {
      noteInlineLinkAdded(P);
      linkElementAfterScan(P, [paragraph, inline]);
      expect(linkElementAfterScan(P, [paragraph, inline])).toBeNull();
    });

    it('⌘Z takes the link away: back on the paragraph', () => {
      noteInlineLinkAdded(P);
      linkElementAfterScan(P, [paragraph, inline]);
      expect(linkElementAfterScan(INLINE, [paragraph])?.key).toBe(P);
    });
  });
});
