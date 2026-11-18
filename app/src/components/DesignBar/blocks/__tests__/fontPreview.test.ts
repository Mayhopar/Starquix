import { describe, it, expect, beforeEach } from 'vitest';
import { previewFontUrl, ensurePreviewFont, _resetPreviewCacheForTests } from '../fontPreview';

describe('previewFontUrl', () => {
  it('subsets to the family name glyphs at default weight', () => {
    expect(previewFontUrl('Open Sans')).toBe(
      'https://fonts.googleapis.com/css2?family=Open+Sans&text=Open%20Sans&display=swap');
  });
});

describe('ensurePreviewFont', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    _resetPreviewCacheForTests();
  });
  it('injects one stylesheet link per family, deduped', () => {
    ensurePreviewFont('Lora');
    ensurePreviewFont('Lora');
    const links = document.head.querySelectorAll('link[rel="stylesheet"]');
    expect(links).toHaveLength(1);
    expect((links[0] as HTMLLinkElement).href).toContain('family=Lora');
  });
});
