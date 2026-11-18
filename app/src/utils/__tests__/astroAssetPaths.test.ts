import { describe, it, expect } from 'vitest';
import { resolveRelImport, componentNameFromAstroSource, masterSaveRequest } from '../astroAssetPaths';

describe('resolveRelImport', () => {
  it('returns a sibling-relative import when source and target share a directory', () => {
    // BlogPost lives at library/BlogPost.astro and adds CTA from library/CTA.astro.
    // The buggy old path was `./library/CTA.astro`, which Astro resolves from
    // BlogPost's directory as `library/library/CTA.astro` — a missing file.
    expect(resolveRelImport('library/BlogPost.astro', 'library/CTA.astro')).toBe('./CTA.astro');
  });

  it('routes layouts up to ../components for library targets', () => {
    expect(resolveRelImport('layouts/Layout.astro', 'library/Hero.astro')).toBe('../components/library/Hero.astro');
  });

  it('falls back to a top-level relative path when target is in a different folder', () => {
    expect(resolveRelImport('library/BlogPost.astro', 'sections/Hero.astro')).toBe('./sections/Hero.astro');
  });

  it('handles a top-level source file (no directory prefix)', () => {
    expect(resolveRelImport('Foo.astro', 'library/CTA.astro')).toBe('./library/CTA.astro');
  });
});

describe('componentNameFromAstroSource', () => {
  it('returns the lowercased basename without extension', () => {
    expect(componentNameFromAstroSource('library/CTA.astro')).toBe('cta');
    expect(componentNameFromAstroSource('library/BlogPost.astro')).toBe('blogpost');
  });

  it('handles paths without an extension', () => {
    expect(componentNameFromAstroSource('library/Header')).toBe('header');
  });

  it('handles top-level files', () => {
    expect(componentNameFromAstroSource('CTA.astro')).toBe('cta');
  });

  it('returns null for empty input', () => {
    expect(componentNameFromAstroSource('')).toBeNull();
  });
});

describe('masterSaveRequest', () => {
  // Regression (2026-08-27): an edited LAYOUT was posted to /__sq/save-component
  // by basename, landing in src/components/library/ as a phantom component —
  // it appeared in the Assets components tree and the real layout kept none of
  // the edit, so nothing the user put in a layout master reached any page.
  it('routes a layout to save-layout with no category', () => {
    const req = masterSaveRequest('layouts/Layout1.astro', '<html></html>');
    expect(req).toEqual({
      url: '/__sq/save-layout',
      body: { name: 'Layout1', astroContent: '<html></html>' },
    });
  });

  it('routes a library component to save-component', () => {
    const req = masterSaveRequest('library/CTA.astro', '<div />');
    expect(req?.url).toBe('/__sq/save-component');
    expect(req?.body).toMatchObject({ name: 'CTA', targetDir: 'built-in' });
    expect(req?.body.category).toBeUndefined();
  });

  it('keeps a library subdirectory as the category so it is not flattened', () => {
    const req = masterSaveRequest('library/navigation/GlobalNav.astro', '<nav />');
    expect(req?.url).toBe('/__sq/save-component');
    expect(req?.body).toMatchObject({ name: 'GlobalNav', category: 'navigation' });
  });

  it('returns null when the source is not an .astro file', () => {
    expect(masterSaveRequest('library/CTA.tsx', 'x')).toBeNull();
  });
});
