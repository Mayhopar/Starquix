/**
 * SIMULATE_HOVER regression (the bridge-parity drift bug, 2026-06-10).
 *
 * ViewportFrame sends SIMULATE_HOVER from 3 call sites, but the handler
 * existed only in the TS parts while dev ran bridge.js — which silently
 * dropped the message. Now that bridge.js is generated from the parts,
 * this pins (1) the registration in the assembled script and (2) the
 * handler behavior, so the fix can't regress on either level.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IFRAME_BRIDGE_SCRIPT } from '../../IFrameBridgeScript.ts';
import { BRIDGE_HEAD_CONSTANTS } from '../head';
import { BRIDGE_UTILS } from '../utils';
import { BRIDGE_SCREENSHOTS } from '../screenshots';

type HoverBridge = {
  lastHoveredKey: string | null;
  sendToParent: ReturnType<typeof vi.fn>;
  handleSimulateHover: (payload: { x: number; y: number } | null) => void;
  _clearHover: () => void;
};

function mountHoverBridge(): HoverBridge {
  function IFrameBridge(this: HoverBridge) {
    this.lastHoveredKey = null;
    this.sendToParent = vi.fn();
  }
  const src = `${BRIDGE_HEAD_CONSTANTS}\n${BRIDGE_UTILS}\n${BRIDGE_SCREENSHOTS}`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('IFrameBridge', src)(IFrameBridge);
  return new (IFrameBridge as unknown as { new (): HoverBridge })();
}

describe('SIMULATE_HOVER', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('the assembled script registers the SIMULATE_HOVER handler', () => {
    expect(IFRAME_BRIDGE_SCRIPT).toMatch(/_handlers\[\s*'SIMULATE_HOVER'\s*\]/);
    expect(IFRAME_BRIDGE_SCRIPT).toContain('IFrameBridge.prototype.handleSimulateHover');
  });

  it('handleSimulateHover reports ELEMENT_HOVER for the element at point', () => {
    document.body.innerHTML =
      '<section data-key="Page.astro:1:1" data-sq-source="Page.astro:1:1">hi</section>';
    const el = document.querySelector('section')!;
    el.getBoundingClientRect = () =>
      ({ top: 0, left: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0 }) as DOMRect;
    document.elementFromPoint = () => el;

    const bridge = mountHoverBridge();
    bridge.handleSimulateHover({ x: 10, y: 10 });

    expect(bridge.lastHoveredKey).toBe('Page.astro:1:1');
    const msg = bridge.sendToParent.mock.calls.map((c) => c[0]).find(
      (m: { type: string }) => m.type === 'ELEMENT_HOVER');
    expect(msg).toBeTruthy();
    expect(msg.payload.key).toBe('Page.astro:1:1');
    expect(msg.payload.rect.width).toBe(100);
  });

  it('clears hover (ELEMENT_HOVER_END) when no element is at the point', () => {
    const bridge = mountHoverBridge();
    bridge.lastHoveredKey = 'something';
    document.elementFromPoint = () => null;

    bridge.handleSimulateHover({ x: 5, y: 5 });

    expect(bridge.lastHoveredKey).toBeNull();
    const msg = bridge.sendToParent.mock.calls.map((c) => c[0]).find(
      (m: { type: string }) => m.type === 'ELEMENT_HOVER_END');
    expect(msg).toBeTruthy();
  });
});
