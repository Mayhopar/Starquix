/**
 * task-149 STEP 4 — placement-scoped element keys (local mode only).
 *
 * The tagger now emits `data-sq-placement` next to `data-sq-source` when it is
 * armed with `{ placements: true }` (local mode). The bridge composes the two
 * into the key it reports to the parent:
 *
 *   src/components/Card.astro:4:1~p4317f4b4863ead18
 *
 * Composition happens INSIDE `resolveSourceKey`, i.e. BEFORE `scanElements`
 * runs its `sourceKeyCounts` collision counter — so the positional `#N` suffix
 * scopes per placement for free instead of being the only disambiguator.
 *
 * The whole path is gated on `window.__SQ_LOCAL_MODE__` (set by
 * `sq-source-plugin.js`'s local-mode HTML injection), so WC/server keys are
 * byte-identical by construction, not by "no element happens to carry the
 * attribute".
 *
 * The placement values below are the REAL hashes observed on a live
 * `astro dev` (4.16.19) instance serving the fixture project — two `<Card/>`
 * on `/`, `<Header/>` under a shared layout on `/` and `/about`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = { key: string; sourceKey?: string; hasSourceTracking: boolean; tagName: string };

function runScan(bridge: HarnessBridge): ScannedEl[] {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

const setLocalMode = (on: boolean) => {
  (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = on || undefined;
};

const CARD_A = 'p4317f4b4863ead18';
const CARD_B = 'pfcdbacdb0850b321';

describe('placement-scoped keys (local mode)', () => {
  beforeEach(() => {
    resetHarnessDom();
    setLocalMode(true);
  });
  afterEach(() => setLocalMode(false));

  it('two placements of ONE component on ONE page scan to two DISTINCT keys', () => {
    // Identical data-sq-source on both subtrees — today's only disambiguator is
    // the positional `#N` counter, which collapses them onto one override.
    document.body.innerHTML =
      `<section data-sq-source="src/components/Card.astro:4:1" data-sq-placement="${CARD_A}">` +
      `<h3 data-sq-source="src/components/Card.astro:4:23" data-sq-placement="${CARD_A}">one</h3>` +
      '</section>' +
      `<section data-sq-source="src/components/Card.astro:4:1" data-sq-placement="${CARD_B}">` +
      `<h3 data-sq-source="src/components/Card.astro:4:23" data-sq-placement="${CARD_B}">two</h3>` +
      '</section>';

    const elements = runScan(mountBridgeForTest());
    const headings = elements.filter((e) => e.tagName === 'h3').map((e) => e.key);

    expect(headings).toEqual([
      `src/components/Card.astro:4:23~${CARD_A}`,
      `src/components/Card.astro:4:23~${CARD_B}`,
    ]);
    // Specifically NOT the positional collapse this replaces.
    expect(headings[1]).not.toBe('src/components/Card.astro:4:23#1');
  });

  it('the same component on two pages gets two different placements', () => {
    // `/` render
    document.body.innerHTML =
      '<h2 data-sq-source="src/components/Header.astro:1:21" data-sq-placement="p5e23e503da89f633">Brand</h2>';
    const onIndex = runScan(mountBridgeForTest())[0].key;

    resetHarnessDom();
    // `/about` render — same defining file:line:col, different invocation site
    document.body.innerHTML =
      '<h2 data-sq-source="src/components/Header.astro:1:21" data-sq-placement="pf22d94ecd78c8702">Brand</h2>';
    const onAbout = runScan(mountBridgeForTest())[0].key;

    expect(onIndex).toBe('src/components/Header.astro:1:21~p5e23e503da89f633');
    expect(onAbout).toBe('src/components/Header.astro:1:21~pf22d94ecd78c8702');
    expect(onIndex).not.toBe(onAbout);
  });

  it('a page file\'s own elements keep a bare key (empty placement)', () => {
    // The tagger stamps data-sq-placement="" uniformly, INCLUDING page files.
    // The empty value is load-bearing: it terminates the closest() walk so a
    // page-own element never inherits the surrounding layout's placement.
    document.body.innerHTML =
      '<main data-sq-source="src/layouts/Base.astro:8:3" data-sq-placement="pf760ecb4ad071760">' +
      '<h1 data-sq-source="src/pages/index.astro:6:3" data-sq-placement="">Home</h1>' +
      '</main>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.tagName === 'h1')!.key).toBe('src/pages/index.astro:6:3');
    expect(elements.find((e) => e.tagName === 'main')!.key).toBe(
      'src/layouts/Base.astro:8:3~pf760ecb4ad071760',
    );
  });

  it('an untagged descendant inherits its ancestor placement via closest()', () => {
    document.body.innerHTML =
      `<section data-sq-source="src/components/Card.astro:4:1" data-sq-placement="${CARD_A}">` +
      '<div>' + // no attributes at all — e.g. emitted by a __template module
      '<h3 data-sq-source="src/components/Card.astro:4:23">one</h3>' +
      '</div></section>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.tagName === 'h3')!.key).toBe(
      `src/components/Card.astro:4:23~${CARD_A}`,
    );
  });

  it('#N still disambiguates repeats WITHIN one placement (a .map() loop)', () => {
    // One authored `<Card/>` invocation inside .map() ⇒ one placement for all
    // three renders; the positional counter separates them, as designed.
    document.body.innerHTML = [0, 1, 2]
      .map(
        () =>
          `<li data-sq-source="src/pages/loop.astro:6:22" data-sq-placement="${CARD_A}">x</li>`,
      )
      .join('');

    const elements = runScan(mountBridgeForTest());
    expect(elements.map((e) => e.key)).toEqual([
      `src/pages/loop.astro:6:22~${CARD_A}`,
      `src/pages/loop.astro:6:22~${CARD_A}#1`,
      `src/pages/loop.astro:6:22~${CARD_A}#2`,
    ]);
  });

  it('composes into the data-astro-source-file fallback too', () => {
    const el = document.createElement('h2');
    el.setAttribute(
      'data-astro-source-file',
      '/proj/src/components/Header.astro',
    );
    el.setAttribute('data-astro-source-loc', '1:21');
    el.setAttribute('data-sq-placement', 'p5e23e503da89f633');
    document.body.appendChild(el);

    const bridge = mountBridgeForTest();
    expect(bridge.getElementKey(el)).toBe(
      'src/components/Header.astro:1:21~p5e23e503da89f633',
    );
  });

  it('re-stamps a STALE placement-scoped data-key, but never a placement-less one', () => {
    // A node persisted across a View Transition / HMR partial patch can keep a
    // key from a different placement. Only keys that already carry a ~p…
    // segment may be overwritten — anything else is addKeysToMarkup /
    // _ensureBlogCardKeys / stream-preview territory.
    document.body.innerHTML =
      `<section data-sq-source="src/components/Card.astro:4:1" data-sq-placement="${CARD_A}"` +
      ` data-key="src/components/Card.astro:4:1~${CARD_B}">stale</section>` +
      '<div data-sq-source="src/components/Card.astro:9:1" data-key="el-abc123:div-0">instance child</div>';

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.tagName === 'section')!.key).toBe(
      `src/components/Card.astro:4:1~${CARD_A}`,
    );
    expect(elements.find((e) => e.tagName === 'div')!.key).toBe('el-abc123:div-0');
  });
});

describe('placement composition is OFF outside local mode', () => {
  beforeEach(() => {
    resetHarnessDom();
    setLocalMode(false);
  });

  it('produces byte-identical keys to today, including the #N counter', () => {
    document.body.innerHTML =
      `<section data-sq-source="src/components/Card.astro:4:1" data-sq-placement="${CARD_A}">a</section>` +
      `<section data-sq-source="src/components/Card.astro:4:1" data-sq-placement="${CARD_B}">b</section>`;

    const elements = runScan(mountBridgeForTest());
    expect(elements.map((e) => e.key)).toEqual([
      'src/components/Card.astro:4:1',
      'src/components/Card.astro:4:1#1',
    ]);
    expect(elements.map((e) => e.sourceKey)).toEqual([
      'src/components/Card.astro:4:1',
      'src/components/Card.astro:4:1',
    ]);
  });
});
