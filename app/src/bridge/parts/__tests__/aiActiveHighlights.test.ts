// app/src/bridge/parts/__tests__/aiActiveHighlights.test.ts
// Active highlight: SET_AI_ACTIVE_HIGHLIGHTS reports the touched SECTION rects
// to the parent (AI_ACTIVE_RECTS) — the canvas draws the orbiting ring there,
// outside the iframe, where the frame edge can't slice it. Inner-element keys
// additionally get the dissolve-in class on the element itself. Empty keys =
// empty rect list (clear).
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type HighlightBridge = HarnessBridge & {
  handleSetAIActiveHighlights: (p: { keys: string[] }) => void;
  handleRender: (p: { components: unknown[] }) => void;
};

/** Rects from the LAST AI_ACTIVE_RECTS the bridge sent (null = never sent). */
const sentRects = (bridge: HighlightBridge): Array<{ key: string; rect: { top: number; left: number; width: number; height: number } }> | null => {
  const calls = (bridge.sendToParent as unknown as { mock: { calls: Array<[{ type: string; payload?: { rects?: never[] } }]> } }).mock.calls
    .filter(c => c[0]?.type === 'AI_ACTIVE_RECTS');
  return calls.length ? (calls[calls.length - 1][0].payload!.rects as never) : null;
};

const rectStub = () =>
  ({ top: 10, left: 10, width: 100, height: 50, right: 110, bottom: 60, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;

describe('handleSetAIActiveHighlights (fill + orbit stroke)', () => {
  let bridge: HighlightBridge;
  beforeEach(() => {
    resetHarnessDom();
    document.body.innerHTML = '<section data-key="sec-1" style="width:100px;height:50px">x</section>';
    bridge = mountBridgeForTest() as HighlightBridge;
  });

  it('reports one UNCLAMPED rect per section, and builds no in-iframe overlay', () => {
    // jsdom rects are 0x0 — handler skips those; stub the rect
    document.querySelector('[data-key="sec-1"]')!.getBoundingClientRect = () =>
      ({ top: 10, left: 10, width: 100, height: 50, right: 110, bottom: 60, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    bridge.handleSetAIActiveHighlights({ keys: ['sec-1'] });
    expect(sentRects(bridge)).toEqual([{ key: 'sec-1', rect: { top: 10, left: 10, width: 100, height: 50 } }]);
    // The ring is the canvas's job now — nothing is drawn inside the iframe,
    // where the frame edge would clip a full-bleed section's glow.
    expect(document.querySelectorAll('[data-sq-ai-active]')).toHaveLength(0);
    expect(document.querySelectorAll('.sq-ai-glow')).toHaveLength(0);
  });

  // Regression (2026-07-25): the ring draws OUTSIDE its box (--in reaches
  // -1.25 × spread + a 3 × spread blur), so a full-bleed section flush with the
  // iframe edge had its stroke sliced off. Rects go to the parent untouched —
  // no clamping, no hiding — and the canvas paints the glow over its own
  // background.
  it('a section flush with the iframe edge reports its true rect (no clamp)', () => {
    const sec = document.querySelector('[data-key="sec-1"]')!;
    sec.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 1280, height: 400, right: 1280, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    bridge.handleSetAIActiveHighlights({ keys: ['sec-1'] });
    expect(sentRects(bridge)).toEqual([{ key: 'sec-1', rect: { top: 0, left: 0, width: 1280, height: 400 } }]);
  });

  // Regression (2026-07-23): a CREATED element's key only exists at tool-result
  // time and its highlight dispatch races the commit's RENDER — createOverlays
  // dropped unresolved keys forever, so new sections never showed the orbit
  // stroke while the AI kept working. RENDER now re-applies unresolved keys.
  // A commit moves the sections the parent is ringing, so RENDER re-MEASURES a
  // resolved set — but must not re-run the dissolve, or every commit restarts
  // the appear animation on already-highlighted elements.
  // Regression (2026-07-23): the orbit stroke drew on EVERY key, including
  // elements inside a section. Stroke is section-only; inner-element keys get
  // the dissolve+blur appear class on the element itself, no overlay.
  it('inner-element key gets .sq-ai-appear, NO orbit overlay; section key keeps the overlay', () => {
    document.body.innerHTML =
      '<section data-key="sec-1"><p data-key="el-1">hi</p></section>';
    const sec = document.querySelector('[data-key="sec-1"]')!;
    const el = document.querySelector('[data-key="el-1"]')!;
    sec.getBoundingClientRect = rectStub;
    el.getBoundingClientRect = rectStub;
    bridge.handleSetAIActiveHighlights({ keys: ['sec-1', 'el-1'] });
    const rects = sentRects(bridge)!;
    expect(rects).toHaveLength(1);
    expect(rects[0].key).toBe('sec-1');
    expect(el.classList.contains('sq-ai-appear')).toBe(true);
    expect(sec.classList.contains('sq-ai-appear')).toBe(false);
    const css = document.getElementById('sq-ai-pulse-style')!.textContent!;
    expect(css).toContain('sq-ai-appear');
    expect(css).toContain('blur(10px)');
  });

  // Regression (2026-07-23): editing an element inside a section left the
  // SECTION unmarked — the user reads the stroke as "AI grabs this section",
  // so inner-element work must stroke the enclosing root section too.
  it('inner-element-only set strokes the ENCLOSING section', () => {
    document.body.innerHTML =
      '<section data-key="sec-1"><p data-key="el-1">hi</p></section>';
    const sec = document.querySelector('[data-key="sec-1"]')!;
    const el = document.querySelector('[data-key="el-1"]')!;
    sec.getBoundingClientRect = rectStub;
    el.getBoundingClientRect = rectStub;
    bridge.handleSetAIActiveHighlights({ keys: ['el-1'] });
    expect(sentRects(bridge)).toHaveLength(1); // section stroked via the inner key
    expect(el.classList.contains('sq-ai-appear')).toBe(true);
  });

  // Regression (2026-07-23): appear classes stayed on REAL elements forever —
  // getElementClasses returns raw className, so a later click/scan echoed
  // sq-ai-* into Yjs (class pollution). Animation classes must self-clean.
  it('appear classes self-clean on animationend (no className pollution)', () => {
    document.body.innerHTML =
      '<section data-key="sec-1"><p data-key="el-1">hi</p></section>';
    document.querySelector('[data-key="sec-1"]')!.getBoundingClientRect = rectStub;
    const el = document.querySelector('[data-key="el-1"]')!;
    el.getBoundingClientRect = rectStub;
    bridge.handleSetAIActiveHighlights({ keys: ['el-1'] });
    expect(el.classList.contains('sq-ai-appear')).toBe(true);
    el.dispatchEvent(new Event('animationend'));
    expect(el.classList.contains('sq-ai-appear')).toBe(false);
  });

  // Regression (2026-07-23): a committed NEW section popped in whole. During
  // an AI run (live highlight set non-empty) its elements appear one by one —
  // dissolve+blur with a 70ms stagger. Pre-existing roots never re-animate,
  // and non-AI renders are untouched. (Streamed-preview swaps skip this —
  // content already appeared progressively.)
  // Regression (2026-07-24, live [SQ-BLINK] log: "aiSwap: false" on the commit
  // RENDER while the preview was still up): providers that emit tool-call after
  // execution deliver RENDER before the stream's END — endPending is false, so
  // the commit stagger re-animated the just-streamed section from opacity 0.
  // The user watched their design vanish and dissolve back in. A LIVE preview
  // on screen must suppress the stagger exactly like a pending swap does.
  it('clearing highlights strips .sq-ai-appear so a re-highlight re-animates', () => {
    document.body.innerHTML =
      '<section data-key="sec-1"><p data-key="el-1">hi</p></section>';
    document.querySelector('[data-key="sec-1"]')!.getBoundingClientRect = rectStub;
    const el = document.querySelector('[data-key="el-1"]')!;
    el.getBoundingClientRect = rectStub;
    bridge.handleSetAIActiveHighlights({ keys: ['el-1'] });
    expect(el.classList.contains('sq-ai-appear')).toBe(true);
    bridge.handleSetAIActiveHighlights({ keys: [] });
    expect(el.classList.contains('sq-ai-appear')).toBe(false);
  });

  // Regression (2026-07-23, found via live [SQ-DBG] probes): #sq-components
  // carries a data-sq-source of the preview shell .astro — findRootSection
  // climbed past every section to it, producing ONE page-sized overlay
  // instead of per-section strokes (the stroke hugged the canvas edge and
  // read as "no stroke on the section").
  it('sections inside the keyed #sq-components wrapper stroke PER SECTION, not the page', () => {
    document.body.innerHTML =
      '<div id="sq-components" data-sq-source="src/pages/preview/[p]/[p].astro:18:29">' +
      '<section data-key="a:section-0"><p data-key="a:p-1">x</p></section>' +
      '<section data-key="b:section-0"><p data-key="b:p-1">y</p></section>' +
      '</div>';
    document.querySelectorAll('section, #sq-components').forEach(el => {
      (el as HTMLElement).getBoundingClientRect = rectStub;
    });
    bridge.handleSetAIActiveHighlights({ keys: ['a', 'b'], runActive: true } as never);
    expect(sentRects(bridge)).toHaveLength(2); // one per created section — not one page blob
  });

  // Run-active flag (2026-07-23): the first commit's RENDER reliably beats
  // the first key dispatch, so the stagger gate can't be inferred from keys.
  it('empty keys clear the parent rings', () => {
    document.querySelector('[data-key="sec-1"]')!.getBoundingClientRect = () =>
      ({ top: 10, left: 10, width: 100, height: 50, right: 110, bottom: 60, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;
    bridge.handleSetAIActiveHighlights({ keys: ['sec-1'] });
    expect(sentRects(bridge)).toHaveLength(1);
    bridge.handleSetAIActiveHighlights({ keys: [] });
    expect(sentRects(bridge)).toEqual([]);
  });
});
