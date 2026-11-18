/**
 * Predicted paint (filmstrip 2026-11-08): an accepted delete / move / ⌘D is
 * applied to the canvas DOM at once (applyPrediction); the write's refresh
 * morph lands 150–400 ms later as a check. The change is not re-scanned as a
 * natural mutation; its one scan is flagged `predicted` (pre-write keys).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type B = HarnessBridge & {
  handleCloneElementInDom: (p: unknown) => void;
  handleRemoveElementFromDOM: (p: unknown) => void;
  stopMutationObserver: () => void;
  startMutationObserver: () => void;
  mutationObserverStarted: boolean;
  _predictedScan?: boolean;
};

const PAGE = 'src/pages/index.astro';
const scans = (bridge: HarnessBridge) => (bridge.sendToParent as unknown as ReturnType<typeof vi.fn>).mock.calls
  .map((c) => c[0] as { type: string; payload: { predicted?: boolean } })
  .filter((m) => m.type === 'ELEMENTS_SCANNED');

beforeEach(() => {
  resetHarnessDom();
  document.body.innerHTML =
    `<main data-sq-source="${PAGE}:5:1">` +
    `<p data-sq-source="${PAGE}:8:3" data-key="${PAGE}:8:3" id="x">Second <b data-sq-source="${PAGE}:8:20">bold</b></p>` +
    `<section data-sq-source="${PAGE}:9:3" data-key="${PAGE}:9:3"><span>in</span></section>` +
    '</main>';
});
afterEach(() => vi.useRealTimers());

describe('CLONE_ELEMENT_IN_DOM (handleCloneElementInDom)', () => {
  it('puts an UNKEYED copy right after the anchor, then a predicted scan', () => {
    const bridge = mountBridgeForTest() as B;
    bridge.scanThen = vi.fn();
    bridge.handleCloneElementInDom({ key: `${PAGE}:8:3`, anchorKey: `${PAGE}:8:3`, position: 'after' });
    const kids = Array.from(document.querySelector('main')!.children);
    expect(kids.map((k) => k.tagName)).toEqual(['P', 'P', 'SECTION']);
    const copy = kids[1];
    expect(copy.textContent).toBe('Second bold');
    // No pre-write coordinate on the copy or inside it: the next edit can't target the old file through it.
    expect(copy.hasAttribute('data-sq-source') || copy.hasAttribute('data-key')).toBe(false);
    expect(copy.querySelector('[data-sq-source],[data-key]')).toBeNull();
    expect(copy.getAttribute('data-sq-predicted')).toBe('true');
    expect(bridge.scanThen).toHaveBeenCalledWith(null, 1);
    expect(bridge._predictedScan).toBe(true);
  });

  it('inside-end lands as the anchor\'s last child; an unknown key changes nothing', () => {
    const bridge = mountBridgeForTest() as B;
    bridge.scanThen = vi.fn();
    bridge.handleCloneElementInDom({ key: `${PAGE}:9:3`, anchorKey: `${PAGE}:9:3`, position: 'inside-end' });
    const section = document.querySelector('section')!;
    expect(section.lastElementChild!.tagName).toBe('SECTION');
    expect(section.lastElementChild!.hasAttribute('data-sq-source')).toBe(false);
    const before = document.body.innerHTML;
    bridge.handleCloneElementInDom({ key: `${PAGE}:99:1`, anchorKey: `${PAGE}:99:1`, position: 'after' });
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('applyPrediction', () => {
  it('pauses the scan observer around the change (no natural rescan of it)', () => {
    const bridge = mountBridgeForTest() as B;
    bridge.scanThen = vi.fn();
    const order: string[] = [];
    bridge.mutationObserverStarted = true;
    bridge.stopMutationObserver = vi.fn(() => { order.push(`stop:${document.querySelectorAll('p').length}`); });
    bridge.startMutationObserver = vi.fn(() => { order.push(`start:${document.querySelectorAll('p').length}`); });
    bridge.handleRemoveElementFromDOM({ key: `${PAGE}:8:3` });
    expect(order).toEqual(['stop:1', 'start:0']);
    expect(bridge.scanThen).toHaveBeenCalledWith(null, 1);
  });

  it('the scan right after a prediction is flagged once; the next is not', () => {
    const bridge = mountBridgeForTest() as B;
    delete (bridge as unknown as { scanElements?: unknown }).scanElements;
    (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
    bridge._predictedScan = true;
    bridge.scanElements();
    bridge.scanElements();
    expect(scans(bridge).map((m) => m.payload.predicted)).toEqual([true, false]);
  });
});

// Regression (log-proven 2026-11-08, real app): after ⌘D the refresh gave the
// predicted copy its source (index.astro:9:5) but kept the `dynamic:` data-key
// the predicted scan had stamped — clicks read data-key, so the next Delete took
// the doc path ("Editor action refused: REMOVE_ELEMENT") and nothing happened.
describe('a predicted copy takes its real key on the refresh', () => {
  it('drops the dynamic stand-in key once the node gains a source', async () => {
    resetHarnessDom();
    document.body.innerHTML = `<main data-sq-source="${PAGE}:5:1">` +
      `<p data-sq-source="${PAGE}:8:5" data-key="${PAGE}:8:5">Second</p>` +
      '<p data-key="dynamic:p:3@x"><b data-key="dynamic:b:4@x">bold</b></p></main>';
    const bridge = mountBridgeForTest() as unknown as { applySourceHtml: (h: string) => Promise<void>; scanElements: () => void };
    bridge.scanElements = vi.fn();
    await bridge.applySourceHtml(`<html><head></head><body><main data-sq-source="${PAGE}:5:1">` +
      `<p data-sq-source="${PAGE}:8:5">Second</p><p data-sq-source="${PAGE}:9:5"><b data-sq-source="${PAGE}:9:8">bold</b></p></main></body></html>`);
    const copy = document.querySelectorAll('main > p')[1];
    expect(copy.getAttribute('data-sq-source')).toBe(`${PAGE}:9:5`);
    expect(copy.hasAttribute('data-key')).toBe(false); // the rescan stamps the source key
    expect(copy.querySelector('b')!.hasAttribute('data-key')).toBe(false);
    expect(document.querySelector('main > p')!.getAttribute('data-key')).toBe(`${PAGE}:8:5`); // untouched
  });
});

// Regression (disk check on the installed build, 2026-11-08): a click on a ⌘D
// copy in its first ~70 ms (painted, write not landed) selected a temporary
// dynamic key; Delete then failed "Keyboard edit was not saved" until a re-click.
describe('a not-yet-saved copy cannot be selected', () => {
  const copyDom = () => {
    document.body.innerHTML = `<main data-sq-source="${PAGE}:5:1">` +
      `<p data-sq-source="${PAGE}:8:5" data-key="${PAGE}:8:5">Second <b>bold</b></p>` +
      '<p data-sq-predicted="true">Second <b>bold</b></p></main>';
  };
  const click = (target: Element) => ({ target, metaKey: true, ctrlKey: false, altKey: false, detail: 1, clientX: 1, clientY: 1,
    preventDefault: vi.fn(), stopPropagation: vi.fn() });
  const sent = (bridge: HarnessBridge, type: string) => (bridge.sendToParent as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter((c) => (c[0] as { type: string }).type === type);

  it('a click on the copy (or inside it) selects nothing', () => {
    copyDom();
    const bridge = mountBridgeForTest() as unknown as HarnessBridge & { handleClick: (e: unknown) => void };
    const e = click(document.querySelectorAll('main > p')[1].querySelector('b')!);
    bridge.handleClick(e);
    expect(sent(bridge, 'ELEMENT_CLICK')).toEqual([]);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(document.querySelectorAll('main > p')[1].hasAttribute('data-key')).toBe(false);
  });

  it('the copy is not scanned (no temporary key, no Layers row) until it is saved', () => {
    copyDom();
    const bridge = mountBridgeForTest();
    delete (bridge as unknown as { scanElements?: unknown }).scanElements;
    (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
    bridge.scanElements();
    const scanned = sent(bridge, 'ELEMENTS_SCANNED')[0][0] as { payload: { elements: Array<{ key: string }> } };
    const copy = document.querySelector('[data-sq-predicted]')!;
    expect(scanned.payload.elements.filter((el) => el.key.startsWith('dynamic:p'))).toEqual([]);
    expect(copy.hasAttribute('data-key') || copy.querySelector('[data-key]') !== null).toBe(false);
  });
});
