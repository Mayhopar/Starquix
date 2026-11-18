/**
 * A click on <body> / <html> selects the LAYOUT ROOT (2026-09-10). The layout's
 * <body> is a scanned element (scanning.ts bodyHead) and the Layers panel's
 * Layout row, yet body/html targets were dropped — by findEditableElement and,
 * decisively, by handleSimulateClick (every canvas click arrives as
 * SIMULATE_CLICK from ViewportFrame's passthrough overlay). One resolver now:
 * utils.ts layoutRootBody.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

const LAYOUT_BODY = 'src/layouts/Main.astro:20:2';

/** Tag an element the way the plugin + Astro dev do (source key + astro loc). */
function tagSource(el: Element, source: string) {
  el.setAttribute('data-sq-source', source);
  el.setAttribute('data-astro-source-file', '/p/' + source.split(':')[0]);
  el.setAttribute('data-astro-source-loc', source.split(':').slice(1).join(':'));
  return el;
}
function bodyFrom(source: string | null) {
  const bridge = mountBridgeForTest();
  if (source) tagSource(document.body, source);
  return bridge;
}
const sentClick = (bridge: ReturnType<typeof mountBridgeForTest>) =>
  (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).find((m) => m.type === 'ELEMENT_CLICK');

beforeEach(() => {
  resetHarnessDom();
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  for (const a of ['data-sq-source', 'data-astro-source-file', 'data-astro-source-loc', 'data-key']) document.body.removeAttribute(a);
});

describe('findEditableElement — body / html targets', () => {
  it('resolves body and html to the layout body', () => {
    const bridge = bodyFrom(LAYOUT_BODY);
    expect(bridge.findEditableElement(document.body, true, false)).toBe(document.body);
    expect(bridge.findEditableElement(document.documentElement, true, false)).toBe(document.body);
  });

  it('stays null for a page-file body or an untagged body', () => {
    expect(bodyFrom(null).findEditableElement(document.body, true, false)).toBeNull();
    expect(bodyFrom('src/pages/index.astro:5:1').findEditableElement(document.documentElement, true, false)).toBeNull();
  });
});

describe('SIMULATE_CLICK — body / html under the point', () => {
  it('sends ELEMENT_CLICK for the layout body', () => {
    const bridge = bodyFrom(LAYOUT_BODY);
    document.elementFromPoint = () => document.body;
    bridge.handleSimulateClick({ x: 5, y: 5 });
    expect(sentClick(bridge)?.payload.key).toBe(LAYOUT_BODY);
  });

  it('still selects nothing for a page-file body', () => {
    const bridge = bodyFrom('src/pages/index.astro:5:1');
    document.elementFromPoint = () => document.body;
    bridge.handleSimulateClick({ x: 5, y: 5 });
    expect(sentClick(bridge)).toBeUndefined();
  });
});

describe('outside → inside: the layout body is the outermost editable ancestor', () => {
  const nest = () => {
    document.body.innerHTML = '<main><p>x</p></main>';
    tagSource(document.querySelector('main')!, 'src/components/Main.astro:7:1');
    return tagSource(document.querySelector('p')!, 'src/components/Main.astro:9:3') as HTMLElement;
  };

  it('a first click anywhere on a laid-out page selects the layout body', () => {
    const bridge = bodyFrom(LAYOUT_BODY);
    expect(bridge.findEditableElement(nest(), true, false)).toBe(document.body);
  });

  it('inside the body context the click selects the body\'s child; ⌘-click stays innermost', () => {
    const bridge = bodyFrom(LAYOUT_BODY);
    const p = nest();
    bridge.contextKey = LAYOUT_BODY;
    expect(bridge.findEditableElement(p, true, false)).toBe(document.querySelector('main'));
    expect(bridge.findEditableElement(p, true, true)).toBe(p);
  });

  it('without a layout body the outermost tracked element is still the target', () => {
    const bridge = bodyFrom(null);
    expect(bridge.findEditableElement(nest(), true, false)).toBe(document.querySelector('main'));
  });
});
