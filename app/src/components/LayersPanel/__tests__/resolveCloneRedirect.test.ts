/**
 * Regression — clicking a blog-card clone in the layers panel must
 * redirect to the real first card so the Design Bar's instance icons
 * ("Go to source", "Updates available", kebab menu) appear.
 *
 * Before fix: the clone's `dynamic:` key resolves to no Yjs element,
 * `instanceId` becomes null, `astroSource` becomes null, the icons gate
 * `(isInstanceRoot || isBlogSlot || isPostRoot) && astroSource` fails.
 * Only the first card surfaced icons; clones felt broken.
 */
import { describe, it, expect } from 'vitest';
import { resolveCloneRedirect } from '../resolveCloneRedirect';

describe('resolveCloneRedirect', () => {
  it('returns the first real card key when clicking a clone', () => {
    const out = resolveCloneRedirect({
      clickedKey: 'dynamic:article:1@abc',
      scannedElements: [
        { key: 'el-card', parentKey: 'el-slot:posts', postSlug: 'post-1' },
        { key: 'dynamic:article:1@abc', parentKey: 'el-slot:posts', postSlug: 'post-2' },
        { key: 'dynamic:article:2@abc', parentKey: 'el-slot:posts', postSlug: 'post-3' },
      ],
    });
    expect(out).toBe('el-card');
  });

  it('returns null when the clicked key is already a real card', () => {
    const out = resolveCloneRedirect({
      clickedKey: 'el-card',
      scannedElements: [
        { key: 'el-card', parentKey: 'el-slot:posts', postSlug: 'post-1' },
        { key: 'dynamic:article:1@abc', parentKey: 'el-slot:posts', postSlug: 'post-2' },
      ],
    });
    expect(out).toBeNull();
  });

  it('returns null when the clicked dynamic element has no postSlug (not a clone, just an unkeyed thing)', () => {
    const out = resolveCloneRedirect({
      clickedKey: 'dynamic:div:0@xyz',
      scannedElements: [
        { key: 'el-other', parentKey: null, postSlug: undefined },
        { key: 'dynamic:div:0@xyz', parentKey: 'el-other', postSlug: undefined },
      ],
    });
    expect(out).toBeNull();
  });

  it('returns null when no sibling is a real card', () => {
    // All siblings are dynamic — shouldn't happen in practice, but the
    // helper falls through safely.
    const out = resolveCloneRedirect({
      clickedKey: 'dynamic:article:1@abc',
      scannedElements: [
        { key: 'dynamic:article:0@abc', parentKey: 'el-slot:posts', postSlug: 'post-1' },
        { key: 'dynamic:article:1@abc', parentKey: 'el-slot:posts', postSlug: 'post-2' },
      ],
    });
    expect(out).toBeNull();
  });

  it('only matches siblings with the same parentKey', () => {
    // A real card in a different parent must NOT be selected.
    const out = resolveCloneRedirect({
      clickedKey: 'dynamic:article:1@abc',
      scannedElements: [
        { key: 'el-card-other', parentKey: 'el-other-slot:posts', postSlug: 'post-x' },
        { key: 'dynamic:article:1@abc', parentKey: 'el-slot:posts', postSlug: 'post-2' },
      ],
    });
    expect(out).toBeNull();
  });
});
