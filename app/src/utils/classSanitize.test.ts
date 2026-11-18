import { describe, it, expect } from 'vitest';
import { containsBlobUrl, stripBlobUrlTokens } from './classSanitize';

describe('classSanitize (blob-poisoning guard)', () => {
  it('detects blob: URLs inside arbitrary-value classes', () => {
    expect(containsBlobUrl("p-4 bg-[url('blob:http://localhost/x-y')]")).toBe(true);
    expect(containsBlobUrl("p-4 bg-[url('sq-asset:aaa111')]")).toBe(false);
    expect(containsBlobUrl('')).toBe(false);
  });
  it('strips only the tokens carrying blob: URLs', () => {
    expect(stripBlobUrlTokens("p-4 bg-[url('blob:http://x/1')] mx-auto"))
      .toBe('p-4 mx-auto');
    expect(stripBlobUrlTokens("p-4 bg-[url('sq-asset:aaa111')]"))
      .toBe("p-4 bg-[url('sq-asset:aaa111')]");
  });
});
