/**
 * The scope numbers behind the Push/Reset confirmation and the master view's
 * usage affordance (owner review 2026-08-03).
 *
 * The two units must never be conflated: a page that places the component twice
 * is ONE page and up to TWO overridden placements. Printing the second as a
 * page count would be the same class of lie the `*` marker was telling.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  selectDocComponentUsage,
  selectLocalOverriddenPlacements,
  EMPTY_COMPONENT_USAGE,
} from '../componentUsage';
import { COMPONENT_EDITOR_PAGE_ID } from '../constants';

const SRC = 'src/components/Header.astro';
const MARKUP = '<div class="p-4"><h1 class="text-xl">T</h1><p class="text-sm">B</p></div>';

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    for (const [id, name] of [['page-1', 'Home'], ['page-2', 'About']] as const) {
      const p = new Y.Map();
      p.set('id', id); p.set('name', name);
      doc.getMap('pages').set(id, p);
    }
  }, 'sync');
  return doc;
}

function addInstance(doc: Y.Doc, id: string, pageId: string, src = SRC): Y.Map<unknown> {
  const yEl = new Y.Map();
  doc.transact(() => {
    yEl.set('astroSource', src);
    yEl.set('pageId', pageId);
    yEl.set('staticMarkup', MARKUP);
    doc.getMap('elements').set(id, yEl);
  }, 'sync');
  return yEl;
}

describe('selectDocComponentUsage (WC / server)', () => {
  it('no source → empty', () => {
    expect(selectDocComponentUsage(makeDoc(), null)).toEqual(EMPTY_COMPONENT_USAGE);
  });

  /**
   * Over-count found in the 2026-08-04 recording: the master view read
   * `3 uses` and the list's third row was labelled `Feature` — the component
   * itself. `seedComponentEditor` materialises the master as a real doc page
   * named after the component whose root carries the same `astroSource`, so it
   * was counted as a page that "renders" it.
   */
  it('never counts the component editor\'s own page as a use', () => {
    const doc = makeDoc();
    doc.transact(() => {
      const p = new Y.Map();
      p.set('id', COMPONENT_EDITOR_PAGE_ID);
      p.set('name', 'Header'); // seedComponentEditor names it after the component
      doc.getMap('pages').set(COMPONENT_EDITOR_PAGE_ID, p);
    }, 'sync');
    addInstance(doc, 'el-1', 'page-1');
    addInstance(doc, 'el-2', 'page-2');
    addInstance(doc, 'el-master', COMPONENT_EDITOR_PAGE_ID);

    const usage = selectDocComponentUsage(doc, SRC);
    expect(usage.pages).toEqual([
      { pageId: 'page-1', label: '/' },
      { pageId: 'page-2', label: '/about' },
    ]);
    expect(usage.pages.map((p) => p.label)).not.toContain('Header');
  });

  /**
   * Blind review 2026-08-04 item 5: local's usage list showed ROUTES and
   * WC/server's showed page NAMES, for the same popover. Routes won everywhere
   * (store/pageRoute.ts) — including here, so a user reading "where is this
   * component used" gets the same answer shape in both runtimes.
   */
  it('lists the pages that render the component, by ROUTE', () => {
    const doc = makeDoc();
    addInstance(doc, 'el-1', 'page-1');
    addInstance(doc, 'el-2', 'page-2');
    addInstance(doc, 'el-3', 'page-1', 'src/components/Other.astro');

    const usage = selectDocComponentUsage(doc, SRC);
    expect(usage.pages).toEqual([
      { pageId: 'page-1', label: '/' },
      { pageId: 'page-2', label: '/about' },
    ]);
  });

  it('two placements on ONE page = one page, two placements', () => {
    const doc = makeDoc();
    const a = addInstance(doc, 'el-1', 'page-1');
    const b = addInstance(doc, 'el-2', 'page-1');
    doc.transact(() => {
      doc.getMap('sourceText').set('el-1:p-0', 'edited');
      doc.getMap('sourceText').set('el-2:p-0', 'edited too');
      void a; void b;
    }, 'sync');

    const usage = selectDocComponentUsage(doc, SRC);
    expect(usage.pages).toHaveLength(1);
    expect(usage.overriddenPlacements).toBe(2);
  });

  it('an untouched placement is not counted as overridden', () => {
    const doc = makeDoc();
    addInstance(doc, 'el-1', 'page-1');
    addInstance(doc, 'el-2', 'page-2');
    doc.transact(() => { doc.getMap('sourceText').set('el-1:p-0', 'edited'); }, 'sync');

    expect(selectDocComponentUsage(doc, SRC).overriddenPlacements).toBe(1);
  });
});

describe('selectLocalOverriddenPlacements (local)', () => {
  const editedClasses = (doc: Y.Doc, key: string) => {
    const e = new Y.Map();
    e.set('classes', 'text-3xl');
    e.set('edited', true);
    doc.getMap('sourceClasses').set(key, e);
  };

  it('counts DISTINCT placements of the file, not entries', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      editedClasses(doc, `${SRC}:3:1~paaaaaaaaaaaaaaa1`);
      editedClasses(doc, `${SRC}:9:1~paaaaaaaaaaaaaaa1`); // same placement
      editedClasses(doc, `${SRC}:3:1~pbbbbbbbbbbbbbbb2`); // second placement
    }, 'sync');
    expect(selectLocalOverriddenPlacements(doc, SRC)).toBe(2);
  });

  it('ignores other files and inert (registered-but-unedited) class entries', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      editedClasses(doc, 'src/components/Other.astro:3:1~paaaaaaaaaaaaaaa1');
      const inert = new Y.Map();
      inert.set('classes', 'text-xl'); // no `edited` stamp
      doc.getMap('sourceClasses').set(`${SRC}:3:1~pccccccccccccccc3`, inert);
    }, 'sync');
    expect(selectLocalOverriddenPlacements(doc, SRC)).toBe(0);
  });

  it('text and image overrides count too, and a bare key is one unscoped placement', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap('sourceText').set(`${SRC}:4:1`, 'hi');
      const attrs = new Y.Map();
      attrs.set('alt', 'x');
      doc.getMap('sourceImageAttributes').set(`${SRC}:7:1~paaaaaaaaaaaaaaa1`, attrs);
    }, 'sync');
    expect(selectLocalOverriddenPlacements(doc, SRC)).toBe(2);
  });

  /**
   * task-187 — the confirmation was promising something Push does not do.
   *
   * Measured live on the owner's project (Header placed on `/` and `/about`,
   * doc holding an edited BARE key `src/components/Header.astro:6:1` from a
   * master-view Fill edit plus an edited placement key `…:6:1~sa36223c3e9daaf17`
   * from a page-side one). Standing on the placement, the modal read:
   *
   *   "1 change will be written into Header. 2 pages render it and will show the
   *    new version. 1 other placement currently overrides it and will keep the
   *    edits already made there."
   *
   * The "other placement" WAS the bare key — which task-185's
   * `supersededMasterOverrides` clears as part of that very Push. The copy
   * subtracts exactly one for the placement being acted on, so the bare key has
   * to leave the count when it is not the one being acted on.
   */
  it('does not count the master\'s own bare key as an OTHER placement — Push clears it', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      editedClasses(doc, `${SRC}:6:1`);                        // master-view edit
      editedClasses(doc, `${SRC}:6:1~sa36223c3e9daaf17`);      // the placement being pushed
    }, 'sync');
    expect(selectLocalOverriddenPlacements(doc, SRC, 'sa36223c3e9daaf17')).toBe(1);
  });

  /** Standing on the master itself, the bare key IS the one being acted on —
   *  it must stay in the count, or the `- 1` subtraction under-reports the real
   *  other placements, which that Push genuinely leaves overriding. */
  it('counts the bare key when it IS the placement being acted on (master view)', () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      editedClasses(doc, `${SRC}:6:1`);
      editedClasses(doc, `${SRC}:6:1~sa36223c3e9daaf17`);
    }, 'sync');
    expect(selectLocalOverriddenPlacements(doc, SRC, undefined)).toBe(2);
  });

  it('no file → 0', () => {
    expect(selectLocalOverriddenPlacements(new Y.Doc(), null)).toBe(0);
  });
});
