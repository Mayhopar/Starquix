/**
 * task-207 D5: "ours vs theirs" is the existing allowlist plus the sq/ path —
 * no new marker, no new folder, no migration. Ours are locked; a component the
 * user promoted into sq/ is a normal component that merely also appears in `/`.
 */
import { describe, it, expect } from 'vitest';
import {
  isSystemComponentPath, isOurSystemComponent, systemComponentPath, SQ_OURS,
} from '../systemComponents';

describe('isSystemComponentPath — lives under sq/', () => {
  it('is true for anything in the folder, ours or promoted', () => {
    expect(isSystemComponentPath('src/components/sq/Media.astro')).toBe(true);
    expect(isSystemComponentPath('src/components/sq/Credit.astro')).toBe(true);
  });

  it('also matches the template-path Media', () => {
    expect(isSystemComponentPath('src/components/Media.astro')).toBe(true);
  });

  /** The no-project-path ↗ go-to-source synthesizes the system Media at the
   *  `src/components`-relative shape (`Media.astro` — see
   *  resolveGoToSourceComponent). The locking chrome reads this classifier,
   *  so the relative shape must classify too or the editor view opened by
   *  the ↗ presents the system Media unlocked. */
  it('matches the ↗-synthesized relative shape (Media.astro)', () => {
    expect(isSystemComponentPath('Media.astro')).toBe(true);
  });

  it('the relative shape is Media-only — other bare names never classify', () => {
    expect(isSystemComponentPath('Credit.astro')).toBe(false);
    expect(isSystemComponentPath('Hero.astro')).toBe(false);
  });

  it('is false outside it, and for empty input', () => {
    expect(isSystemComponentPath('src/components/Credit.astro')).toBe(false);
    expect(isSystemComponentPath('library/Credit.astro')).toBe(false);
    expect(isSystemComponentPath(undefined)).toBe(false);
    expect(isSystemComponentPath(null)).toBe(false);
    expect(isSystemComponentPath('')).toBe(false);
  });
});

describe('isOurSystemComponent — under sq/ AND allowlisted', () => {
  it('ours: locked (System badge, no rename/delete)', () => {
    expect(isOurSystemComponent(systemComponentPath('Media'))).toBe(true);
  });

  it('a PROMOTED component is NOT ours — it is the user’s file (D5c)', () => {
    expect(isOurSystemComponent('src/components/sq/Credit.astro')).toBe(false);
  });

  /** The preview-template's system Media lives at the template path
   *  (task-206, 844aa6d7). Ours must be recognised there too. */
  it('recognises the template-path Media as ours', () => {
    expect(isOurSystemComponent('src/components/Media.astro')).toBe(true);
  });

  /** Same file, synthesized shape: the ↗-opened editor view must engage the
   *  OURS lock (System badge, no rename/delete), not just the folder class. */
  it('recognises the ↗-synthesized relative Media as ours', () => {
    expect(isOurSystemComponent('Media.astro')).toBe(true);
  });

  it('a NAME that is not ours is never ours, wherever it lives', () => {
    expect(isOurSystemComponent('src/components/Credit.astro')).toBe(false);
  });

  it('degrades on empty input rather than throwing', () => {
    expect(isOurSystemComponent(undefined)).toBe(false);
    expect(isOurSystemComponent(null)).toBe(false);
  });

  it('every allowlisted name resolves as ours at its canonical path', () => {
    for (const name of SQ_OURS) {
      expect(isOurSystemComponent(systemComponentPath(name)), name).toBe(true);
    }
  });
});
