import { describe, it, expect } from 'vitest';
import { isDrawnKey, parseKey } from '../types';

describe('isDrawnKey', () => {
  it('matches drawn-element root keys', () => {
    expect(isDrawnKey('drawn-1234567890-abc12')).toBe(true);
    expect(isDrawnKey('drawn-1')).toBe(true);
  });

  it('matches inner-tag keys belonging to a drawn element', () => {
    // Callers commonly receive the inner-tag form; both share the prefix.
    expect(isDrawnKey('drawn-1234:section-0')).toBe(true);
  });

  it('rejects non-drawn keys', () => {
    expect(isDrawnKey('el-abc123')).toBe(false);
    expect(isDrawnKey('el-abc123:section-0')).toBe(false);
    expect(isDrawnKey('src/Hero.astro:5:1')).toBe(false);
    expect(isDrawnKey('dynamic:section:0@hash')).toBe(false);
  });

  it('handles null/undefined/empty', () => {
    expect(isDrawnKey(null)).toBe(false);
    expect(isDrawnKey(undefined)).toBe(false);
    expect(isDrawnKey('')).toBe(false);
  });
});

describe('parseKey × drawn elements', () => {
  it('returns instance-root for a bare drawn key', () => {
    const result = parseKey('drawn-1234');
    expect(result).toEqual({ type: 'instance-root', instanceId: 'drawn-1234' });
  });

  it('returns instance-child for a drawn inner-tag key', () => {
    // Load-bearing for the keyboard delete handler: an inner tag of a
    // drawn slot must parse as instance-child so CLEAR_DRAWN_SLOT_FILL
    // can be routed to the slot via the instanceId.
    const result = parseKey('drawn-1234-abc:section-0');
    expect(result).toEqual({
      type: 'instance-child',
      instanceId: 'drawn-1234-abc',
      selector: 'section-0',
    });
  });

  it('returns instance-root when a colon-prefixed selector does not match tag-N', () => {
    // Dynamic keys produced by the bridge for runtime-injected markup
    // (drawn slot fills) — selector "0@hash" is not "tag-N" shaped.
    const result = parseKey('dynamic:section:0@hash');
    expect(result).toEqual({ type: 'instance-root', instanceId: 'dynamic:section:0@hash' });
  });
});
