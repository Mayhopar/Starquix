/**
 * task-159/160 (TRANSITIONAL) — the bridge reports every SUPERSEDED placement
 * key beside the current one.
 *
 * Identity moved twice. First from a coordinate chain (`~p…`, over
 * `<file>:<line>:<col>`) to an ordinal one (`~q…`, over
 * `<file>|<specifier>#<ordinal>`), because a coordinate slides when a line is
 * inserted above it and the override slides with it — onto the neighbour. Then
 * from the ordinal to a STAMPED id (`~s…`, over `#<data-sq-id>` read out of the
 * user's own source), because the ordinal still slides when a same-name sibling
 * above it is added, deleted or reordered. Both reproduced on real `astro dev`
 * bytes.
 *
 * A user with outstanding work can have `~p…` OR `~q…` keys stored, so the
 * tagger emits ALL THREE chains for the migration window and the bridge
 * composes `legacyKeys`, MOST RECENT FIRST. The parent uses the list once, in
 * `store/placementKeyMigration.ts`, taking the first tier that has a value —
 * so p→s and q→s each migrate in ONE hop.
 *
 * A LIST rather than a redefined single field, and this is load-bearing: under
 * eager stamping the stamp lands BEFORE the first scan ever runs, so there is
 * no scan at which a `p…` key could have become a `q…` key. Collapsing field 1
 * to "the previous address" strands every pre-task-159 key.
 *
 * Resolution mirrors `resolvePlacement` EXACTLY, including the rule that an
 * empty value is a real answer (a page file's own elements terminate the walk),
 * and the `__SQ_LOCAL_MODE__` gate that keeps WC/server byte-identical.
 *
 * The `q…`/`p…` hashes below are the REAL values captured from a live
 * `astro dev` 4.16.19 rig (a layout placing `<SiteNav/>` twice) — see the
 * round-12 ledger table.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = { key: string; legacyKeys?: string[]; tagName: string };

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

const NAV = 'src/components/SiteNav.astro:4:1';
const S_TOP = 's1111111111111111';
const S_BOTTOM = 's2222222222222222';
const Q_TOP = 'qa7d57c53ae161ed3';
const P_TOP = 'pe6f8cae40c888072';
const Q_BOTTOM = 'q82b9ebf2d763c510';
const P_BOTTOM = 'p93bc2faa3a8ad14c';

describe('legacy placement keys (task-159/160 migration channel)', () => {
  beforeEach(() => {
    resetHarnessDom();
    setLocalMode(true);
  });
  afterEach(() => setLocalMode(false));

  it('reports key and BOTH legacy keys, most recent first, for each placement', () => {
    document.body.innerHTML =
      `<nav data-sq-source="${NAV}" data-sq-placement="${S_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}"></nav>` +
      `<nav data-sq-source="${NAV}" data-sq-placement="${S_BOTTOM}" data-sq-lq="${Q_BOTTOM}" data-sq-lp="${P_BOTTOM}"></nav>`;
    const els = runScan(mountBridgeForTest()).filter((e) => e.tagName === 'nav');
    expect(els.map((e) => e.key)).toEqual([`${NAV}~${S_TOP}`, `${NAV}~${S_BOTTOM}`]);
    expect(els[0].legacyKeys).toEqual([`${NAV}~${Q_TOP}`, `${NAV}~${P_TOP}`]);
    expect(els[1].legacyKeys).toEqual([`${NAV}~${Q_BOTTOM}`, `${NAV}~${P_BOTTOM}`]);
  });

  it('inherits every chain from the nearest carrying ancestor', () => {
    document.body.innerHTML =
      `<nav data-sq-source="${NAV}" data-sq-placement="${S_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}">` +
      '<h3 data-sq-source="src/components/SiteNav.astro:5:3">t</h3>' +
      '</nav>';
    const h3 = runScan(mountBridgeForTest()).find((e) => e.tagName === 'h3')!;
    expect(h3.key).toBe(`src/components/SiteNav.astro:5:3~${S_TOP}`);
    expect(h3.legacyKeys).toEqual([
      `src/components/SiteNav.astro:5:3~${Q_TOP}`,
      `src/components/SiteNav.astro:5:3~${P_TOP}`,
    ]);
  });

  it('reads the TRIPLE out of a forwarded data-sq-p, s then q then p', () => {
    // A component root that spreads {...Astro.props} carries the prop itself.
    document.body.innerHTML =
      `<div data-sq-source="${NAV}" data-sq-p="${S_TOP} ${Q_TOP} ${P_TOP}"></div>`;
    const el = runScan(mountBridgeForTest()).find((e) => e.tagName === 'div')!;
    expect(el.key).toBe(`${NAV}~${S_TOP}`);
    expect(el.legacyKeys).toEqual([`${NAV}~${Q_TOP}`, `${NAV}~${P_TOP}`]);
  });

  it('a page file’s own element stays bare on EVERY chain (empty is an answer)', () => {
    document.body.innerHTML =
      '<h1 data-sq-source="src/pages/index.astro:6:3" data-sq-placement="" data-sq-lq="" data-sq-lp="">x</h1>';
    const el = runScan(mountBridgeForTest()).find((e) => e.tagName === 'h1')!;
    expect(el.key).toBe('src/pages/index.astro:6:3');
    expect(el.legacyKeys).toBeUndefined();
  });

  it('the #N repeat suffix is the SAME index on every chain', () => {
    document.body.innerHTML =
      `<nav data-sq-source="${NAV}" data-sq-placement="${S_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}"></nav>` +
      `<nav data-sq-source="${NAV}" data-sq-placement="${S_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}"></nav>`;
    const els = runScan(mountBridgeForTest()).filter((e) => e.tagName === 'nav');
    expect(els[1].key).toBe(`${NAV}~${S_TOP}#1`);
    expect(els[1].legacyKeys).toEqual([`${NAV}~${Q_TOP}#1`, `${NAV}~${P_TOP}#1`]);
  });

  it('emits NO legacyKeys outside local mode (WC / server byte-identical)', () => {
    setLocalMode(false);
    document.body.innerHTML =
      `<nav data-sq-source="${NAV}" data-sq-placement="${S_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}"></nav>`;
    const el = runScan(mountBridgeForTest()).find((e) => e.tagName === 'nav')!;
    expect(el.key).toBe(NAV);
    expect(el.legacyKeys).toBeUndefined();
  });

  it('drops a chain that AGREES with the current key (nothing to migrate)', () => {
    // The unstamped case: the tagger's `s` chain falls back to the ordinal, so
    // fields 0 and 1 carry the same value and only `p` is a real move.
    document.body.innerHTML =
      `<nav data-sq-source="${NAV}" data-sq-placement="${Q_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}"></nav>`;
    const el = runScan(mountBridgeForTest()).find((e) => e.tagName === 'nav')!;
    expect(el.legacyKeys).toEqual([`${NAV}~${P_TOP}`]);
  });

  it('emits NO legacyKeys when every chain agrees', () => {
    document.body.innerHTML =
      `<nav data-sq-source="${NAV}" data-sq-placement="${Q_TOP}" data-sq-lq="${Q_TOP}" data-sq-lp="${Q_TOP}"></nav>`;
    const el = runScan(mountBridgeForTest()).find((e) => e.tagName === 'nav')!;
    expect(el.legacyKeys).toBeUndefined();
  });

  it('a STAMPED key survives the View-Transition data-key re-stamp branch', () => {
    // `PLACEMENT_KEY_PATTERN` decides whether a persisted `data-key` may be
    // overwritten. Miss the `s` prefix there and a stamped key is treated as a
    // hand-authored key and frozen at its stale value.
    document.body.innerHTML =
      `<nav data-key="${NAV}~${S_BOTTOM}" data-sq-source="${NAV}" data-sq-placement="${S_TOP}" ` +
      `data-sq-lq="${Q_TOP}" data-sq-lp="${P_TOP}"></nav>`;
    const el = runScan(mountBridgeForTest()).find((e) => e.tagName === 'nav')!;
    expect(el.key).toBe(`${NAV}~${S_TOP}`);
    // …and because the re-stamp fired, the legacy chains still describe THIS
    // element, so the migration is not handed a mismatched move.
    expect(el.legacyKeys).toEqual([`${NAV}~${Q_TOP}`, `${NAV}~${P_TOP}`]);
  });
});
