import { describe, it, expect } from 'vitest';
import { validateFontFile, buildCustomFontFaceCss, familyFromFileName } from './fontValidation';

const file = (name: string, size = 1000, type = '') =>
  ({ name, size, type } as File);

describe('validateFontFile', () => {
  it('accepts woff2/woff/ttf/otf by extension (font MIME is often empty)', () => {
    expect(validateFontFile(file('Inter.woff2'))).toBeNull();
    expect(validateFontFile(file('Font.TTF'))).toBeNull();
  });
  it('rejects wrong extension and oversize', () => {
    expect(validateFontFile(file('x.png'))).toMatch(/woff2/i);
    expect(validateFontFile(file('x.woff2', 6 * 1024 * 1024))).toMatch(/5MB/);
  });
});

describe('familyFromFileName', () => {
  it('strips extension, normalizes separators', () => {
    expect(familyFromFileName('My-Brand_Font.woff2')).toBe('My Brand Font');
  });
});

describe('buildCustomFontFaceCss', () => {
  it('static weight', () => {
    const css = buildCustomFontFaceCss('Brand', 'a1', 700, false, 'woff2');
    expect(css).toContain('font-weight:700');
    expect(css).toContain("src:url('sq-asset:a1') format('woff2')");
  });
  it('variable font → weight range 100 900; unknown format omitted', () => {
    const css = buildCustomFontFaceCss('Brand', 'a1', 400, true, '');
    expect(css).toContain('font-weight:100 900');
    expect(css).not.toContain('format(');
  });
});
