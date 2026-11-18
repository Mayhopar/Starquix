/**
 * A layout master's top-level rows are separate doc elements, and each one's
 * astroSource points at its own DEFINITION (`library/Header.astro`), not at the
 * layout being edited. Reordering them is a doc root reorder that no writer
 * mirrors to source, so the master re-seeded from the file on reopen and the
 * moved component snapped back to the bottom — every time.
 *
 * Proven against the live endpoint 2026-08-27: POSTing
 * {orderOverrides:['header-0','slot-0']} for layouts/Layout.astro moves
 * <Header /> above <slot /> in the real file.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { collectMasterOrderWrite, collectChromeOrderWrite } from '../masterOrderWrite';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';

const EDITOR = COMPONENT_EDITOR_PAGE_ID;

describe('collectMasterOrderWrite', () => {
  const doc = new Y.Doc();

  it('writes the new order against the VIEWED file, not each rowic source', () => {
    const out = collectMasterOrderWrite(doc, EDITOR, ['el-2:header-0', 'el-1:slot-0'], 'layouts/Layout.astro');
    expect(out).toEqual({ astroSource: 'layouts/Layout.astro', selectors: ['header-0', 'slot-0'] });
  });

  it('does nothing on a page (only a master edits a file this way)', () => {
    expect(collectMasterOrderWrite(doc, 'page-1', ['el-2:header-0', 'el-1:slot-0'], 'layouts/Layout.astro')).toBeNull();
  });

  it('does nothing without a viewed file', () => {
    expect(collectMasterOrderWrite(doc, EDITOR, ['el-2:header-0', 'el-1:slot-0'], null)).toBeNull();
  });

  it('skips rows that are not file tags — drawn / dynamic scan artifacts poisoned CANVAS reorders (2026-08-27)', () => {
    const out = collectMasterOrderWrite(
      doc, EDITOR,
      ['el-2:header-0', 'dynamic:div:3@npgr1r', 'el-1:slot-0', 'drawn-x'],
      'layouts/Layout.astro',
    );
    expect(out).toEqual({ astroSource: 'layouts/Layout.astro', selectors: ['header-0', 'slot-0'] });
  });

  it('does nothing when fewer than two rows are file tags', () => {
    expect(collectMasterOrderWrite(doc, EDITOR, ['el-2', 'el-1:slot-0'], 'layouts/Layout.astro')).toBeNull();
  });

  it('does nothing for a single row (no order to express)', () => {
    expect(collectMasterOrderWrite(doc, EDITOR, ['el-1:slot-0'], 'layouts/Layout.astro')).toBeNull();
  });
});

/**
 * Reordering the layout's chrome rows in the PAGE tree went through the
 * Editor's useLayersDrag instance (no viewedComponentFile), so
 * collectMasterOrderWrite returned null and the reorder was doc-only: it looked
 * moved, then reset on the next rescan/reload because the chrome rebases on the
 * file body every render. Proven live 2026-08-27:
 * `collectMasterOrderWrite -> null (gate1) {"pageId":"02b32dd3-…","viewedComponentFile":null}`.
 * The page can't name FILE selectors (its slot renders as a div, a component
 * renders as its root tag), so the write is a PERMUTATION of top-level
 * positions, resolved server-side against the real AST.
 */
describe('collectChromeOrderWrite', () => {
  const CHROME = 'layoutchrome-page-1';
  const k = (sel: string) => `${CHROME}:${sel}`;
  const OLD = [k('div-0'), k('footer-0'), k('header-0')];

  function docWithChrome(astroSource: string | null = 'layouts/Layout1.astro'): Y.Doc {
    const doc = new Y.Doc();
    const el = new Y.Map<unknown>();
    if (astroSource !== null) el.set('astroSource', astroSource);
    doc.getMap('elements').set(CHROME, el);
    return doc;
  }

  it('maps the new visual order to a permutation of the previous order, against the layout file', () => {
    const doc = docWithChrome();
    const out = collectChromeOrderWrite(doc, 'page-1', [k('div-0'), k('header-0'), k('footer-0')], OLD);
    expect(out).toEqual({ astroSource: 'layouts/Layout1.astro', permutation: [0, 2, 1], rendered: ['div-0', 'footer-0', 'header-0'] });
  });

  it('does nothing in the master editor (that surface names file selectors directly)', () => {
    const doc = docWithChrome();
    expect(collectChromeOrderWrite(doc, COMPONENT_EDITOR_PAGE_ID, [k('div-0'), k('header-0')], [k('div-0'), k('header-0')])).toBeNull();
  });

  it('does nothing when a key belongs to another element (mixed drag)', () => {
    const doc = docWithChrome();
    expect(collectChromeOrderWrite(doc, 'page-1', [k('div-0'), 'el-9:header-0'], OLD.slice(0, 2))).toBeNull();
  });

  it('does nothing when the chrome element is missing or has no layouts/ source', () => {
    expect(collectChromeOrderWrite(new Y.Doc(), 'page-1', [k('div-0'), k('header-0')], [k('div-0'), k('header-0')])).toBeNull();
    const doc = docWithChrome('library/Header.astro');
    expect(collectChromeOrderWrite(doc, 'page-1', [k('div-0'), k('header-0')], [k('div-0'), k('header-0')])).toBeNull();
  });

  it('does nothing when the previous order is not the same set of rows', () => {
    const doc = docWithChrome();
    expect(collectChromeOrderWrite(doc, 'page-1', [k('div-0'), k('header-0')], [k('div-0'), k('footer-0')])).toBeNull();
    expect(collectChromeOrderWrite(doc, 'page-1', [k('div-0'), k('header-0')], OLD)).toBeNull();
  });

  it('does nothing for a single row', () => {
    const doc = docWithChrome();
    expect(collectChromeOrderWrite(doc, 'page-1', [k('div-0')], [k('div-0')])).toBeNull();
  });
});
