/**
 * task-149 — the TWO placement rulings, held simultaneously, over real bytes.
 *
 * Fixtures are the literal HTML served by `astro dev` 4.16.19 running the
 * local-mode plugin over a rig whose pages put ALL their content inside a
 * layout's `<slot>` — the realistic Astro shape, and the one the 2026-08-04
 * regression was reported on. Captured 2026-08-04 from 127.0.0.1:4714.
 *
 *   src/layouts/Base.astro     static layout, carries its own
 *                              `<script is:inline src="/scripts/bridge.js">`
 *                              (the tag that used to disarm local mode) and
 *                              compiles to the memoised `__template` form
 *   src/components/Card.astro  ordinary component (has an expression)
 *   src/components/Plain.astro static component — also `__template`
 *   /                          h1 + 2 Card + 2 Plain, all inside the slot
 *   /about                     h1 + 1 Card + 1 Plain, all inside the slot
 *   /nolayout                  the same components placed with NO layout
 *
 * The two rulings are in tension and both must hold:
 *   1. layout chrome is SHARED across routes (owner ruling 2026-08-03) —
 *      matching server/WC, where the layout instance is shared chrome;
 *   2. content the PAGE places is per-page, even though it flows THROUGH the
 *      layout's slot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import slotIndexHtml from './fixtures/slot-index.html?raw';
import slotAboutHtml from './fixtures/slot-about.html?raw';
import slotNoLayoutHtml from './fixtures/slot-nolayout.html?raw';

type ScannedEl = { key: string; tagName: string };

function scanOf(page: string): ScannedEl[] {
  // Strip the astro dev-toolbar scripts; only <body> content matters here.
  document.body.innerHTML = page.replace(/<script[\s\S]*?<\/script>/g, '');
  const bridge: HarnessBridge = mountBridgeForTest();
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  return (
    send.mock.calls
      .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
      .find((m) => m.type === 'ELEMENTS_SCANNED')?.payload?.elements ?? []
  );
}

const keysFor = (page: string, file: string) =>
  scanOf(page).filter((e) => e.key.includes(file)).map((e) => e.key);

const PLACEMENT = /~[pqs][0-9a-f]{16}$/;

describe('placement identity through a layout <slot> (real astro dev bytes)', () => {
  beforeEach(() => {
    resetHarnessDom();
    (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = true;
  });
  afterEach(() => {
    (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = undefined;
  });

  /**
   * RULING 1 (as REVERSED 2026-08-04) — the layout's own chrome is a per-route
   * INSTANCE, because *"layout is a component"* (owner model). The earlier
   * "shared chrome" ruling rested on a false description of server mode; live
   * recordings show server holds layout chrome PER PAGE. Do not flip back.
   */
  it("the layout's OWN element keys DIFFER between / and /about", () => {
    const onIndex = keysFor(slotIndexHtml, 'src/layouts/Base.astro');
    resetHarnessDom();
    const onAbout = keysFor(slotAboutHtml, 'src/layouts/Base.astro');

    expect(onIndex.length).toBeGreaterThan(0);
    expect(onAbout.length).toBe(onIndex.length);
    for (const k of [...onIndex, ...onAbout]) expect(k).toMatch(PLACEMENT);
    // Not one key is shared between the two routes.
    expect(onIndex.filter((k) => onAbout.includes(k))).toEqual([]);
  });

  /**
   * RULING 2 — content the page places inside the slot stays per-page. The
   * layout roots the chain for its OWN subtree; slot children are authored in
   * the page and must not inherit that route-invariant root.
   */
  it('a component the PAGE places inside the slot keys DIFFERENTLY per route', () => {
    const onIndex = keysFor(slotIndexHtml, 'src/components/Card.astro');
    resetHarnessDom();
    const onAbout = keysFor(slotAboutHtml, 'src/components/Card.astro');

    expect(onIndex.length).toBeGreaterThan(0);
    expect(onAbout.length).toBeGreaterThan(0);
    for (const k of [...onIndex, ...onAbout]) expect(k).toMatch(PLACEMENT);
    // No key is shared between the two routes.
    expect(onIndex.filter((k) => onAbout.includes(k))).toEqual([]);
  });

  it('two invocations on ONE page inside the slot are distinct — no #N collapse', () => {
    const h3 = scanOf(slotIndexHtml).filter((e) => e.tagName === 'h3').map((e) => e.key);
    expect(h3).toHaveLength(2);
    expect(new Set(h3).size).toBe(2);
    for (const k of h3) expect(k).toMatch(/^src\/components\/Card\.astro:4:23~[pqs][0-9a-f]{16}$/);
    expect(h3.some((k) => k.includes('#'))).toBe(false);
  });

  /**
   * The 2026-08-04 regression's second cause: a component compiling to the
   * memoised `__template` form carried NO `data-sq-placement`, so both copies
   * on one page — and every copy on every page — shared one bare key.
   */
  it('a STATIC (__template) component in the slot is per-invocation and per-route', () => {
    const onIndex = scanOf(slotIndexHtml)
      .filter((e) => e.key.startsWith('src/components/Plain.astro:1:1'))
      .map((e) => e.key);
    resetHarnessDom();
    const onAbout = scanOf(slotAboutHtml)
      .filter((e) => e.key.startsWith('src/components/Plain.astro:1:1'))
      .map((e) => e.key);

    expect(onIndex).toHaveLength(2);
    expect(new Set(onIndex).size).toBe(2);
    for (const k of [...onIndex, ...onAbout]) expect(k).toMatch(PLACEMENT);
    expect(onIndex).not.toContain(onAbout[0]);
  });

  /** Unchanged from before the fix: a page's own element carries a bare key. */
  it("each page's own <h1> keeps a bare, unscoped key", () => {
    expect(scanOf(slotIndexHtml).find((e) => e.tagName === 'h1')!.key)
      .toBe('src/pages/index.astro:7:3');
    resetHarnessDom();
    expect(scanOf(slotAboutHtml).find((e) => e.tagName === 'h1')!.key)
      .toBe('src/pages/about.astro:7:3');
  });

  /** Unchanged from before the fix: no layout in the chain, still per-page. */
  it('a component the page places with NO layout keeps its own placement', () => {
    const bare = keysFor(slotNoLayoutHtml, 'src/components/Card.astro');
    expect(bare.length).toBeGreaterThan(0);
    for (const k of bare) expect(k).toMatch(PLACEMENT);

    resetHarnessDom();
    const inSlot = keysFor(slotIndexHtml, 'src/components/Card.astro');
    expect(bare.filter((k) => inSlot.includes(k))).toEqual([]);
  });

  /** The runtime sentinel must never survive into the DOM as text. */
  it('no __template sentinel leaks into the served HTML', () => {
    for (const html of [slotIndexHtml, slotAboutHtml, slotNoLayoutHtml]) {
      expect(html).not.toContain('sqp');
      expect(html).not.toContain('\u0000');
    }
  });
});
