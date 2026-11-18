/** Shift+click → ELEMENT_CLICK.shiftKey; Shift never drills (design ledger A2–A4,
 *  docs/plans/2026-11-16-multi-select-edit-design.md). */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';

const SECTION = 'src/pages/index.astro:6:1';
const INNER = 'src/pages/index.astro:7:3';

/** Tag an element the way the plugin + Astro dev do (see layout-root-click.test.ts). */
function tagSource(el: Element, source: string) {
  el.setAttribute('data-sq-source', source);
  el.setAttribute('data-astro-source-file', '/p/' + source.split(':')[0]);
  el.setAttribute('data-astro-source-loc', source.split(':').slice(1).join(':'));
  return el;
}
const sentClick = (bridge: ReturnType<typeof mountBridgeForTest>) =>
  (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]).find(m => m.type === 'ELEMENT_CLICK');

function mount() {
  document.body.innerHTML = '<section><div><p>hi</p></div></section>';
  tagSource(document.querySelector('section')!, SECTION);
  tagSource(document.querySelector('div')!, INNER);
  const bridge = mountBridgeForTest();
  document.elementFromPoint = () => document.querySelector('section');
  return bridge;
}

beforeEach(() => {
  resetHarnessDom();
  delete (document as unknown as { elementFromPoint?: unknown }).elementFromPoint;
});

describe('Shift+click', () => {
  it('ELEMENT_CLICK carries shiftKey: true', () => {
    const bridge = mount();
    bridge.handleSimulateClick({ x: 1, y: 1, shiftKey: true });
    expect(sentClick(bridge)?.payload.shiftKey).toBe(true);
  });
  it('a plain click carries shiftKey: false', () => {
    const bridge = mount();
    bridge.handleSimulateClick({ x: 1, y: 1 });
    expect(sentClick(bridge)?.payload.shiftKey).toBe(false);
  });
  it('Shift+double-click never drills down', () => {
    const bridge = mount();
    const drill = vi.spyOn(bridge, 'handleDrillDown');
    bridge.handleSimulateClick({ x: 1, y: 1, shiftKey: true });
    bridge.handleSimulateClick({ x: 1, y: 1, shiftKey: true });
    expect(drill).not.toHaveBeenCalled();
  });
  it('a plain double-click still drills (control for the Shift case)', () => {
    const bridge = mount();
    const drill = vi.spyOn(bridge, 'handleDrillDown');
    bridge.handleSimulateClick({ x: 1, y: 1 });
    bridge.handleSimulateClick({ x: 1, y: 1 });
    expect(drill).toHaveBeenCalled();
  });
});
