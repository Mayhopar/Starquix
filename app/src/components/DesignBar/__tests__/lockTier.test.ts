// Imported-adoption phase 0 (design ledger L1–L3): deriveLockTier is the pure
// per-element editability derivation behind the SelectionOverlay badge. Like
// deriveSelectionDescriptor, every decision is unit-testable here without the
// iframe pipeline; this suite is the behavior contract. Fail closed: any
// unknown input is `locked` (a wrong ✏️ is worse than a wrong 🔒).
import { describe, it, expect } from 'vitest';
import { deriveLockTier, lockLabel, lockedKeyPredicate } from '../lockTier';
import type { ScannedElement } from '@/context/SelectionContext';

const el = (over: Partial<ScannedElement> = {}): ScannedElement =>
  ({
    key: 'src/pages/index.astro:10:1',
    sourceKey: 'src/pages/index.astro:10:1',
    tagName: 'div',
    classes: '',
    rect: { top: 0, left: 0, width: 10, height: 10 },
    parentKey: null,
    hasSourceTracking: true,
    sourceLocation: { file: 'src/pages/index.astro', line: 10, column: 1 },
    usageLocation: undefined,
    ...over,
  }) as ScannedElement;

describe('deriveLockTier', () => {
  it('null element → locked/not-scanned', () => {
    expect(
      deriveLockTier({ element: null, isLocalMode: true })
    ).toEqual({ tier: 'locked', reason: 'not-scanned' });
  });

  it('untracked element → locked/not-tracked', () => {
    expect(
      deriveLockTier({
        element: el({ hasSourceTracking: false, sourceLocation: undefined }),
        isLocalMode: true,
      })
    ).toEqual({ tier: 'locked', reason: 'not-tracked' });
  });

  it('WC mode, tracked → full (doc overlays persist there)', () => {
    expect(deriveLockTier({ element: el(), isLocalMode: false }).tier).toBe(
      'full'
    );
  });

  it('WC mode, untracked/unscanned → still full (drawn elements are doc-native; a badge would lie)', () => {
    expect(
      deriveLockTier({
        element: el({ hasSourceTracking: false, sourceLocation: undefined }),
        isLocalMode: false,
      }).tier
    ).toBe('full');
    expect(deriveLockTier({ element: null, isLocalMode: false }).tier).toBe(
      'full'
    );
  });

  it('local, same-file → full', () => {
    expect(
      deriveLockTier({ element: el(), isLocalMode: true })
        .tier
    ).toBe('full');
  });

  it('local, cross-file → full: a page-view edit of a component element is an instance edit', () => {
    const inner = el({
      key: 'src/components/TextWrapper.astro:21:3',
      parentKey: 'src/components/TextWrapper.astro:6:1',
      sourceLocation: { file: 'src/components/TextWrapper.astro', line: 21, column: 3 },
    });
    expect(deriveLockTier({ element: inner, isLocalMode: true }))
      .toEqual({ tier: 'full' });
  });

  it('local, unknown surface file → still full (the surface never decides editability)', () => {
    expect(deriveLockTier({ element: el(), isLocalMode: true }).tier).toBe('full');
  });
});

describe('lockLabel', () => {
  it('full → no badge', () => { expect(lockLabel({ tier: 'full' })).toBeNull(); });
  it('not-scanned → Scanning…', () => { expect(lockLabel({ tier: 'locked', reason: 'not-scanned' })).toBe('Scanning…'); });
  it('not-tracked → open in code', () => { expect(lockLabel({ tier: 'locked', reason: 'not-tracked' })).toBe('Not editable — open in code'); });
});

describe('lockedKeyPredicate (multi-select membership, ledger A14)', () => {
  const tracked = { key: 'k1', tagName: 'p', classes: '', rect: { top: 0, left: 0, width: 1, height: 1 }, parentKey: null,
    hasSourceTracking: true, sourceLocation: { file: 'src/pages/index.astro', line: 1, column: 1 } } as ScannedElement;
  const untracked = { ...tracked, key: 'k2', hasSourceTracking: false, sourceLocation: undefined } as ScannedElement;
  const byKey = new Map([[tracked.key, tracked], [untracked.key, untracked]]);

  it('local mode: tracked → free, untracked or unscanned → locked', () => {
    const locked = lockedKeyPredicate(byKey, true);
    expect(locked('k1')).toBe(false);
    expect(locked('k2')).toBe(true);
    expect(locked('missing')).toBe(true);
  });
  it('outside local mode nothing is locked', () => {
    expect(lockedKeyPredicate(byKey, false)('k2')).toBe(false);
  });
});
