/**
 * Blind review 2026-08-05: the Pages panel badged `Home` on WC/server but never
 * in local — the disk-scan seed (`/__sq/local/pages` → useProjectSync) built its
 * page rows without `isHome`, and the local load path skips
 * runSelfHealMigrations so stampHomePage never re-derived it either. Same panel,
 * same semantic state, different chrome.
 *
 * The `/` route IS the home page in a files-truth project (its file is the real
 * src/pages/index.astro), so it carries the SAME flag PageTreeNode already
 * renders. No `/` route = no home page; never guess one.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { buildLocalSeedPages, hydrateFromProject } from '../useProjectSync';
import { selectPage, selectHomePageId } from '../selectors';
import type { Project } from '@/api/types';
import { autoMigration } from '@/store/useProjectSync';

// The shape /__sq/local/pages actually returns for fixtures/local-astro-project
// (verified live): index + a second .astro route + a non-editable .md route.
const DISCOVERED = [
  { route: '/', file: 'src/pages/index.astro', editable: true },
  { route: '/about', file: 'src/pages/about.astro', editable: true },
  { route: '/notes', file: 'src/pages/notes.md', editable: false },
];

function seededDoc(discovered: Array<{ route: string }>): Y.Doc {
  const doc = new Y.Doc();
  hydrateFromProject(doc, {
    _id: 'browser_lf_seedhome',
    name: 'local-astro-project',
    pagesTree: [],
    pages: buildLocalSeedPages(discovered),
  } as unknown as Project);
  return doc;
}

autoMigration.enabled = false; // Phase 6.2: these test the doc-truth load path itself

describe('local disk-scan seeding stamps the home page', () => {
  it('the `/` route carries isHome, so the Pages panel badge renders', () => {
    const doc = seededDoc(DISCOVERED);
    expect(selectPage(doc, 'index')?.isHome).toBe(true);
  });

  it('no other discovered route is badged', () => {
    const doc = seededDoc(DISCOVERED);
    expect(selectPage(doc, 'about')?.isHome).toBeUndefined();
    expect(selectPage(doc, 'notes')?.isHome).toBeUndefined();
  });

  it('the flag is the one selectHomePageId resolves — not a parallel signal', () => {
    // '/about' first in discovery order: the flag must win over the
    // "first root page" fallback, or the badge and the resolver disagree.
    const doc = seededDoc([DISCOVERED[1], DISCOVERED[0], DISCOVERED[2]]);
    expect(selectHomePageId(doc)).toBe('index');
  });

  it('a folder with no `/` route has no home page — never guesses one', () => {
    const doc = seededDoc([DISCOVERED[1], DISCOVERED[2]]);
    expect(selectPage(doc, 'about')?.isHome).toBeUndefined();
    expect(selectPage(doc, 'notes')?.isHome).toBeUndefined();
  });
});
