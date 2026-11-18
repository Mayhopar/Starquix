/**
 * handleUpdateSourceMarkup — the iframe half of the inline-link markup
 * overlay (link wrap/unwrap on a source-tracked element). The parent's scan
 * re-apply posts UPDATE_SOURCE_MARKUP after every preview reload; the handler
 * must restore the stored innerHTML idempotently and re-sanitize on entry.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type MarkupBridge = HarnessBridge & {
  handleUpdateSourceMarkup: (payload: { key?: string; markup?: unknown }) => void;
  registerHandlers: () => void;
  _handlers: Record<string, (p: unknown) => void>;
};

const KEY = 'src/components/Hero.astro:5:1';

function mountWithElement(): { bridge: MarkupBridge; el: HTMLElement } {
  resetHarnessDom();
  const bridge = mountBridgeForTest() as MarkupBridge;
  const el = document.createElement('p');
  el.setAttribute('data-sq-source', KEY);
  el.textContent = 'Visit our team today';
  document.body.appendChild(el);
  return { bridge, el };
}

describe('handleUpdateSourceMarkup', () => {
  let bridge: MarkupBridge;
  let el: HTMLElement;

  beforeEach(() => {
    ({ bridge, el } = mountWithElement());
  });

  it('is registered in the _handlers map as UPDATE_SOURCE_MARKUP', () => {
    bridge._handlers = {};
    bridge.registerHandlers();
    expect(typeof bridge._handlers['UPDATE_SOURCE_MARKUP']).toBe('function');
  });

  it('restores the stored innerHTML onto the element (link wrap survives reload)', () => {
    bridge.handleUpdateSourceMarkup({
      key: KEY,
      markup: 'Visit <a href="/about">our team</a> today',
    });
    const a = el.querySelector('a');
    expect(a?.getAttribute('href')).toBe('/about');
    expect(el.textContent).toBe('Visit our team today');
  });

  it('is idempotent — an unchanged markup leaves the DOM node graph alone', () => {
    const markup = 'Visit <a href="/about">our team</a> today';
    bridge.handleUpdateSourceMarkup({ key: KEY, markup });
    const firstAnchor = el.querySelector('a');
    bridge.handleUpdateSourceMarkup({ key: KEY, markup });
    // Same node instance = no innerHTML churn on repeated scans
    expect(el.querySelector('a')).toBe(firstAnchor);
  });

  it('re-sanitizes on entry (event handlers and javascript: URLs stripped)', () => {
    bridge.handleUpdateSourceMarkup({
      key: KEY,
      markup: 'x <a href="javascript:alert(1)" onclick="alert(2)">bad</a>',
    });
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBeNull();
    expect(a.getAttribute('onclick')).toBeNull();
  });

  it('ignores missing elements and malformed payloads', () => {
    expect(() => {
      bridge.handleUpdateSourceMarkup({ key: 'src/nowhere.astro:1:1', markup: 'x' });
      bridge.handleUpdateSourceMarkup({ key: KEY, markup: 42 });
      bridge.handleUpdateSourceMarkup({});
    }).not.toThrow();
    expect(el.textContent).toBe('Visit our team today');
  });
});
