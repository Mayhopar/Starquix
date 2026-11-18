/**
 * Regression test for the BlogPost system page template (see
 * docs/archive/plans/2026-05-11-pages-in-assets-design.md).
 *
 * The design claim: editing `Header.astro` propagates into every route that
 * renders BlogPost (because BlogPost uses `<Header />`). This is "free" —
 * it comes from the existing source/instance propagation system, not from
 * any new BlogPost-specific wiring. Every rendered Header element — whether
 * placed directly on a route or transitively via BlogPost — carries the same
 * `data-sq-source="Header.astro:<line>:<col>"`, so its effective classes
 * resolve to a single `sourceClasses[sourceKey]` entry.
 *
 * This test locks in the claim: it would only break if someone re-architected
 * `sourceClasses` to be per-route or per-parent. If that happens, this test
 * fails immediately and forces a design conversation.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';

describe('BlogPost system page template — instance propagation', () => {
  it('a class change on Header.astro reaches every <Header /> instance (direct and via BlogPost)', () => {
    const doc = new Y.Doc();
    const headerSourceKey = 'src/components/library/Header.astro:5:1';

    // Register the Header source as the iframe would on first render.
    // In real flow, two routes render — one that places <Header /> directly,
    // one that places <BlogPost /> (which transitively renders Header). Both
    // emit REGISTER_SOURCE_ELEMENT with the *same* sourceKey because the
    // sourceKey is `<file>:<line>:<col>` of the Header source, not of the
    // call site. The second registration is a no-op.
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: headerSourceKey,
      classes: 'bg-white py-4',
      sourceLocation: null,
    });
    applyCommand(doc, {
      type: 'REGISTER_SOURCE_ELEMENT',
      sourceKey: headerSourceKey,
      classes: 'bg-white py-4',
      sourceLocation: null,
    });

    const sourceClasses = doc.getMap('sourceClasses');
    expect(sourceClasses.size).toBe(1); // ONE entry, shared by every render

    // Now the user edits the Header in the DesignBar — only one source map
    // entry to update; both renders pick it up via the same key.
    applyCommand(doc, {
      type: 'UPDATE_SOURCE_CLASSES',
      sourceKey: headerSourceKey,
      classes: 'bg-blue-500 py-8',
    });

    const entry = sourceClasses.get(headerSourceKey) as Y.Map<unknown>;
    expect(entry.get('classes')).toBe('bg-blue-500 py-8');
    // Still ONE entry — no per-page or per-parent fan-out.
    expect(sourceClasses.size).toBe(1);
  });
});
