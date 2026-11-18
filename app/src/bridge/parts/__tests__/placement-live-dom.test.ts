/**
 * task-149 — the bridge scan run against REAL tagger output.
 *
 * The fixtures in placement-keys.test.ts are hand-written attribute soup. These
 * two HTML files are the literal bytes served by a real `astro dev` 4.16.19
 * running the local-mode plugin (`{ placements: true }`) over a fixture project
 * with a shared layout (`src/layouts/Base.astro`), a `<Header/>` the LAYOUT
 * places, two `<Card/>` the PAGE places, and a `<Spread/>` whose root spreads
 * `{...Astro.props}`. Re-captured 2026-08-03 from 127.0.0.1:4701 AFTER the
 * shared-layout ruling.
 *
 * This is the end-to-end check that the emitted attribute and the key the
 * parent receives actually line up.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import liveIndexHtml from './fixtures/live-index.html?raw';
import liveAboutHtml from './fixtures/live-about.html?raw';

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

const keyOf = (page: string, tagName: string) => scanOf(page).find((e) => e.tagName === tagName)!.key;

describe('bridge scan over real astro dev output', () => {
  beforeEach(() => {
    resetHarnessDom();
    (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = true;
  });
  afterEach(() => {
    (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = undefined;
  });

  it('two <Card/> on ONE page produce two distinct h3 keys — no #N collapse', () => {
    const keys = scanOf(liveIndexHtml)
      .filter((e) => e.tagName === 'h3')
      .map((e) => e.key);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    for (const k of keys) expect(k).toMatch(/^src\/components\/Card\.astro:4:23~[pqs][0-9a-f]{16}$/);
    expect(keys.some((k) => k.includes('#'))).toBe(false);
  });

  it('a component the PAGE places keys differently on / and /about', () => {
    const onIndex = scanOf(liveIndexHtml)
      .filter((e) => e.tagName === 'h3')
      .map((e) => e.key);
    resetHarnessDom();
    const onAbout = keyOf(liveAboutHtml, 'h3');

    expect(onAbout).toMatch(/^src\/components\/Card\.astro:4:23~[pqs][0-9a-f]{16}$/);
    expect(onIndex).not.toContain(onAbout);
  });

  /**
   * OWNER MODEL 2026-08-04 — REVERSES the 2026-08-03 "layout chrome is SHARED"
   * ruling, which was made on a false description of server mode (live
   * recordings on identical fixtures show server holds layout chrome PER PAGE).
   *
   * *"Layout is a component"* — its placement on each page is an INSTANCE.
   * Editing the layout's footer on `/` overrides `/` only; to change every page
   * the user edits the master, or pushes (which updates every instance that is
   * not already carrying its own override). DO NOT flip this back.
   */
  it('the layout’s OWN elements key DIFFERENTLY on / and /about', () => {
    // `<main>` is the layout's own element that survives into document.body
    // (assigning innerHTML drops the fixture's <html>/<head>/<body> wrappers).
    const onIndex = keyOf(liveIndexHtml, 'main');
    resetHarnessDom();
    const onAbout = keyOf(liveAboutHtml, 'main');

    expect(onIndex).toMatch(/^src\/layouts\/Base\.astro:8:3~[pqs][0-9a-f]{16}$/);
    expect(onAbout).toMatch(/^src\/layouts\/Base\.astro:8:3~[pqs][0-9a-f]{16}$/);
    expect(onAbout).not.toBe(onIndex);
  });

  it('a component the LAYOUT places (<Header/>) keys DIFFERENTLY on / and /about', () => {
    const onIndex = keyOf(liveIndexHtml, 'h2');
    resetHarnessDom();
    const onAbout = keyOf(liveAboutHtml, 'h2');

    expect(onIndex).toMatch(/^src\/components\/Header\.astro:1:21~[pqs][0-9a-f]{16}$/);
    expect(onAbout).toMatch(/^src\/components\/Header\.astro:1:21~[pqs][0-9a-f]{16}$/);
    expect(onAbout).not.toBe(onIndex);
  });

  it("each page's own <h1> keeps a bare, unscoped key", () => {
    expect(keyOf(liveIndexHtml, 'h1')).toBe('src/pages/index.astro:7:3');
    resetHarnessDom();
    expect(keyOf(liveAboutHtml, 'h1')).toBe('src/pages/about.astro:6:3');
  });

  /**
   * BLAST RADIUS of injecting `data-sq-p` into the user's real `Astro.props`
   * (task-149 knownIssue): a component that spreads `{...Astro.props}` onto its
   * root renders the prop as a stray attribute. These are the real served bytes
   * — the claim is measured, not inferred.
   *
   * It is exactly ONE attribute, and it is not wrong: the bridge's placement
   * resolution reads `data-sq-p` as a fallback and gets the same value the
   * element's own `data-sq-placement` would have carried. The root is missing
   * `data-sq-source` for an unrelated, PRE-EXISTING reason — the tagger's tag
   * regex does not match `<div${$$spreadAttributes(...)}`, in WC/server too.
   *
   * task-159: the prop now carries the PAIR `"<q-id> <p-id>"` — still ONE
   * attribute, deliberately (the forwarding hazard scales with prop count, so
   * the second chain rides inside the first prop rather than beside it).
   */
  it('a {...Astro.props} root renders ONE stray data-sq-p, and it resolves correctly', () => {
    const strays = [...liveIndexHtml.matchAll(/data-sq-p="([^"]*)"/g)].map((m) => m[1]);
    expect(strays).toHaveLength(1);
    expect(strays[0]).toMatch(/^q[0-9a-f]{16} p[0-9a-f]{16}$/);
    const structural = strays[0].split(' ')[0];

    // Both the spread root and its child land on that one placement: the root
    // via the `data-sq-p` fallback (first token), the child via its own
    // `data-sq-placement`. The stray attribute therefore costs identity nothing.
    const spread = scanOf(liveIndexHtml).filter((e) => e.key.includes('Spread.astro'));
    expect(spread.map((e) => e.tagName)).toEqual(['div', 'span']);
    for (const el of spread) expect(el.key.endsWith(`~${structural}`)).toBe(true);
  });
});
