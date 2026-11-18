/**
 * Gap 35 regression: Media selection's ↗ "Go to source".
 *
 * The system-master ↗ dispatches `sq:go-to-source-component` with a PATH-only
 * payload (`src/components/sq/Media.astro`, name undefined — wave 1 removed
 * the name to stop the name-first match from opening the unrelated legacy
 * `library/Media.astro` stub). The built-in catalog lists `library/...`-rooted
 * paths and never contains `src/components/sq/...`, so an exact-path-only
 * match silently no-opped.
 *
 * resolveGoToSourceComponent must:
 *  - project open: exact-match the user's own `src/components/sq/Media.astro` row
 *  - no project path: synthesize the template component (`Media.astro` →
 *    resolveComponentSourcePath → `src/components/Media.astro`) — and never
 *    fall back to the legacy `library/Media.astro` stub
 *  - keep the blog-slot name override (name wins over the deliberately
 *    "wrong" BlogCard path)
 */
import { describe, it, expect } from 'vitest';
import { resolveGoToSourceComponent } from '../LeftSidebar';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const comp = (over: Partial<ScannedComponent> & Pick<ScannedComponent, 'name' | 'path'>): ScannedComponent => ({
  source: 'built-in',
  html: '<div></div>',
  category: 'Test',
  props: [],
  slots: [],
  dependencies: [],
  ...over,
});

// Built-in catalog: `src/components`-relative paths; includes the legacy
// 8-line Media stub that used to hijack the ↗ via the name-first match.
const libraryStub = comp({ name: 'Media', path: 'library/Media.astro' });
const builtInLibrary = [comp({ name: 'Hero', path: 'library/Hero.astro' }), libraryStub];

describe('resolveGoToSourceComponent', () => {
  it('no project path: system Media path resolves to the template component, not the legacy stub and not a no-op', () => {
    const result = resolveGoToSourceComponent(
      { path: 'src/components/sq/Media.astro', name: undefined },
      builtInLibrary,
      { isLocal: false },
    );
    expect(result).not.toBeNull();
    expect(result).not.toBe(libraryStub);
    // Synthesized at the template path: `Media.astro` is `src/components`-
    // relative, so resolveComponentEditorOpen's resolveComponentSourcePath read hits
    // src/components/Media.astro.
    expect(result!.path).toBe('Media.astro');
    expect(result!.name).toBe('Media');
  });

  it('local: exact path match on the user\'s own sq/ component', () => {
    const localMedia = comp({
      name: 'Media',
      path: 'src/components/sq/Media.astro',
      source: 'user-project',
    });
    const result = resolveGoToSourceComponent(
      { path: 'src/components/sq/Media.astro' },
      [comp({ name: 'Card', path: 'src/components/Card.astro', source: 'user-project' }), localMedia],
      { isLocal: true },
    );
    expect(result).toBe(localMedia);
  });

  it('local: a src/components file resolves to the user\'s own file even before the scan lists it (↗ on a fresh instance)', () => {
    const result = resolveGoToSourceComponent(
      { path: 'src/components/Feature.astro' },
      [comp({ name: 'Hero', path: 'library/Hero.astro', source: 'built-in' })],
      { isLocal: true },
    );
    expect(result).toMatchObject({ name: 'Feature', path: 'src/components/Feature.astro', source: 'user-project' });
  });

  it('project open: never synthesizes a template component (files are truth — nothing to open)', () => {
    const result = resolveGoToSourceComponent(
      { path: 'src/components/sq/Media.astro' },
      [comp({ name: 'Card', path: 'src/components/Card.astro', source: 'user-project' })],
      { isLocal: true },
    );
    expect(result).toBeNull();
  });

  it('blog slot: name override still wins over the deliberately-wrong path', () => {
    const blogCard = comp({ name: 'BlogCard', path: 'library/BlogCard.astro' });
    const blogSlot = comp({ name: 'BlogSlot', path: 'library/BlogSlot.astro' });
    const result = resolveGoToSourceComponent(
      { path: 'library/BlogCard.astro', name: 'BlogSlot' },
      [...builtInLibrary, blogCard, blogSlot],
      { isLocal: false },
    );
    expect(result).toBe(blogSlot);
  });

  it('suffix match: full src/components/… dispatch finds the catalog\'s relative row', () => {
    const card = comp({ name: 'Card', path: 'library/Card.astro' });
    const result = resolveGoToSourceComponent(
      { path: 'src/components/library/Card.astro' },
      [...builtInLibrary, card],
      { isLocal: false },
    );
    expect(result).toBe(card);
  });

  it('no project path: OURS template path (src/components/Media.astro) also resolves, never to the stub', () => {
    const result = resolveGoToSourceComponent(
      { path: 'src/components/Media.astro' },
      builtInLibrary,
      { isLocal: false },
    );
    expect(result).not.toBeNull();
    expect(result).not.toBe(libraryStub);
    expect(result!.path).toBe('Media.astro');
  });

  it('no match and non-system path: null (no accidental stub fallback)', () => {
    const result = resolveGoToSourceComponent(
      { path: 'src/components/DoesNotExist.astro' },
      builtInLibrary,
      { isLocal: false },
    );
    expect(result).toBeNull();
  });
});
