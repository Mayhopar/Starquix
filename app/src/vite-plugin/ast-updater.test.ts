import { describe, it, expect } from 'vitest';
import { getElementSource, updateElementSource, updateLinkAttribute } from './ast-updater';

describe('getElementSource', () => {
  it('extracts a simple element with its content', () => {
    const content = `<div>
  <nav class="flex gap-4">
    <a href="/">Home</a>
    <a href="/about">About</a>
  </nav>
</div>`;

    const result = getElementSource(content, { file: 'test.astro', line: 2, column: 3 });

    expect(result.source).toBe(`<nav class="flex gap-4">
    <a href="/">Home</a>
    <a href="/about">About</a>
  </nav>`);
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(5);
  });

  it('extracts a self-closing element', () => {
    const content = `<div>
  <img src="photo.jpg" class="w-full" />
</div>`;

    const result = getElementSource(content, { file: 'test.astro', line: 2, column: 3 });

    expect(result.source).toBe('<img src="photo.jpg" class="w-full" />');
    expect(result.startLine).toBe(2);
    expect(result.endLine).toBe(2);
  });

  it('handles nested elements of the same type', () => {
    const content = `<div>
  <div class="outer">
    <div class="inner">Content</div>
  </div>
</div>`;

    const result = getElementSource(content, { file: 'test.astro', line: 2, column: 3 });

    expect(result.source).toBe(`<div class="outer">
    <div class="inner">Content</div>
  </div>`);
  });
});

describe('updateElementSource', () => {
  it('replaces element source with new content', () => {
    const content = `<div>
  <nav class="flex gap-4">
    <a href="/">Home</a>
  </nav>
</div>`;

    const newSource = `<nav class="flex gap-4">
    <a href="/">Home</a>
    <a href="/about">About</a>
  </nav>`;

    const result = updateElementSource(content, 2, 4, newSource);

    expect(result).toBe(`<div>
  <nav class="flex gap-4">
    <a href="/">Home</a>
    <a href="/about">About</a>
  </nav>
</div>`);
  });

  it('handles single-line replacement', () => {
    const content = `<div>
  <span>Old text</span>
</div>`;

    const result = updateElementSource(content, 2, 2, '<span>New text</span>');

    expect(result).toBe(`<div>
  <span>New text</span>
</div>`);
  });
});

describe('updateLinkAttribute', () => {
  it('replaces existing href attribute', async () => {
    const content = '<a href="/" class="nav-link">Home</a>';
    const result = await updateLinkAttribute(content, 'test.astro', { file: 'test.astro', line: 1, column: 1 }, 'href', '/about');
    expect(result).toBe('<a href="/about" class="nav-link">Home</a>');
  });

  it('replaces existing target attribute', async () => {
    const content = '<a href="/" target="_self">Home</a>';
    const result = await updateLinkAttribute(content, 'test.astro', { file: 'test.astro', line: 1, column: 1 }, 'target', '_blank');
    expect(result).toBe('<a href="/" target="_blank">Home</a>');
  });

  it('adds target attribute when not present', async () => {
    const content = '<a href="/">Home</a>';
    const result = await updateLinkAttribute(content, 'test.astro', { file: 'test.astro', line: 1, column: 1 }, 'target', '_blank');
    expect(result).toBe('<a target="_blank" href="/">Home</a>');
  });

  it('replaces existing aria-label attribute', async () => {
    const content = '<a href="/" aria-label="Go home">Home</a>';
    const result = await updateLinkAttribute(content, 'test.astro', { file: 'test.astro', line: 1, column: 1 }, 'aria-label', 'Navigate home');
    expect(result).toBe('<a href="/" aria-label="Navigate home">Home</a>');
  });

  it('adds aria-label attribute when not present', async () => {
    const content = '<a href="/">Home</a>';
    const result = await updateLinkAttribute(content, 'test.astro', { file: 'test.astro', line: 1, column: 1 }, 'aria-label', 'Navigate home');
    expect(result).toBe('<a aria-label="Navigate home" href="/">Home</a>');
  });

  it('handles JSX expression syntax', async () => {
    const content = '<a href={homeUrl}>Home</a>';
    const result = await updateLinkAttribute(content, 'test.tsx', { file: 'test.tsx', line: 1, column: 1 }, 'href', '/about');
    expect(result).toBe('<a href="/about">Home</a>');
  });

  it('handles multi-line tag', async () => {
    const content = `<div>
  <a
    href="/"
    class="nav-link"
  >Home</a>
</div>`;
    const result = await updateLinkAttribute(content, 'test.astro', { file: 'test.astro', line: 2, column: 3 }, 'href', '/about');
    expect(result).toContain('href="/about"');
    expect(result).not.toContain('href="/"');
  });
});
