/**
 * ELEMENTS_SCANNED reports `imageSrc` for <img> elements — the VALUE, not the
 * old `hasSrc` boolean. It drives the canvas empty-image receiver frame
 * (`imageSrc === ''`) AND local mode's ↻ `now` half, which needs to know what
 * the file renders for the img, not merely that it renders something
 * (task-186 FIX-2). The mutation observer rescans when an <img>'s src
 * attribute changes — otherwise the frame would never clear after an upload
 * (attribute mutations were previously ignored entirely).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = { key: string; tagName: string; imageSrc?: string; linkKey?: string; linkBlocked?: boolean; linkHref?: string; linkTarget?: string; linkAriaLabel?: string };

function runScan(bridge: HarnessBridge): ScannedEl[] {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { _assetMap: Record<string, string> })._assetMap = {};
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: ScannedEl[] } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

describe('scan reports imageSrc for <img> elements', () => {
  beforeEach(() => resetHarnessDom());

  it('the src VALUE for a loaded img, "" for an empty one, undefined for non-img', () => {
    document.body.innerHTML =
      '<img data-sq-source="Page.astro:1:1" data-key="Page.astro:1:1" src="/photo.png" />' +
      '<img data-sq-source="Page.astro:2:1" data-key="Page.astro:2:1" />' +
      '<div data-sq-source="Page.astro:3:1" data-key="Page.astro:3:1">x</div>';

    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);

    expect(elements.find((e) => e.key === 'Page.astro:1:1')!.imageSrc).toBe('/photo.png');
    expect(elements.find((e) => e.key === 'Page.astro:2:1')!.imageSrc).toBe('');
    expect(elements.find((e) => e.key === 'Page.astro:3:1')!.imageSrc).toBeUndefined();
  });

  /** Same 200-char cap the scan already applies to textContent: a data: URI
   *  src would otherwise put ~100KB per img on every scan's postMessage. */
  it('caps the reported src at 200 chars', () => {
    const long = '/img/' + 'a'.repeat(400) + '.png';
    document.body.innerHTML =
      `<img data-sq-source="Page.astro:1:1" data-key="Page.astro:1:1" src="${long}" />`;

    const elements = runScan(mountBridgeForTest());
    expect(elements.find((e) => e.key === 'Page.astro:1:1')!.imageSrc).toBe(long.slice(0, 200));
  });
});

/** An <a>'s href / target / aria-label ride the scan AND the click payload
 *  (one helper), so a Layers / Shift+Enter selection shows the link a canvas
 *  click does — a card's <a> is reachable only by drilling (owner 2026-10-17). */
describe('scan reports link attributes for <a> elements', () => {
  beforeEach(() => resetHarnessDom());

  const scanOf = (html: string) => {
    document.body.innerHTML = html;
    return runScan(mountBridgeForTest());
  };

  it('an element reports the link it is, or sits inside', () => {
    const elements = scanOf(
      '<a data-sq-source="Card.astro:1:1" data-key="Card.astro:1:1" href="/works/inito" target="_blank" aria-label="Read more">' +
        '<h3 data-sq-source="Card.astro:2:1">x</h3></a>',
    );
    const link = { linkKey: 'Card.astro:1:1', linkHref: '/works/inito', linkTarget: '_blank', linkAriaLabel: 'Read more' };
    expect(elements.find((e) => e.key === 'Card.astro:1:1')).toMatchObject(link);
    expect(elements.find((e) => e.key === 'Card.astro:2:1')).toMatchObject(link);
  });

  it('a container does not report a link it merely holds: an <a> cannot go around it either', () => {
    const elements = scanOf(
      '<main data-sq-source="P.astro:1:1"><div data-sq-source="P.astro:2:1"><a data-sq-source="P.astro:3:1" href="/x">x</a></div>' +
        '<p data-sq-source="P.astro:4:1">free</p></main>',
    );
    for (const key of ['P.astro:1:1', 'P.astro:2:1']) {
      const row = elements.find((e) => e.key === key)!;
      expect('linkHref' in row).toBe(false);
      expect(row).toMatchObject({ linkBlocked: true });
    }
    const free = elements.find((e) => e.key === 'P.astro:4:1')!;
    expect('linkHref' in free).toBe(false);
    expect('linkBlocked' in free).toBe(false);
  });

  it('form controls and table parts cannot take a link', () => {
    const elements = scanOf(
      '<div data-sq-source="F.astro:1:1"><button data-sq-source="F.astro:2:1">b</button></div>' +
        '<table><tbody><tr><td data-sq-source="F.astro:3:1">c</td></tr></tbody></table>',
    );
    for (const key of ['F.astro:1:1', 'F.astro:2:1', 'F.astro:3:1']) {
      expect(elements.find((e) => e.key === key)).toMatchObject({ linkBlocked: true });
    }
  });

  it("a bound card's wrapper shows its link, with no key to write to: the binding owns it", () => {
    const elements = scanOf(
      '<a href="/blog/x" data-sq-post-slug="x"><h3 data-sq-source="Card.astro:2:1">x</h3></a>',
    );
    const row = elements.find((e) => e.key === 'Card.astro:2:1')!;
    expect(row).toMatchObject({ linkHref: '/blog/x' });
    expect(row.linkKey).toBeUndefined();
  });
});

describe('mutation observer rescans on img src changes', () => {
  beforeEach(() => resetHarnessDom());

  it('setting src on an <img> triggers a rescan (real timers: debounce + min interval)', async () => {
    document.body.innerHTML =
      '<img data-sq-source="Page.astro:1:1" data-key="Page.astro:1:1" />';

    const bridge = mountBridgeForTest() as unknown as HarnessBridge & {
      scanElements: () => void;
      startMutationObserver: () => void;
      mutationObserverStarted: boolean;
      _rescanCount: number;
      _assetMap: Record<string, string>;
    };
    delete (bridge as unknown as { scanElements?: unknown }).scanElements;
    bridge._assetMap = {};
    const scanSpy = vi.fn();
    (bridge as unknown as { scanElements: () => void }).scanElements = scanSpy;
    bridge.startMutationObserver();

    // The debounce throttle compares against the observer's start time, not
    // the last real scan — a mutation within MIN_SCAN_INTERVAL (500ms) of
    // starting is silently dropped (no retry). Clear that window first.
    await new Promise((resolve) => setTimeout(resolve, 550));

    const img = document.querySelector('img')!;
    img.setAttribute('src', '/uploaded.png');

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(scanSpy).toHaveBeenCalled();
  });
});
