/**
 * Layout wrap on pages selectPageComponents used to skip entirely:
 *
 * 1. An EMPTY page (zero rootElementIds) with a layout applied rendered
 *    NOTHING — the early `rootElementIds.length === 0` return fired before the
 *    layout-wrap branch, so applying a layout to a fresh page left a blank
 *    canvas (round-2 blind-judge S1 finding).
 * 2. A page whose only content is DRAWN elements left the default <slot>
 *    literal (drawn roots are skipped by design), so the canvas showed the
 *    empty-slot "Choose Component" placeholder ABOVE the user's own drawn
 *    content, and the drawn elements mounted OUTSIDE the slot (S3/S5 finding).
 *    Now the default slot is force-wrapped into the persistent
 *    <div data-sq-slot> container whenever the page has drawn roots, so the
 *    bridge mounts drawn roots INSIDE it and no placeholder renders.
 */
import { describe, it, expect } from 'vitest';
import { applyCommand } from '../commands';
import { createEditorDoc } from '../createEditorDoc';
import { selectPageComponents } from '../selectors';
import { emptyClassData } from '../types';
import { ensureLayoutElement } from '../layoutElement';

const BODY = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="UTF-8" /><title>t</title></head>',
  '<body class="shell">',
  '<header class="nav">NAV</header>',
  '<slot />',
  '</body></html>',
].join('');

function docWithPage(pageId: string) {
  const doc = createEditorDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: pageId, name: 'Home', rootElementIds: [], children: [] } });
  return doc;
}

describe('selectPageComponents — empty and drawn-only pages with a layout', () => {
  it('renders the layout chrome on an EMPTY page (apply must not leave a blank canvas)', () => {
    const doc = docWithPage('p1');
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'L' });

    const out = selectPageComponents(doc, 'p1', new Map([['L', BODY]]));
    expect(out).toHaveLength(1);
    const markup = out[0].staticMarkup;
    expect(markup).toContain('<header class="nav">NAV</header>');
    // No content and no drawn roots: the literal <slot> stays so the
    // "Choose Component" overlay can target it.
    expect(markup).toMatch(/<slot\b/i);
  });

  it('still renders nothing on an empty page WITHOUT a layout', () => {
    const doc = docWithPage('p2');
    expect(selectPageComponents(doc, 'p2', new Map())).toEqual([]);
  });

  it('wraps the default slot into the data-sq-slot container when the page has drawn roots', () => {
    const doc = docWithPage('p3');
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: { key: 'drawn-1', pageId: 'p3', parentKey: null, insertIndex: 0, tag: 'div', classes: 'w-10', x: 0, y: 0, width: 10, height: 10 },
    } as never);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p3', layoutName: 'L' });

    const out = selectPageComponents(doc, 'p3', new Map([['L', BODY]]));
    expect(out).toHaveLength(1);
    const markup = out[0].staticMarkup;
    // The slot is a persistent container the bridge mounts drawn roots into —
    // NOT a literal <slot> (which would render the "Choose Component"
    // placeholder above the user's drawn content).
    expect(markup).toContain('data-sq-slot');
    expect(markup).not.toMatch(/<slot\b/i);
    // Drawn markup itself never rides the components payload.
    expect(markup).not.toContain('drawn-1');
  });

  it('a NESTED drawn element alone does not force-wrap the slot (roots only)', () => {
    const doc = docWithPage('p4');
    applyCommand(doc, {
      type: 'ADD_ELEMENT',
      element: { id: 'el-host', pageId: 'p4', parentId: null, index: 0, type: 'instance', classes: emptyClassData(), staticMarkup: '<section data-astro-source-file="X">A</section>' },
    } as never);
    applyCommand(doc, {
      type: 'ADD_DRAWN_ELEMENT',
      element: { key: 'drawn-child', pageId: 'p4', parentKey: 'el-host', insertIndex: 0, tag: 'div', classes: '', x: 0, y: 0, width: 10, height: 10 },
    } as never);
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p4', layoutName: 'L' });

    const out = selectPageComponents(doc, 'p4', new Map([['L', BODY]]));
    const markup = out[0].staticMarkup;
    // Real content fills the slot → container div (existing behavior).
    expect(markup).toContain('data-sq-slot');
    expect(markup).toContain('>A<');
  });
});

describe('layout chrome rebases on the FILE body (2026-08-27)', () => {
  // Regression: the page's layout-chrome element stored a snapshot taken when
  // the layout was applied, and selectPageComponents rendered THAT. Anything
  // the user later put in the layout master — a nav, a footer — was written to
  // the .astro but never reached any page, with no affordance to pull it. The
  // file is the layout's source of truth; the doc element carries overrides.
  const STALE = '<body class="shell"><slot /></body>';
  const FRESH = '<body class="shell"><header class="nav">NAV</header><slot /></body>';

  function pageWithMaterializedLayout(bodyAtApplyTime: string) {
    const doc = docWithPage('p1');
    applyCommand(doc, { type: 'SET_PAGE_LAYOUT', pageId: 'p1', layoutName: 'L' });
    // Materialize the chrome element the way the DesignBar / render fallback
    // does, snapshotting the body as it looked when the layout was applied.
    ensureLayoutElement(doc, 'p1', 'L', bodyAtApplyTime);
    return doc;
  }

  it('renders the CURRENT discovered body, not the stored snapshot', () => {
    const doc = pageWithMaterializedLayout(STALE);
    const markup = selectPageComponents(doc, 'p1', new Map([['L', FRESH]]))
      .map((c) => c.staticMarkup).join('');
    expect(markup).toContain('NAV');
  });

  it('falls back to the stored snapshot when the layout is not discoverable', () => {
    const doc = pageWithMaterializedLayout(FRESH);
    const markup = selectPageComponents(doc, 'p1', new Map())
      .map((c) => c.staticMarkup).join('');
    expect(markup).toContain('NAV');
  });
});
