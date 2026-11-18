import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCss2Url, parseGoogleFontCss, buildFontFaceCss } from '../googleFonts';

const fixture = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'css2-inter.css'), 'utf8');

describe('buildCss2Url', () => {
  it('encodes family spaces as + and sorts weights', () => {
    expect(buildCss2Url('Open Sans', [700, 400])).toBe(
      'https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap');
  });
});

describe('parseGoogleFontCss', () => {
  it('keeps only latin/latin-ext blocks with url, weight, unicode-range', () => {
    const blocks = parseGoogleFontCss(fixture);
    expect(blocks).toHaveLength(2);
    expect(blocks.map(b => b.subset)).toEqual(['latin-ext', 'latin']);
    expect(blocks[0]).toMatchObject({ fontWeight: '400' });
  });
  it('parses weight/style/url per block', () => {
    const blocks = parseGoogleFontCss(fixture);
    expect(blocks[0].url).toBe('https://fonts.gstatic.com/s/inter/v19/latin-ext.woff2');
    expect(blocks[1].fontWeight).toBe('700');
    expect(blocks[0].fontStyle).toBe('normal');
    expect(blocks[0].unicodeRange).toContain('U+0100');
  });
  it('returns [] on garbage input', () => {
    expect(parseGoogleFontCss('not css')).toEqual([]);
  });
});

describe('buildFontFaceCss', () => {
  it('emits @font-face with sq-asset src and unicode-range', () => {
    const css = buildFontFaceCss('Inter', [{
      fontFamily: 'Inter', fontStyle: 'normal', fontWeight: '400',
      unicodeRange: 'U+0000-00FF', url: 'x', subset: 'latin', assetId: 'aaaa-bbbb',
    }]);
    expect(css).toContain("font-family:'Inter'");
    expect(css).toContain("src:url('sq-asset:aaaa-bbbb') format('woff2')");
    expect(css).toContain('unicode-range:U+0000-00FF');
    expect(css).toContain('font-display:swap');
  });
});
