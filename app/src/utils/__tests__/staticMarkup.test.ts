/**
 * Unit tests for the pure staticMarkup helpers extracted from
 * ClassStoreContext (godfile decomposition Phase C1). These pin CURRENT
 * behavior — regex-based on purpose for non-DOM string markup (the DOMParser
 * sibling is utils/markupQuery.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  addDataKeyToMarkup,
  getOriginalTextFromMarkup,
  getOriginalAttributeFromMarkup,
  getOriginalAttributeOrWarn,
  getSelectorsWithDescendants,
  VOID_ELEMENTS,
} from '../staticMarkup';

const MARKUP = `<section class="hero">
  <h1 class="title">Hello <em>world</em></h1>
  <p>Body text</p>
  <img src="/a.png" alt="A picture" />
</section>`;

const KEYED_MARKUP = `<section data-key="el-1:section-0">
  <p data-key="el-1:p-0">Keyed title</p>
</section>`;

describe('addDataKeyToMarkup', () => {
  it('adds simple tag-index data-keys to key-less markup', () => {
    const out = addDataKeyToMarkup('<div><p>x</p><p>y</p></div>');
    expect(out).toContain('data-key="div-0"');
    expect(out).toContain('data-key="p-0"');
    expect(out).toContain('data-key="p-1"');
  });
});

describe('getOriginalTextFromMarkup', () => {
  it('finds text by selector in key-less markup (keys added on the fly)', () => {
    expect(getOriginalTextFromMarkup(MARKUP, 'p-0')).toBe('Body text');
  });

  it('strips nested tags to plain text', () => {
    expect(getOriginalTextFromMarkup('<div><p>Hello <em>world</em></p></div>', 'p-0')).toBe('Hello world');
  });

  it('matches the instanceId:selector data-key format', () => {
    expect(getOriginalTextFromMarkup(KEYED_MARKUP, 'p-0')).toBe('Keyed title');
  });

  it('returns empty string for digit-bearing tags like h1 (characterization — the selector regex `^([a-z]+)-\\d+$` never matches them; known quirk, do not "fix" here)', () => {
    expect(getOriginalTextFromMarkup(MARKUP, 'h1-0')).toBe('');
  });

  it('returns empty string for an unknown or malformed selector', () => {
    expect(getOriginalTextFromMarkup(MARKUP, 'h2-0')).toBe('');
    expect(getOriginalTextFromMarkup(MARKUP, 'not a selector')).toBe('');
  });
});

describe('getOriginalAttributeFromMarkup', () => {
  it('reads an attribute from the element at the selector', () => {
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-0', 'alt')).toBe('A picture');
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-0', 'src')).toBe('/a.png');
  });

  it('returns null when the element or attribute is missing', () => {
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-9', 'src')).toBeNull();
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-0', 'missing')).toBeNull();
  });
});

describe('getOriginalAttributeOrWarn', () => {
  it('warns (observably) when restore has no element at the selector', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getOriginalAttributeOrWarn(MARKUP, 'img-9', 'src', 'el-1:img-9')).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn on success', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getOriginalAttributeOrWarn(MARKUP, 'img-0', 'src', 'el-1:img-0')).toBe('/a.png');
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('getSelectorsWithDescendants', () => {
  it('returns the target and all its descendants', () => {
    expect(getSelectorsWithDescendants(MARKUP, 'section-0')).toEqual(
      expect.arrayContaining(['section-0', 'h1-0', 'em-0', 'p-0', 'img-0']),
    );
  });

  it('returns only the leaf for a leaf selector', () => {
    expect(getSelectorsWithDescendants(MARKUP, 'p-0')).toEqual(['p-0']);
  });

  it('null target returns every selector', () => {
    const all = getSelectorsWithDescendants(MARKUP, null);
    expect(all).toEqual(expect.arrayContaining(['section-0', 'h1-0', 'em-0', 'p-0', 'img-0']));
  });

  it('unknown target falls back to [target]', () => {
    expect(getSelectorsWithDescendants(MARKUP, 'div-9')).toEqual(['div-9']);
  });

  it('treats void elements as childless (img range is its open tag)', () => {
    expect(VOID_ELEMENTS.has('img')).toBe(true);
    expect(getSelectorsWithDescendants(MARKUP, 'img-0')).toEqual(['img-0']);
  });
});
