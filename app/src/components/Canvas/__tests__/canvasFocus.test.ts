/**
 * Pure canvas focus resolution for the Layout drill (real-key model). Chrome is
 * now SCANNED (data-sq-chrome), so the page is a real tree: top-level chrome tags
 * (e.g. `layoutchrome-p1:header-0`, the slot-div `layoutchrome-p1:slot-0`) are the
 * roots, and content nests under the slot. The Layout itself has no DOM node — it
 * is the single editor-synthesized OUTERMOST level (key = the layout-chrome
 * instance root, `layoutchrome-p1`). A first click selects it; a double-click
 * enters its context and selects the clicked top-level chrome tag. Everything
 * below is the bridge's native element drill.
 */
import { describe, it, expect } from 'vitest';
import { resolveCanvasFocus, layoutSelectionRect } from '../canvasFocus';
import type { ScannedElement } from '@/context/SelectionContext';

const LAYOUT_KEY = 'layoutchrome-p1';
const SLOT_KEY = `${LAYOUT_KEY}:slot-0`;
const HEADER_KEY = `${LAYOUT_KEY}:header-0`;

function el(
  key: string,
  parentKey: string | null,
  rect: { top: number; left: number; width: number; height: number },
): ScannedElement {
  return { key, parentKey, tagName: 'section', classes: '', rect, hasSourceTracking: !key.startsWith(LAYOUT_KEY) };
}

const r0 = { top: 0, left: 0, width: 10, height: 10 };

// A laid-out page with SCANNED chrome: a header tag + a slot-div at the top level,
// content nested inside the slot, plus a nested div/img under the content section.
const SCAN: ScannedElement[] = [
  el(HEADER_KEY, null, { top: 0, left: 0, width: 100, height: 20 }),
  el(SLOT_KEY, null, { top: 20, left: 0, width: 100, height: 80 }),
  el('sec-a:section-0', SLOT_KEY, r0),
  el('sec-a:div-1', 'sec-a:section-0', r0),
  el('sec-a:img-0', 'sec-a:div-1', r0),
];

describe('resolveCanvasFocus (Layout level, real keys)', () => {
  const base = { layoutRootKey: LAYOUT_KEY, contextKey: null, scannedElements: SCAN };

  it('single click on a within-layout chrome key → select the Layout (real key)', () => {
    expect(resolveCanvasFocus({ ...base, clickedKey: SLOT_KEY, isDoubleClick: false }))
      .toEqual({ action: 'select-layout', layoutKey: LAYOUT_KEY });
  });

  it('single click on the header chrome tag → also selects the Layout', () => {
    expect(resolveCanvasFocus({ ...base, clickedKey: HEADER_KEY, isDoubleClick: false }))
      .toEqual({ action: 'select-layout', layoutKey: LAYOUT_KEY });
  });

  it('double click → enter the Layout context, select the clicked top-level chrome tag', () => {
    const res = resolveCanvasFocus({ ...base, clickedKey: SLOT_KEY, isDoubleClick: true });
    expect(res).toMatchObject({ action: 'enter-layout', layoutKey: LAYOUT_KEY });
    expect(res.action === 'enter-layout' && res.chromeElement.key).toBe(SLOT_KEY);
  });

  it('bridge drill payload (drillDownContext set) on a chrome tag → enter-layout, select that chrome tag', () => {
    const res = resolveCanvasFocus({
      ...base,
      clickedKey: SLOT_KEY,
      drillDownContext: SLOT_KEY,
      isDoubleClick: false,
    });
    expect(res).toMatchObject({ action: 'enter-layout', layoutKey: LAYOUT_KEY });
    expect(res.action === 'enter-layout' && res.chromeElement.key).toBe(SLOT_KEY);
  });

  it('already drilled in (contextKey is the layout root) → passthrough to the normal element flow', () => {
    expect(
      resolveCanvasFocus({ ...base, contextKey: LAYOUT_KEY, clickedKey: SLOT_KEY, isDoubleClick: true }),
    ).toEqual({ action: 'passthrough' });
  });

  // The editor auto-enters the Astro page wrapper ([pageId].astro) as the default
  // context, so "outermost" on a laid-out page is that wrapper, not null.
  const WRAPPER = 'src/pages/preview/[projectId]/[pageId].astro:17:29';

  it('treats the page-wrapper context as outermost: single click on chrome → select-layout', () => {
    expect(resolveCanvasFocus({ ...base, contextKey: WRAPPER, clickedKey: SLOT_KEY, isDoubleClick: false }))
      .toEqual({ action: 'select-layout', layoutKey: LAYOUT_KEY });
  });

  it('double-click at the page-wrapper context → enter-layout (drill to the chrome tag)', () => {
    const res = resolveCanvasFocus({ ...base, contextKey: WRAPPER, clickedKey: SLOT_KEY, isDoubleClick: true });
    expect(res).toMatchObject({ action: 'enter-layout', layoutKey: LAYOUT_KEY });
    expect(res.action === 'enter-layout' && res.chromeElement.key).toBe(SLOT_KEY);
  });

  it('double-click where the bridge auto-drilled PAST the slot into content → still stops at the slot', () => {
    // The bridge resolved the content (sec-a:section-0) but its drill container is
    // the slot. We must select the SLOT (one level), not jump over it to content.
    const res = resolveCanvasFocus({
      ...base,
      contextKey: WRAPPER,
      clickedKey: 'sec-a:section-0',
      drillDownContext: SLOT_KEY,
      isDoubleClick: false,
    });
    expect(res).toMatchObject({ action: 'enter-layout', layoutKey: LAYOUT_KEY });
    expect(res.action === 'enter-layout' && res.chromeElement.key).toBe(SLOT_KEY);
  });

  it('no layout → passthrough', () => {
    expect(resolveCanvasFocus({ ...base, layoutRootKey: null, clickedKey: SLOT_KEY, isDoubleClick: false }))
      .toEqual({ action: 'passthrough' });
  });

  it('click outside any layout chrome (a non-chrome key) → passthrough', () => {
    expect(resolveCanvasFocus({ ...base, clickedKey: 'Other.astro:1:1', isDoubleClick: false }))
      .toEqual({ action: 'passthrough' });
  });

  it('background click (no key) → passthrough', () => {
    expect(resolveCanvasFocus({ ...base, clickedKey: null, isDoubleClick: false }))
      .toEqual({ action: 'passthrough' });
  });
});

describe('layoutSelectionRect (union of scanned chrome tags)', () => {
  it('falls back to the union of ROOT elements when no chrome tags exist (local derived layout)', () => {
    // 2026-08-23: local layouts have no layoutchrome-keyed children — the
    // Layout's bounds are the roots' union so selecting the node draws a rect.
    expect(layoutSelectionRect([el('A:1:1', null, r0)], LAYOUT_KEY)).toEqual(r0);
    expect(layoutSelectionRect([], LAYOUT_KEY)).toBeNull();
  });

  it('root fallback ignores nested elements (only parentKey null unions)', () => {
    expect(layoutSelectionRect(
      [el('A:1:1', null, { top: 0, left: 0, width: 50, height: 50 }), el('B:2:2', 'A:1:1', { top: 0, left: 0, width: 500, height: 500 })],
      LAYOUT_KEY,
    )).toEqual({ top: 0, left: 0, width: 50, height: 50 });
  });

  it('unions the chrome tags (prefix layoutchrome-p1:), ignoring content', () => {
    // header (0,0,100,20) ∪ slot-div (20,0,100,80) = (0,0,100,100); content excluded.
    expect(layoutSelectionRect(SCAN, LAYOUT_KEY)).toEqual({ top: 0, left: 0, width: 100, height: 100 });
  });
});
