// app/src/ai/utils/__tests__/partialArgs.test.ts
import { describe, it, expect } from 'vitest';
import { extractPartialStringField, trimToTagBoundary } from '../partialArgs';

describe('extractPartialStringField', () => {
  it('extracts a complete field', () => {
    expect(extractPartialStringField('{"pageId":"p1","staticMarkup":"<div>hi</div>"}', 'staticMarkup'))
      .toEqual({ value: '<div>hi</div>', complete: true });
  });

  it('extracts an unterminated field as incomplete', () => {
    expect(extractPartialStringField('{"staticMarkup":"<section class=', 'staticMarkup'))
      .toEqual({ value: '<section class=', complete: false });
  });

  it('returns null when the field has not started', () => {
    expect(extractPartialStringField('{"pageId":"p1","stat', 'staticMarkup')).toBeNull();
    expect(extractPartialStringField('{"staticMarkup":', 'staticMarkup')).toBeNull();
  });

  it('unescapes JSON escapes', () => {
    expect(extractPartialStringField('{"t":"a\\"b\\nc"}', 't'))
      .toEqual({ value: 'a"b\nc', complete: true });
  });

  it('handles single-quoted HTML attrs (the prompt convention)', () => {
    expect(extractPartialStringField(`{"staticMarkup":"<div class='py-16'>x`, 'staticMarkup'))
      .toEqual({ value: "<div class='py-16'>x", complete: false });
  });

  it('trims an incomplete trailing escape instead of throwing', () => {
    expect(extractPartialStringField('{"t":"ab\\', 't')).toEqual({ value: 'ab', complete: false });
    expect(extractPartialStringField('{"t":"ab\\u00', 't')).toEqual({ value: 'ab', complete: false });
  });

  it('does not false-match a field name inside another string value', () => {
    // raw JSON escapes embedded quotes, so "staticMarkup" can't appear literally inside a value
    expect(extractPartialStringField('{"textContent":"say \\"staticMarkup\\" ok","staticMarkup":"<p>x</p>"}', 'staticMarkup'))
      .toEqual({ value: '<p>x</p>', complete: true });
  });
});

describe('trimToTagBoundary', () => {
  it('cuts mid-tag garbage', () => {
    expect(trimToTagBoundary("<div class='a'><p cla")).toBe("<div class='a'>");
  });
  it('keeps complete markup', () => {
    expect(trimToTagBoundary('<div>hi</div>')).toBe('<div>hi</div>');
  });
  it('returns empty string when no tag is complete', () => {
    expect(trimToTagBoundary('<div cla')).toBe('');
  });
});
