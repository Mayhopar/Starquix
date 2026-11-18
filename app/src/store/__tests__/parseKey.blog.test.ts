/**
 * task-028 — parseKey must not special-case blog compound keys. Any
 * `el-abc:posts` / `el-abc:pagination` / `el-abc:blogcard` key (legacy
 * data only — the new model uses ordinary instance-child selectors like
 * `el-abc:div-0`) parses as standard instance-root / instance-child,
 * never tagged with blog-specific fields like `isBlogSlot` or `slotType`.
 */
import { describe, it, expect } from 'vitest';
import { parseKey } from '../types';

describe('parseKey treats blog wrapper keys as ordinary keys (task-028)', () => {
  it('parses an arbitrary instance-child key (tag-N) as instance-child', () => {
    expect(parseKey('el-abc:div-0')).toEqual({
      type: 'instance-child',
      instanceId: 'el-abc',
      selector: 'div-0',
    });
  });

  it('returns instance-root for "el-abc:posts" — :posts is not a tag-N selector', () => {
    // The selector segment "posts" does not match the tag-N regex (no digit
    // suffix), so parseKey falls through to instance-root with the whole
    // string as instanceId. No blog-specific tagging.
    const r = parseKey('el-abc:posts');
    expect(r?.type).toBe('instance-root');
    expect((r as Record<string, unknown>).slotType).toBeUndefined();
    expect((r as Record<string, unknown>).isBlogSlot).toBeUndefined();
    expect((r as Record<string, unknown>).isPagination).toBeUndefined();
  });

  it('same for ":pagination" / ":blogcard"', () => {
    for (const k of ['el-x:pagination', 'el-x:blogcard']) {
      const r = parseKey(k);
      expect(r?.type).toBe('instance-root');
      expect((r as Record<string, unknown>).slotType).toBeUndefined();
      expect((r as Record<string, unknown>).isBlogSlot).toBeUndefined();
    }
  });

  it('an instance root id stays instance-root', () => {
    expect(parseKey('el-xyz')).toEqual({ type: 'instance-root', instanceId: 'el-xyz' });
  });
});
