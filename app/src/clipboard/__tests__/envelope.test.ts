// @vitest-environment node
// (jsdom's TextEncoder returns a foreign-realm Uint8Array that fails toEqual identity checks)
import { describe, it, expect } from 'vitest';
import {
  CLIPBOARD_VERSION, encodeEnvelopeHtml, decodeEnvelopeHtml,
  bytesToBase64, base64ToBytes,
  type ClipboardEnvelope,
} from '../envelope';

const env: ClipboardEnvelope = {
  v: CLIPBOARD_VERSION,
  sourceProjectId: 'browser_abc',
  roots: [{ label: 'Hero', html: '<section class="p-4">Héllo — ünïcode</section>' }],
  masters: [{ astroSource: 'library/Hero.astro', markup: '<div>m</div>', componentType: 'Hero' }],
  assets: [{ assetId: 'a1', mime: 'image/png', name: 'x.png', base64: 'AAAA' }],
};

describe('clipboard envelope', () => {
  it('round-trips through the html sentinel', () => {
    const html = encodeEnvelopeHtml(env);
    expect(html).toContain('data-sq-clipboard="');
    expect(decodeEnvelopeHtml(html)).toEqual(env);
  });

  it('returns null for html without the sentinel', () => {
    expect(decodeEnvelopeHtml('<p>random</p>')).toBeNull();
  });

  it('returns null for a future version', () => {
    const html = encodeEnvelopeHtml({ ...env, v: CLIPBOARD_VERSION + 1 });
    expect(decodeEnvelopeHtml(html)).toBeNull();
  });

  it('returns null for corrupt base64 payloads', () => {
    expect(decodeEnvelopeHtml('<span data-sq-clipboard="!!!not-base64!!!">x</span>')).toBeNull();
  });

  it('bytes round-trip through base64 (unicode-safe)', () => {
    const bytes = new TextEncoder().encode('héllo 🌍');
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});
