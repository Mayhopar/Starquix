import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

let bridge: ReturnType<typeof mountBridgeForTest> & {
  _reportContentHeightNow(): void;
  _heightMutationObserver?: MutationObserver;
};
function report() {
  bridge._reportContentHeightNow();
  const calls = vi.mocked(bridge.sendToParent).mock.calls;
  return (calls[calls.length - 1][0] as { payload: Record<string, unknown> }).payload;
}
beforeEach(() => {
  resetHarnessDom();
  document.body.innerHTML = '<main>Content</main>';
  bridge = mountBridgeForTest() as typeof bridge;
});
afterEach(() => bridge._heightMutationObserver?.disconnect());

describe('CONTENT_HEIGHT measurement provenance', () => {
  it('reports active CSS transition geometry separately from settled or decorative animation', () => {
    const original = Object.getOwnPropertyDescriptor(document, 'getAnimations');
    let animations: object[] = [{ transitionProperty: 'margin-top', playState: 'running' }];
    Object.defineProperty(document, 'getAnimations', { configurable: true, value: () => animations });
    try {
      expect(report().transitioning).toBe(true);
      animations = [{ animationName: 'pulse', playState: 'running' }];
      expect(report().transitioning).toBe(false);
      animations = [{ transitionProperty: 'margin-top', playState: 'finished' }];
      expect(report().transitioning).toBe(false);
    } finally {
      if (original) Object.defineProperty(document, 'getAnimations', original);
      else Reflect.deleteProperty(document, 'getAnimations');
    }
  });
  it('includes viewport, document, mode and a stable revision', () => {
    expect(report()).toMatchObject({ viewportHeight: innerHeight, viewportWidth: innerWidth, href: location.href, mode: 'design', revision: 0 });
    expect(report().revision).toBe(0);
  });
  it('ignores selection overlays and their resize-driven style mutations', async () => {
    report();
    const overlay = document.createElement('div');
    overlay.setAttribute('data-sq-selection-highlight', 'true');
    document.body.append(overlay);
    await Promise.resolve();
    expect(report().revision).toBe(0);
    overlay.style.height = '1500px';
    await Promise.resolve();
    expect(report().revision).toBe(0);
    overlay.remove();
    await Promise.resolve();
    expect(report().revision).toBe(0);
  });
  it('does not count the bridge fixed-layer repaint or restore as content edits', async () => {
    document.querySelector('main')!.setAttribute('style', 'position:fixed');
    report();
    bridge.handleRepaintFixed();
    await Promise.resolve();
    expect(document.querySelector('main')!.style.willChange).toBe('transform');
    expect(report().revision).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(document.querySelector('main')!.style.willChange).toBe('');
    expect(report().revision).toBe(0);
  });
  it('still counts source styles changed in the same batch as bridge layerization', async () => {
    const main = document.querySelector('main')!;
    main.setAttribute('style', 'position:fixed');
    report();
    bridge.handleRepaintFixed();
    main.style.height = '1500px';
    await Promise.resolve();
    expect(report().revision).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(report().revision).toBe(1);
    expect(main.style.height).toBe('1500px');
  });
  it('renews for real content/style edits but not bridge key stamping or equal attribute writes', async () => {
    report();
    const main = document.querySelector('main')!;
    main.setAttribute('data-key', 'bridge-key');
    await Promise.resolve();
    expect(report().revision).toBe(0);
    main.setAttribute('style', 'height:1000px');
    await Promise.resolve();
    expect(report().revision).toBe(1);
    main.setAttribute('style', 'height:1000px');
    await Promise.resolve();
    expect(report().revision).toBe(1);
    main.firstChild!.textContent = 'Changed';
    await Promise.resolve();
    expect(report().revision).toBe(2);
    main.remove();
    await Promise.resolve();
    expect(report().revision).toBe(3);
  });
});
