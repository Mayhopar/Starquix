/**
 * Finding 27 (adversarial review): isMediaComponentPath matched Media by NAME
 * across every system-path shape, so a non-system file was misrouted to the
 * read-only MediaBlock (componentUnit nulled, normal chrome hidden): with a
 * project open, the user's own `src/components/Media.astro` — that string is
 * a template-path system Media shape (D6), but in a project the exact same
 * path names the USER's file. A project's system components live ONLY under
 * sq/.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveMediaUnit,
  isMediaComponentPath,
  isComponentUnitPath,
} from '../mediaUnit';

describe('isMediaComponentPath: runtime-scoped system shapes (finding 27)', () => {
  it('project open: src/components/Media.astro is the USER\'s file, not media', () => {
    expect(isMediaComponentPath('src/components/Media.astro', true)).toBe(false);
    expect(isMediaComponentPath('src/components/Media.astro:10:3', true)).toBe(false);
  });

  it('no project path: src/components/Media.astro stays the system Media (D6)', () => {
    expect(isMediaComponentPath('src/components/Media.astro', false)).toBe(true);
    expect(isMediaComponentPath('Media.astro', false)).toBe(true);
  });

  it('sq/Media.astro is the system Media in EVERY runtime', () => {
    expect(isMediaComponentPath('src/components/sq/Media.astro', true)).toBe(true);
    expect(isMediaComponentPath('src/components/sq/Media.astro', false)).toBe(true);
  });
});

describe('resolveMediaUnit: runtime-scoped (finding 27)', () => {
  it('local user Media.astro selection → null (falls through to normal component chrome)', () => {
    expect(resolveMediaUnit({ astroSource: 'src/components/Media.astro:10:3' }, true))
      .toBeNull();
  });

  it('no project path: template system Media selection is a read-only media unit', () => {
    expect(resolveMediaUnit({ astroSource: 'src/components/Media.astro:10:3' }, false))
      .toEqual({ write: null });
  });
});

describe('isComponentUnitPath: DesignBar unit-routing gate', () => {
  it('media system paths never route as a component unit', () => {
    expect(isComponentUnitPath('src/components/sq/Media.astro', false)).toBe(false);
    expect(isComponentUnitPath('src/components/sq/Media.astro', true)).toBe(false);
    expect(isComponentUnitPath('src/components/Media.astro', false)).toBe(false);
  });

  it('promoted components route as component units', () => {
    expect(isComponentUnitPath('src/components/sq/Credit.astro', false)).toBe(true);
    expect(isComponentUnitPath('src/components/sq/Credit.astro', true)).toBe(true);
  });

  it('project open: template shapes are the user\'s files — no unit routing at all', () => {
    expect(isComponentUnitPath('src/components/Media.astro', true)).toBe(false);
  });
});
