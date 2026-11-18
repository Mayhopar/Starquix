/**
 * Pure-function pins for the image-attr restore path (task-049, II-3 — the
 * F7 mitigation: unit-test the extracted decision instead of e2e).
 *
 * getOriginalAttributeFromMarkup resolves "what was the original attribute"
 * from raw staticMarkup; getOriginalAttributeOrWarn is the restore-path
 * wrapper that makes the previously-silent failure observable.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getOriginalAttributeFromMarkup,
  getOriginalAttributeOrWarn,
} from '../ClassStoreContext';

const MARKUP =
  '<section><img src="/a.png" alt="first"><div><img src="/b.png"></div></section>';

describe('getOriginalAttributeFromMarkup (II-3)', () => {
  it('returns the original attribute for the img at the selector index', () => {
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-0', 'src')).toBe('/a.png');
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-1', 'src')).toBe('/b.png');
  });

  it('returns null when no img exists at the index (img-3 in a 2-img markup)', () => {
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-3', 'src')).toBeNull();
  });

  it('returns null when the attribute is absent on the matched img', () => {
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img-1', 'alt')).toBeNull();
  });

  it('resolves non-img tags too (selector grammar is tag-N, not img-specific)', () => {
    expect(getOriginalAttributeFromMarkup('<div data-x="1"><span>s</span></div>', 'div-0', 'data-x')).toBe('1');
    expect(getOriginalAttributeFromMarkup(MARKUP, 'section-0', 'src')).toBeNull();
  });

  it('returns null for malformed selectors', () => {
    expect(getOriginalAttributeFromMarkup(MARKUP, 'not a selector', 'src')).toBeNull();
    expect(getOriginalAttributeFromMarkup(MARKUP, 'img', 'src')).toBeNull();
  });
});

describe('getOriginalAttributeOrWarn (restore path is observable on failure)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    warn.mockClear();
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('passes the value through without warning when resolvable', () => {
    expect(getOriginalAttributeOrWarn(MARKUP, 'img-0', 'src', 'el-x:img-0')).toBe('/a.png');
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (instead of silently no-opping) when no element exists at the selector', () => {
    expect(getOriginalAttributeOrWarn(MARKUP, 'img-3', 'src', 'el-x:img-3')).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('cannot restore original src'),
      'img-3',
      'for',
      'el-x:img-3',
    );
  });

  it('warns when the attribute is absent on the matched element', () => {
    expect(getOriginalAttributeOrWarn(MARKUP, 'img-1', 'alt', 'el-x:img-1')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
