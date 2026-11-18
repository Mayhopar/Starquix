import { beforeEach, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';
import type { ScannedElement } from '@/context/SelectionContext';

beforeEach(() => resetHarnessDom());
const fixture = `<main data-key="main">
<article data-key="card-one"><a href="/works/first"><h2 data-key="title-one">First</h2></a></article>
<article data-key="card-two"><a href="/works/timepad-redesign"><h2 data-key="title-two">Second</h2></a><a href="/works/timepad-redesign?from=home#detail">Again</a><a href="https://external.example/works/wrong">Website</a></article>
</main>`;
function bridgeWithFixture() {
  document.body.innerHTML = fixture;
  const bridge = mountBridgeForTest();
  bridge._assetMap = {};
  // Viewport resizing is outside this identity-only scan test.
  (bridge as unknown as { reportContentHeight: () => void }).reportContentHeight = () => {};
  return bridge as ReturnType<typeof mountBridgeForTest> & {
    buildElementPayload(el: Element, options?: object, ctx?: object): ScannedElement;
  };
}
it('captures the actual second imported article and nested selection, deduping local links and excluding external links', () => {
  const bridge = bridgeWithFixture();
  for (const key of ['card-two', 'title-two']) {
    const payload = bridge.buildElementPayload(document.querySelector(`[data-key="${key}"]`)!, { computedStyles: false });
    expect(payload.postLinkPaths).toEqual(['/works/timepad-redesign']);
    expect(payload.postSlug).toBeUndefined();
  }
  expect(bridge.buildElementPayload(document.querySelector('[data-key="main"]')!, { computedStyles: false }).postLinkPaths).toEqual([]);
});
it('scans actual card identities for Layers and refreshes them when only href changes', () => {
  const bridge = bridgeWithFixture();
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  const scan = () => {
    vi.mocked(bridge.sendToParent).mockClear(); bridge.scanElements();
    return vi.mocked(bridge.sendToParent).mock.calls.map(([m]) => m as { type: string; payload: { elements: ScannedElement[] } }).find(m => m.type === 'ELEMENTS_SCANNED')!.payload.elements;
  };
  expect(scan().find(e => e.key === 'title-two')?.postLinkPaths).toEqual(['/works/timepad-redesign']);
  for (const link of document.querySelectorAll('[data-key="card-two"] a')) link.setAttribute('href', '/works/updated');
  expect(scan().find(e => e.key === 'card-two')?.postLinkPaths).toEqual(['/works/updated']);
});
// A bound page wraps each card in <a href data-sq-post-slug> — transparent
// chrome outside the card's <article>: that wrapper IS the card's link.
it('a bound card\'s link is its <a data-sq-post-slug> wrapper, for the card and its children', () => {
  const bridge = bridgeWithFixture();
  document.body.innerHTML = '<a href="/blog/first" data-sq-post-slug="first"><article data-key="card"><h3 data-key="title">First</h3></article></a>';
  for (const key of ['card', 'title']) {
    expect(bridge.buildElementPayload(document.querySelector(`[data-key="${key}"]`)!, { computedStyles: false }).postLinkPaths).toEqual(['/blog/first']);
  }
});
it('does not borrow links from a nested article', () => {
  const bridge = bridgeWithFixture();
  document.body.innerHTML = '<article data-key="outer"><a href="/about">About</a><article><a href="/works/first">Nested</a></article></article>';
  expect(bridge.buildElementPayload(document.querySelector('[data-key="outer"]')!, { computedStyles: false }).postLinkPaths).toEqual(['/about']);
});

it('captures the clicked legacy clone rather than the first keyed template', () => {
  const bridge = bridgeWithFixture();
  const first = document.querySelector('[data-key="title-one"]')!;
  const clickedCard = document.querySelector('[data-key="card-two"]')!;
  const payload = bridge.buildElementPayload(first, { computedStyles: false }, { clickedCardWrapper: clickedCard, rawTarget: clickedCard.querySelector('h2') });
  expect(payload.key).toBe('title-one');
  expect(payload.postLinkPaths).toEqual(['/works/timepad-redesign']);
});
it('rejects links resolved through a different-origin base element', () => {
  const bridge = bridgeWithFixture();
  const base = document.createElement('base'); base.href = 'https://external.example/'; document.head.appendChild(base);
  try { expect(bridge.buildElementPayload(document.querySelector('[data-key="card-two"]')!, { computedStyles: false }).postLinkPaths).toEqual([]); }
  finally { base.remove(); }
});
it('href-only DOM mutation refreshes the card metadata through the real observer', async () => {
  vi.useFakeTimers();
  const bridge = bridgeWithFixture() as ReturnType<typeof bridgeWithFixture> & { mutationObserver?: MutationObserver };
  try {
    delete (bridge as unknown as { scanElements?: unknown }).scanElements;
    bridge.scanElements();
    vi.mocked(bridge.sendToParent).mockClear();
    for (const link of document.querySelectorAll('[data-key="card-two"] a')) link.setAttribute('href', '/works/updated');
    await Promise.resolve(); await vi.advanceTimersByTimeAsync(750);
    const scans = vi.mocked(bridge.sendToParent).mock.calls.map(([m]) => m as { type: string; payload: { elements: ScannedElement[] } }).filter(m => m.type === 'ELEMENTS_SCANNED');
    expect(scans.at(-1)?.payload.elements.find(e => e.key === 'card-two')?.postLinkPaths).toEqual(['/works/updated']);
  } finally { bridge.mutationObserver?.disconnect(); vi.useRealTimers(); }
});
