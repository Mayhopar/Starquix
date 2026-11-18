/**
 * Tests for hydrateFromProject — verifies that stale source tracking maps
 * are cleared when re-hydrating a project.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createEditorDoc } from '../createEditorDoc';
import { hydrateFromProject, validateProjectForHydration } from '../useProjectSync';
import type { Project } from '@/api/types';
import { autoMigration } from '@/store/useProjectSync';

function makeMinimalProject(overrides?: Partial<Project>): Project {
  return {
    _id: 'proj-1',
    name: 'Test Project',
    pagesTree: [{ id: 'page-1', name: 'Home', children: [] }],
    pages: {
      'page-1': {
        name: 'Home',
        components: [
          { id: 'el-1', staticMarkup: '<section>Hello</section>' },
        ],
      },
    },
    ...overrides,
  } as Project;
}

autoMigration.enabled = false; // Phase 6.2: these test the doc-truth load path itself

describe('hydrateFromProject', () => {
  it('clears sourceClasses on re-hydration', () => {
    const doc = createEditorDoc();

    // Simulate stale sourceClasses from a previous iframe scan
    const sourceClasses = doc.getMap('sourceClasses');
    const staleEntry = new Y.Map();
    staleEntry.set('base', Y.Array.from(['text-red-500']));
    sourceClasses.set('old-element:div-0', staleEntry);

    expect(sourceClasses.size).toBe(1);

    // Re-hydrate — should clear stale entries
    hydrateFromProject(doc, makeMinimalProject());

    expect(sourceClasses.size).toBe(0);
  });

  it('clears sourceText on re-hydration', () => {
    const doc = createEditorDoc();

    const sourceText = doc.getMap('sourceText');
    const staleEntry = new Y.Map();
    staleEntry.set('text', 'old text');
    sourceText.set('old-element:p-0', staleEntry);

    expect(sourceText.size).toBe(1);

    hydrateFromProject(doc, makeMinimalProject());

    expect(sourceText.size).toBe(0);
  });

  it('clears sourceImageAttributes on re-hydration', () => {
    const doc = createEditorDoc();

    const sourceImageAttributes = doc.getMap('sourceImageAttributes');
    const staleEntry = new Y.Map();
    staleEntry.set('src', '/old-image.png');
    sourceImageAttributes.set('old-element', staleEntry);

    expect(sourceImageAttributes.size).toBe(1);

    hydrateFromProject(doc, makeMinimalProject());

    expect(sourceImageAttributes.size).toBe(0);
  });

  it('clears sourceLinkAttributes on re-hydration', () => {
    const doc = createEditorDoc();

    const sourceLinkAttributes = doc.getMap('sourceLinkAttributes');
    const staleEntry = new Y.Map();
    staleEntry.set('href', 'https://old-link.com');
    sourceLinkAttributes.set('old-element', staleEntry);

    expect(sourceLinkAttributes.size).toBe(1);

    hydrateFromProject(doc, makeMinimalProject());

    expect(sourceLinkAttributes.size).toBe(0);
  });

  describe('atomic hydration (task-019)', () => {
    it('refuses to hydrate when project is null and leaves doc untouched', () => {
      const doc = createEditorDoc();

      // Seed pre-existing state — should still be intact after a refused hydrate
      hydrateFromProject(doc, makeMinimalProject());
      expect(doc.getMap('elements').size).toBe(1);
      expect(doc.getMap('pages').size).toBe(1);

      // Pollute the source maps to verify they are NOT cleared on validation failure
      doc.getMap('sourceClasses').set('keep-me', new Y.Map());

      expect(() => hydrateFromProject(doc, null as unknown as Project)).toThrow(
        /not an object/
      );

      // State preserved
      expect(doc.getMap('elements').size).toBe(1);
      expect(doc.getMap('pages').size).toBe(1);
      expect(doc.getMap('sourceClasses').get('keep-me')).toBeDefined();
    });

    it('refuses to hydrate when a page entry is malformed and leaves doc untouched', () => {
      const doc = createEditorDoc();

      hydrateFromProject(doc, makeMinimalProject());
      expect(doc.getMap('elements').size).toBe(1);
      const originalElementId = (doc.getMap('elements').get('el-1') as Y.Map<unknown>).get('id');
      expect(originalElementId).toBe('el-1');

      // Build a project where one page entry is missing required fields
      const bad = makeMinimalProject({
        pages: {
          'page-1': {
            name: 'Home',
            // intentionally invalid: components contains an entry without an id
            components: [{ staticMarkup: '<div/>' } as unknown as { id: string }],
          },
        },
      });

      expect(() => hydrateFromProject(doc, bad)).toThrow(/components\[0\]\.id/);

      // Pre-existing element is still there — clear-step never ran
      expect(doc.getMap('elements').size).toBe(1);
      expect((doc.getMap('elements').get('el-1') as Y.Map<unknown>).get('id')).toBe('el-1');
    });

    it('refuses to hydrate when project.pages is not an object', () => {
      const doc = createEditorDoc();
      hydrateFromProject(doc, makeMinimalProject());

      const bad = { ...makeMinimalProject(), pages: [] as unknown as Project['pages'] };
      expect(() => hydrateFromProject(doc, bad)).toThrow(/project\.pages/);

      // Doc untouched
      expect(doc.getMap('pages').size).toBe(1);
    });

    it('validateProjectForHydration accepts a well-formed project', () => {
      expect(() => validateProjectForHydration(makeMinimalProject())).not.toThrow();
    });

    it('validateProjectForHydration accepts pages with no components', () => {
      const minimal = makeMinimalProject({
        pages: {
          'page-1': { name: 'Home' } as unknown as Project['pages'][string],
        },
      });
      expect(() => validateProjectForHydration(minimal)).not.toThrow();
    });
  });

  it('clears all four source maps while preserving hydrated elements', () => {
    const doc = createEditorDoc();

    // Pollute all four source maps
    doc.getMap('sourceClasses').set('stale-key', new Y.Map());
    doc.getMap('sourceText').set('stale-key', new Y.Map());
    doc.getMap('sourceImageAttributes').set('stale-id', new Y.Map());
    doc.getMap('sourceLinkAttributes').set('stale-id', new Y.Map());

    hydrateFromProject(doc, makeMinimalProject());

    // Source maps cleared
    expect(doc.getMap('sourceClasses').size).toBe(0);
    expect(doc.getMap('sourceText').size).toBe(0);
    expect(doc.getMap('sourceImageAttributes').size).toBe(0);
    expect(doc.getMap('sourceLinkAttributes').size).toBe(0);

    // Elements from the project are hydrated
    const elements = doc.getMap('elements');
    expect(elements.size).toBe(1);
    const el = elements.get('el-1') as Y.Map<unknown>;
    expect(el.get('id')).toBe('el-1');
  });
});

// ── Wrong-file-write root cause (live-smoke Critical, local mode).
// The Editor subtree remounts during local-project startup (observed live:
// MOUNT/UNMOUNT/MOUNT within ~100ms, plus a later one as the local instance
// flips to running). Every remount re-runs loadProject → hydrateFromProject,
// whose last act used to be an UNCONDITIONAL
// `meta.currentPageId = rootPages[0]`. A page the user had just clicked was
// silently reverted to the index page — the canvas and Layers stayed on the
// old page while the user believed they had switched, and the next ⌘K wrote
// into the WRONG real file. Re-hydration must preserve a still-valid
// selection.
describe('hydrateFromProject — currentPageId preservation', () => {
  function twoPageProject(): Project {
    return {
      _id: 'proj-1',
      name: 'Test Project',
      pagesTree: [
        { id: 'index', name: '/', children: [] },
        { id: 'layout-only', name: '/layout-only', children: [] },
      ],
      pages: {
        index: { name: '/', components: [] },
        'layout-only': { name: '/layout-only', components: [] },
      },
    } as unknown as Project;
  }

  it('seeds the first page when nothing is selected yet', () => {
    const doc = createEditorDoc();
    hydrateFromProject(doc, twoPageProject());
    expect(doc.getMap('meta').get('currentPageId')).toBe('index');
  });

  it('THE BUG: a re-hydration must NOT revert the user\'s page selection', () => {
    const doc = createEditorDoc();
    hydrateFromProject(doc, twoPageProject());
    // user clicks /layout-only in the Pages panel
    doc.getMap('meta').set('currentPageId', 'layout-only');
    // Editor remounts → loadProject runs again → re-hydration
    hydrateFromProject(doc, twoPageProject());
    expect(doc.getMap('meta').get('currentPageId')).toBe('layout-only');
  });

  it('a selection that no longer exists falls back to the first page', () => {
    const doc = createEditorDoc();
    hydrateFromProject(doc, twoPageProject());
    doc.getMap('meta').set('currentPageId', 'deleted-page');
    hydrateFromProject(doc, twoPageProject());
    expect(doc.getMap('meta').get('currentPageId')).toBe('index');
  });

  it('switching to a DIFFERENT project resets to its first page', () => {
    const doc = createEditorDoc();
    hydrateFromProject(doc, twoPageProject());
    doc.getMap('meta').set('currentPageId', 'layout-only');
    hydrateFromProject(doc, makeMinimalProject());
    expect(doc.getMap('meta').get('currentPageId')).toBe('page-1');
  });
});
