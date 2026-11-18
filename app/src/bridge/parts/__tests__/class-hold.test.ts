/**
 * instant-edit P0b: the canvas HOLD of a durable class write. Before: 5 s after the last edit every keystroke's
 * row was written to the file; each write refreshed the canvas FROM THE FILE, which still carried the OLD class
 * for every row not yet written, so an element visibly stepped back (23 of 117 runs; 6 of 6 with an outside writer).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

const FILE = 'src/pages/index.astro';
const K1 = `${FILE}:5:3`;
const K2 = `${FILE}:6:3`;
const EPOCH = 'e1';
const intent = (seq: number, hold = true, epoch = EPOCH) => ({ epoch, seq, hold });
const page = (c1: string, c2 = 'w-full', extra = '') =>
  `<html><head></head><body><main data-sq-source="${FILE}:4:1">` +
  `<img data-sq-source="${K1}" class="${c1}">` +
  `<img data-sq-source="${K2}" class="${c2}">${extra}</main></body></html>`;
const dom = () => {
  resetHarnessDom();
  document.body.innerHTML = `<main data-sq-source="${FILE}:4:1">` +
    `<img data-sq-source="${K1}" data-key="${K1}" class="w-full"><img data-sq-source="${K2}" data-key="${K2}" class="w-full"></main>`;
};
const cls = (key: string) => document.querySelector(`[data-key="${key}"]`)!.getAttribute('class');
const refresh = (b: HarnessBridge, html: string) => (b as HarnessBridge & { applySourceHtml: (h: string) => Promise<void> }).applySourceHtml(html);

let bridge: HarnessBridge;
beforeEach(() => {
  dom();
  bridge = mountBridgeForTest();
  bridge.scanElements = vi.fn();
  (bridge as unknown as { requestSourceRefresh: () => void }).requestSourceRefresh = vi.fn();
});

describe('seq gate (W0, W1) and intent-less writes (W2)', () => {
  it('applies only the newest seq per key: a lane-lagged older write is dropped', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(3) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[30px]', intent: intent(2) });
    expect(cls(K1)).toBe('w-[300px]');
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[301px]', intent: intent(4) });
    expect(cls(K1)).toBe('w-[301px]');
  });
  it('drops a write WITHOUT an intent for a held key (the parent replay paths) but applies it to an unheld key', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[3px]' });
    expect(cls(K1)).toBe('w-[300px]');
    bridge.handleUpdateClasses({ key: K2, classes: 'w-[50px]' });
    expect(cls(K2)).toBe('w-[50px]');
    expect(bridge.classHoldFor(document.querySelector(`[data-key="${K2}"]`))).toBeNull();
  });
  it('a NEW epoch (the parent re-evaluated its counter) resets the high-water mark and drops the holds', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(900) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[10px]', intent: intent(1, true, 'e2') });
    expect(cls(K1)).toBe('w-[10px]');
  });
  it('hold:false applies and does not hold (and releases an older hold)', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[200px]', intent: intent(2, false) });
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
    expect(cls(K1)).toBe('w-[200px]');
  });
  it('the pending-class retry for a key with no element yet re-enters with the same seq and applies (strict seq)', () => {
    bridge.handleUpdateClasses({ key: `${FILE}:9:9`, classes: 'w-[7px]', intent: intent(5) });
    expect(bridge.pendingClassUpdates).toHaveLength(1);
    expect(bridge._classHoldByKey[`${FILE}:9:9`]).toBeUndefined();       // no element: no hold yet
    document.querySelector('main')!.insertAdjacentHTML('beforeend', `<p data-sq-source="${FILE}:9:9" data-key="${FILE}:9:9" class="x"></p>`);
    (bridge as unknown as { processPendingClassUpdates: () => void }).processPendingClassUpdates();
    expect(cls(`${FILE}:9:9`)).toBe('w-[7px]');
    expect(bridge._classHoldByKey[`${FILE}:9:9`].seq).toBe(5);
  });
  it('restoring with an intent applies; without one it is dropped for a held key', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    bridge.handleRestoreOriginalClasses({ key: K1, fallbackClasses: 'w-full' });
    expect(cls(K1)).toBe('w-[300px]');
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    bridge.handleRestoreOriginalClasses({ key: K1, fallbackClasses: 'w-full', intent: intent(2) });
    expect(cls(K1)).toBe('w-full');
  });
});

describe('the morph never puts an older class back on a held element (M1)', () => {
  it('skips the class patch while the fresh class is the old file value or a value we painted', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[3px]', intent: intent(1) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[30px]', intent: intent(2) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(3) });
    await refresh(bridge, page('w-full'));          // the file still has the original class
    expect(cls(K1)).toBe('w-[300px]');
    await refresh(bridge, page('w-[3px]'));         // an intermediate row landed
    expect(cls(K1)).toBe('w-[300px]');
    await refresh(bridge, page('w-[30px]'));
    expect(cls(K1)).toBe('w-[300px]');
    expect(bridge._classHoldByKey[K1].seq).toBe(3);
  });
  it('removal branch: a fresh page WITHOUT a class attribute is stale when the element had none before the hold', async () => {
    resetHarnessDom();
    document.body.innerHTML = `<main data-sq-source="${FILE}:4:1"><img data-sq-source="${K1}" data-key="${K1}"></main>`;
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    await refresh(bridge, `<html><head></head><body><main data-sq-source="${FILE}:4:1"><img data-sq-source="${K1}"></main></body></html>`);
    expect(cls(K1)).toBe('w-[300px]');
  });
  it('a fresh class made of tokens that were already on the baseline is stale (page scripts add tokens the server never renders)', async () => {
    document.querySelector(`[data-key="${K1}"]`)!.setAttribute('class', 'w-full rounded js-added');
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px] rounded js-added', intent: intent(1) });
    await refresh(bridge, page('w-full rounded'));  // subset of the baseline tokens
    expect(cls(K1)).toBe('w-[300px] rounded js-added');
  });
  it('other elements still follow the file', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    await refresh(bridge, page('w-full', 'w-1/2'));
    expect(cls(K2)).toBe('w-1/2');
    expect(cls(K1)).toBe('w-[300px]');
  });
  it('a fresh class we never painted and the baseline never had is FOREIGN (an agent): released, shown live, newest wins', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    await refresh(bridge, page('w-[640px] bg-red-500'));
    expect(cls(K1)).toBe('w-[640px] bg-red-500');
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
  });
  it('a skipped patch reports no SOURCE_CHANGED for the held element', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    (bridge.sendToParent as unknown as ReturnType<typeof vi.fn>).mockClear();
    await refresh(bridge, page('w-full'));
    const changed = (bridge.sendToParent as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(c => (c[0] as { type: string }).type === 'SOURCE_CHANGED');
    expect(changed).toHaveLength(0);
  });
  it('the revisit sequence 100, 150, 100 never releases early: the file at 100 (row 1) shows no flash of 150', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[100px]', intent: intent(1) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[150px]', intent: intent(2) });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[100px]', intent: intent(3) });
    await refresh(bridge, page('w-[100px]'));       // row 1 landed: equals the held value but the hold is not settled
    expect(bridge._classHoldByKey[K1]).toBeDefined();
    expect(cls(K1)).toBe('w-[100px]');
    await refresh(bridge, page('w-[150px]'));       // row 2 landed
    expect(cls(K1)).toBe('w-[100px]');
  });
});

describe('settle: verify against the file, then release (M2, S)', () => {
  it('a settled hold releases when the refresh shows its value', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(3) });
    bridge.handleClassIntentSettled({ settled: [{ key: K1, seq: 3 }] });
    expect((bridge as unknown as { requestSourceRefresh: ReturnType<typeof vi.fn> }).requestSourceRefresh).toHaveBeenCalled();
    expect(bridge._classHoldByKey[K1].settled).toBe(true);
    await refresh(bridge, page('w-[300px]'));
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
    expect(cls(K1)).toBe('w-[300px]');
    await refresh(bridge, page('w-1/2'));           // after release the file is truth again
    expect(cls(K1)).toBe('w-1/2');
  });
  it('a settled hold whose refresh still shows an older value keeps it (a miss), and releases + patches after two misses', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(3) });
    bridge.handleClassIntentSettled({ settled: [{ key: K1, seq: 3 }] });
    await refresh(bridge, page('w-full'));
    expect(cls(K1)).toBe('w-[300px]');
    expect(bridge._classHoldByKey[K1].misses).toBe(1);
    await refresh(bridge, page('w-full'));
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
    expect(cls(K1)).toBe('w-full');                // files are truth
  });
  it('a settle for an OLDER seq than the hold does not settle it (a newer write is in flight)', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(5) });
    bridge.handleClassIntentSettled({ settled: [{ key: K1, seq: 3 }] });
    expect(bridge._classHoldByKey[K1].settled).toBe(false);
  });
  it('a settle that arrives BEFORE its write settles the hold as soon as the write is applied', () => {
    bridge.handleClassIntentSettled({ settled: [{ key: K1, seq: 2, epoch: EPOCH }] });
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(2) });
    expect(bridge._classHoldByKey[K1].settled).toBe(true);
  });
  it('a node inside an astro-island is released at settle: the morph never touches it', () => {
    document.body.innerHTML = `<astro-island><img data-sq-source="${K1}" data-key="${K1}" class="w-full"></astro-island>`;
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    bridge.handleClassIntentSettled({ settled: [{ key: K1, seq: 1 }] });
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
  });
  it('the backstop releases a hold when the parent has been silent for 120 s; alive keeps it', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-17T10:00:00Z'));
    try {
      bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
      vi.setSystemTime(new Date('2026-11-17T10:01:30Z'));
      bridge.handleClassIntentSettled({ settled: [], alive: [{ key: K1, seq: 1 }] });
      vi.setSystemTime(new Date('2026-11-17T10:03:00Z'));
      await refresh(bridge, page('w-full'));
      expect(cls(K1)).toBe('w-[300px]');           // alive 90 s ago: still held
      vi.setSystemTime(new Date('2026-11-17T10:03:31Z'));
      await refresh(bridge, page('w-full'));
      expect(cls(K1)).toBe('w-full');              // 121 s of silence: the file wins
    } finally { vi.useRealTimers(); }
  });
});

describe('document handling (M3, D4)', () => {
  it('the undo baseline of a held key survives the morph', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    expect(bridge.originalClassesByKey[K1]).toBe('w-full');
    await refresh(bridge, page('w-full'));
    expect(bridge.originalClassesByKey[K1]).toBe('w-full');
  });
  it('a held node the morph removed loses its hold and is never re-asserted by key', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'w-[300px]', intent: intent(1) });
    await refresh(bridge, `<html><head></head><body><main data-sq-source="${FILE}:4:1"><img data-sq-source="${K2}" class="w-full"></main></body></html>`);
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
  });
  it('the sibling broadcast (one source key, several placements) shares one hold', () => {
    document.body.innerHTML = `<main><img data-sq-source="${K1}" data-key="${K1}" class="a"><img data-sq-source="${K1}" class="a"></main>`;
    bridge.handleUpdateClasses({ key: K1, classes: 'b', sourceLocation: { file: FILE, line: 5, column: 3 }, intent: intent(1) });
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs.map(i => i.getAttribute('class'))).toEqual(['b', 'b']);
    expect(bridge.classHoldFor(imgs[0])).toBe(bridge.classHoldFor(imgs[1]));
    expect(bridge.classHoldFor(imgs[1])).not.toBeNull();
  });
  it('the pending-asset replay never creates or refreshes a hold', () => {
    bridge.handleUpdateClasses({ key: K1, classes: 'bg-[url(sq-asset:abc)]', intent: intent(1, false) });
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
    (bridge as unknown as { _assetMap: Record<string, string> })._assetMap['abc'] = 'blob:x';
    bridge.handleTransferAsset({ assetId: 'abc', arrayBuffer: new ArrayBuffer(1), mimeType: 'image/png' });
    expect(bridge._classHoldByKey[K1]).toBeUndefined();
  });
  it('an inline-background hold keeps its style attribute through the morph', async () => {
    bridge.handleUpdateClasses({ key: K1, classes: "bg-[url('blob:x')]", intent: intent(1) });
    expect((document.querySelector(`[data-key="${K1}"]`) as HTMLElement).style.backgroundImage).toContain('blob:x');
    await refresh(bridge, page('w-full'));
    expect((document.querySelector(`[data-key="${K1}"]`) as HTMLElement).style.backgroundImage).toContain('blob:x');
  });
});
