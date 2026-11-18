/**
 * Scan exclusion of AI/editor overlay infrastructure (2026-07-23).
 *
 * Live-caught root cause of the "2 stray div rows on every AI run, every
 * model": the scanner stamped OUR OWN keyless overlay divs (orbit-stroke
 * overlays [data-sq-ai-active], stream preview [data-sq-ai-preview]) with
 * dynamic: keys and reported them as parentKey-null roots. ≥1 stray root
 * breaks the Layers wrapper auto-unwrap, so real sections nest under a junk
 * "div" row. Overlay DOM must be invisible to the scan.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type ScannedEl = { key: string; parentKey: string | null; tagName: string };

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

const rectStub = () =>
  ({ top: 10, left: 10, width: 100, height: 50, right: 110, bottom: 60, x: 10, y: 10, toJSON: () => ({}) }) as DOMRect;

describe('scan ignores AI/editor overlay DOM', () => {
  beforeEach(() => resetHarnessDom());

  it('the stream preview container never becomes a scanned element', () => {
    document.body.innerHTML =
      '<div id="sq-components" data-sq-source="src/pages/preview/[pageId].astro:18:29">' +
      '<section data-key="a:section-0"><p data-key="a:p-1">hi</p></section>' +
      '</div>';
    const bridge = mountBridgeForTest();
    // Create a REAL stream preview container. (Section rings live in the
    // parent canvas since 2026-07-25 — no in-iframe overlay to skip.)
    const sec = document.querySelector('[data-key="a:section-0"]') as HTMLElement;
    sec.getBoundingClientRect = rectStub;
    (bridge as unknown as { handleSetAIActiveHighlights: (p: unknown) => void })
      .handleSetAIActiveHighlights({ keys: ['a:section-0'], runActive: true });
    (bridge as unknown as { handleStreamPreview: (p: unknown) => void })
      .handleStreamPreview({ mode: 'section', partial: '<div>streaming</div>' });

    const elements = runScan(bridge);
    const keys = elements.map(e => e.key);
    expect(keys.some(k => k.startsWith('dynamic:'))).toBe(false); // no stamped overlay divs
    expect(elements.filter(e => e.parentKey === null)).toHaveLength(1); // wrapper only
    // Preview DOM gained no data-key either
    expect(document.querySelector('[data-sq-ai-preview]')!.hasAttribute('data-key')).toBe(false);
  });

  // ponytail (2026-07-23): scope over allowlist. When the #sq-components
  // wrapper exists, the scan universe IS its subtree — ANY body-level DOM
  // (future overlays, astro dev toolbar, third-party junk) is categorically
  // not page content, no attribute list to maintain. Body-wide fallback stays
  // for wrapper-less surfaces (harness tests, legacy pages).
  it('body-level junk WITHOUT infra attributes is also invisible to the scan', () => {
    document.body.innerHTML =
      '<div id="sq-components" data-sq-source="src/pages/preview/[pageId].astro:18:29">' +
      '<section data-key="a:section-0"><p data-key="a:p-1">hi</p></section>' +
      '</div>' +
      '<div class="future-overlay-no-attrs"><span>junk</span></div>';
    const bridge = mountBridgeForTest();
    const elements = runScan(bridge);
    expect(elements.some(e => e.key.startsWith('dynamic:'))).toBe(false);
    expect(elements.filter(e => e.parentKey === null)).toHaveLength(1); // wrapper only
    expect(document.querySelector('.future-overlay-no-attrs')!.hasAttribute('data-key')).toBe(false);
    // Real content still scanned
    expect(elements.some(e => e.key === 'a:section-0')).toBe(true);
  });
});
