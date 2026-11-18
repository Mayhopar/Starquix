/**
 * Wave-2 regression: with no project path yet, the ↗ go-to-source for system
 * Media synthesizes a component at the `src/components`-relative path
 * (`Media.astro`), and the System locking chrome (System badge, no
 * rename/delete) gates on isSystemComponentPath / isOurSystemComponent. If
 * the classifier does not recognise the synthesized shape, the editor view
 * opened by the ↗ presents the system Media UNLOCKED.
 *
 * This test feeds the REAL synthesized output (not a hand-written literal)
 * into the classifier, so a drift in either side — the synthesis shape in
 * resolveGoToSourceComponent or the template path list in systemComponents —
 * fails here.
 */
import { describe, it, expect } from 'vitest';
import { resolveGoToSourceComponent } from '../LeftSidebar';
import { isSystemComponentPath, isOurSystemComponent } from '@/utils/systemComponents';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const comp = (
  over: Partial<ScannedComponent> & Pick<ScannedComponent, 'name' | 'path'>,
): ScannedComponent => ({
  source: 'built-in',
  html: '<div></div>',
  category: 'Test',
  props: [],
  slots: [],
  dependencies: [],
  ...over,
});

// Built-in catalog shape: `src/components`-relative, library-rooted — the
// system Media is NOT a row (the catalog covers only library/), so the ↗ must
// synthesize.
const builtInLibrary = [
  comp({ name: 'Hero', path: 'library/Hero.astro' }),
  comp({ name: 'Media', path: 'library/Media.astro' }), // legacy stub
];

describe('↗ system Media (no project path): synthesized component engages the System lock', () => {
  const synthesized = resolveGoToSourceComponent(
    { path: 'src/components/sq/Media.astro', name: undefined },
    builtInLibrary,
    { isLocal: false },
  );

  it('sanity: the ↗ synthesizes (library has no system row)', () => {
    expect(synthesized).not.toBeNull();
    expect(synthesized!.path).toBe('Media.astro');
  });

  it('the synthesized path classifies as a system component path', () => {
    expect(isSystemComponentPath(synthesized!.path)).toBe(true);
  });

  it('the synthesized path classifies as OURS (badge, no rename/delete)', () => {
    expect(isOurSystemComponent(synthesized!.path)).toBe(true);
  });
});
