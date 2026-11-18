import { describe, it, expect } from 'vitest';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { hydrateFromProject } from '@/store/useProjectSync';
import { selectMasterMarkup, serializeMasters } from '@/store/masters';
import type { Project } from '@/api/types';
import { autoMigration } from '@/store/useProjectSync';

/**
 * Task 5 — the masters overlay round-trips through the project shape
 * (serialize on save → rebuild on hydrate), so master edits survive a reload.
 * Lazy seeding means an absent masters key is normal (no throw, empty map).
 */
function minimalProject(overrides?: Partial<Project>): Project {
  return {
    _id: 'proj-1',
    name: 'Test Project',
    pagesTree: [],
    pages: {},
    ...overrides,
  } as Project;
}

autoMigration.enabled = false; // Phase 6.2: these test the doc-truth load path itself

describe('masters persistence', () => {
  it('round-trips a masters entry through serialize → hydrate', () => {
    const src = createEditorDoc();
    applyCommand(src, { type: 'SET_MASTER_MARKUP', astroSource: 'Card.astro', markup: '<div>edited</div>' });

    const masters = serializeMasters(src);
    // rev = 1: the ↻-axis revision rides persistence (task-102).
    expect(masters).toEqual({ 'Card.astro': { markup: '<div>edited</div>', rev: 1 } });

    const fresh = createEditorDoc();
    hydrateFromProject(fresh, minimalProject({ masters } as Partial<Project>));
    expect(selectMasterMarkup(fresh, 'Card.astro')).toBe('<div>edited</div>');
  });

  it('hydrating with no masters key leaves the map empty (no throw)', () => {
    const fresh = createEditorDoc();
    hydrateFromProject(fresh, minimalProject());
    expect(fresh.getMap('masters').size).toBe(0);
    expect(selectMasterMarkup(fresh, 'X.astro')).toBeUndefined();
  });

  it('hydration clears stale masters from a prior session', () => {
    const doc = createEditorDoc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Old.astro', markup: '<i>stale</i>' });

    hydrateFromProject(doc, minimalProject({ masters: { 'New.astro': { markup: '<b>new</b>' } } } as Partial<Project>));
    expect(selectMasterMarkup(doc, 'Old.astro')).toBeUndefined();
    expect(selectMasterMarkup(doc, 'New.astro')).toBe('<b>new</b>');
  });

  it('serializeMasters returns undefined for an empty map', () => {
    expect(serializeMasters(createEditorDoc())).toBeUndefined();
  });
});
