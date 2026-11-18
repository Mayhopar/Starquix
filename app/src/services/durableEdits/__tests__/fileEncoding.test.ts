/** Durable binary file states are canonical base64 (perf: native path when available). */
import { describe, it, expect, afterEach } from 'vitest';
import { encodeFileBytes, decodeFileBytes } from '../fileEncoding';

const sample = new Uint8Array(70_000).map((_, i) => (i * 2654435761) >>> 24);
const nativeFrom = (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64;
afterEach(() => { (Uint8Array as unknown as { fromBase64?: unknown }).fromBase64 = nativeFrom; });

describe.each([['fallback', false], ['native', true]])('fileEncoding (%s)', (_name, native) => {
  if (native && typeof nativeFrom !== 'function') {
    // Node 22 lacks the API: emulate it so the native branch is exercised with real semantics.
    (Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }).fromBase64 = s => Uint8Array.from(Buffer.from(s, 'base64'));
  }
  it('round-trips bytes exactly', () => {
    const s = encodeFileBytes(sample);
    expect(s).toBe(Buffer.from(sample).toString('base64'));
    expect(decodeFileBytes(s)).toEqual(sample);
  });
  it.each([['whitespace', 'QUJD\nRA=='], ['missing padding', 'QUJDRA'], ['non-zero trailing bits', 'QUJDRB=='], ['invalid char', 'QUJD*A==']])('rejects %s', (_c, s) => {
    expect(() => decodeFileBytes(s)).toThrow();
  });
});
