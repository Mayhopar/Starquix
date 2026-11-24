/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md):
 * "the layer icon kept switching between flex and grid" / "the design bar
 * registered my changes inconsistently".
 *
 * Three rules that each look right alone, closed into one loop with the REAL
 * code on both sides (the bridge part strings + the editor's scan handler):
 *   store   an editor-only override is keyed PER COPY     (`…~s<placement>#N`)
 *   paint   UPDATE_CLASSES for one copy paints EVERY copy (dom-updates.ts: the
 *           placement broadcast — PLACEMENT_KEY_PATTERN drops `#N`)
 *   re-apply after each scan, every edited entry whose scanned class differs is
 *           posted again (viewportMessages/scanning.ts: reapplySourceClassOverrides),
 *           compared against the scan payload, not the live DOM.
 * With the per-copy values decoded from the user's project (copy #0 = grid,
 * copies #1..#3 = flex flex-col) the canvas never settles: every scan repaints
 * all four copies with the other value.
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { makeFakeCtx, makeFakeIframe } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import { applyCommand } from '@/store/commands';
import { localOverridesForPlacement } from '@/store/localMasterOverrides';
import { resetClassWriteBaselines, getObservedFileValue } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const CARD = 'src/components/BlogCard.astro';
const SRC = `${CARD}:26:3`;
const P = 's73bb06627ed37e6c';
const LOC = { file: CARD, line: 26, column: 3 };
const key = (copy: number) => `${SRC}~${P}${copy ? `#${copy}` : ''}`;
const MASTER = 'flex flex-col justify-between';
const GRID = 'justify-start items-stretch col-span-2 gap-y-3 grid lg:col-span-3';
const FLEX = 'flex flex-col justify-start items-stretch col-span-2 gap-y-3 lg:col-span-3';

const setLocalMode = (on: boolean) => { (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = on || undefined; };
const dom = () => Array.from(document.querySelectorAll('div')).map(d => d.getAttribute('class'));

/** Four copies of ONE usage tag. `masterAttr`: the tagger reports the master literal (the `Astro.props.x ?? "…"` form). */
function closedLoop(masterAttr: boolean) {
  document.body.innerHTML = [0, 1, 2, 3].map(i =>
    `<div class="${MASTER}" data-sq-source="${SRC}" data-sq-placement="${P}"${masterAttr ? ` data-sq-cf="${MASTER}"` : ''}>copy ${i}</div>`).join('');
  const bridge: HarnessBridge = mountBridgeForTest();
  bridge.scanThen = vi.fn();
  (bridge as unknown as { reportContentHeight: () => void }).reportContentHeight = vi.fn(); // rAF: not under test
  delete (bridge as unknown as { scanElements?: unknown }).scanElements; // the real scan
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  const doc = new Y.Doc();
  // The store as decoded from the user's localStorage mirror: one entry per rendered copy, values disagree.
  for (let copy = 0; copy < 4; copy++) {
    applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key(copy), classes: MASTER, sourceLocation: LOC });
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key(copy), classes: copy === 0 ? GRID : FLEX });
  }
  let paints = 0;
  const { iframe, postMessage } = makeFakeIframe();
  postMessage.mockImplementation((message: { type: string; payload: Parameters<HarnessBridge['handleUpdateClasses']>[0] }) => {
    if (message.type !== 'UPDATE_CLASSES') return;
    paints++;
    bridge.handleUpdateClasses(message.payload);
  });
  const ctx = makeFakeCtx({ refs: { iframe }, env: { doc } });
  /** One round = what happens on every scan: the bridge reports the DOM, the editor re-applies its entries. */
  const round = () => {
    const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
    send.mockClear();
    bridge.scanElements();
    const scanned = send.mock.calls.map(c => c[0] as { type: string; payload?: { elements: never[] } }).find(m => m.type === 'ELEMENTS_SCANNED');
    paints = 0;
    handleElementsScanned(ctx, { elements: scanned?.payload?.elements ?? [] });
    return { classes: dom(), paints };
  };
  return { doc, round, bridge, ctx };
}

describe('REPRO: per-copy overrides + placement-wide paint + re-apply = a canvas that never settles', () => {
  beforeEach(() => { resetHarnessDom(); setLocalMode(true); });
  afterEach(() => { setLocalMode(false); resetClassWriteBaselines(); _resetLocalPageSyncForTests(); });

  it('sanity: the real scan gives the four copies the keys K, K#1, K#2, K#3', () => {
    const t = closedLoop(true);
    t.round();
    expect(localOverridesForPlacement(t.doc, CARD, P).map(e => e.key)).toEqual([key(0), key(1), key(2), key(3)]);
  });

  it.fails('the canvas settles after one scan (re-apply is idempotent)', () => {
    const t = closedLoop(true);
    const rounds = Array.from({ length: 6 }, () => t.round());
    const layoutOfCopy0 = rounds.map(r => (r.classes[0]!.split(' ').includes('grid') ? 'grid' : 'flex'));
    // DESIRED: stable from the first scan on. Today: flex, grid, flex, grid, flex, grid — the flipping layer icon.
    expect(new Set(layoutOfCopy0).size).toBe(1);
    expect(rounds.slice(1).map(r => r.paints)).toEqual([0, 0, 0, 0, 0]);
  });

  it.fails('all copies of one usage tag hold ONE stored value', () => {
    const t = closedLoop(true);
    t.round();
    const values = new Set(localOverridesForPlacement(t.doc, CARD, P).map(e => e.value));
    expect(values.size).toBe(1); // Today 2: `…grid…` for copy #0, `flex flex-col …` for #1..#3 — one usage tag can render only one.
  });

  it.fails('a value the editor painted is never recorded as what the FILE renders', () => {
    // Plain `class="…"` master (no prop fallback yet): the scan has only the DOM class to read.
    const t = closedLoop(false);
    for (let i = 0; i < 3; i++) t.round();
    // DESIRED: the file value stays the master. Today the line's "file value" becomes one copy's override,
    // which then retires the other copies' entries (isEditedSourceClassEntry) and feeds Push's write baseline.
    expect(getObservedFileValue('classes', key(0))).toBe(MASTER);
  });

  it.fails('a manual edit on one copy is still on the canvas after the next scan ("the card stopped responding")', () => {
    const t = closedLoop(true);
    t.round();
    // The user restyles copy #0 in the design bar. For a loop the edit is editor-only: stored under copy #0's key, painted with a hold.
    const EDIT = 'flex flex-row gap-8';
    applyCommand(t.doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key(0), classes: EDIT });
    t.bridge.handleUpdateClasses({ key: key(0), classes: EDIT, sourceLocation: LOC, intent: { epoch: 'e1', seq: 1, hold: true } });
    expect(dom()).toEqual([EDIT, EDIT, EDIT, EDIT]); // the paint reaches every copy of the usage tag
    t.round(); // the next scan (≤ 500 ms later in the loop above)
    // DESIRED: the edit stays. Today copies #1..#3 re-apply THEIR stored value over the whole usage — the edit is visibly undone.
    expect(dom()[0]).toBe(EDIT);
  });

  it.fails('the bridge stops rescanning once the canvas is painted (no self-sustaining scan → paint → scan loop)', async () => {
    // The bridge rescans when a class mutation changes a scanned element's computed layout (scanning.ts: hasLayoutMutation,
    // exempt from MAX_RESCANS). grid ⇄ flex is exactly such a change, so the re-apply above feeds itself.
    vi.useFakeTimers();
    vi.setSystemTime(0);
    type LoopBridge = HarnessBridge & { startMutationObserver(): void; stopMutationObserver(): void; mutationObserverStarted: boolean };
    let bridge: LoopBridge | undefined;
    try {
      const t = closedLoop(true);
      document.head.innerHTML = '<style>.grid{display:grid}.flex{display:flex}</style>'; // what Tailwind gives the real page
      bridge = t.bridge as LoopBridge;
      let scans = 0;
      bridge.sendToParent = ((message: { type: string; payload?: { elements: never[] } }) => {
        if (message.type !== 'ELEMENTS_SCANNED') return;
        scans++;
        handleElementsScanned(t.ctx, { elements: message.payload?.elements ?? [] });
      }) as HarnessBridge['sendToParent'];
      bridge.mutationObserverStarted = false;
      bridge.startMutationObserver();
      bridge.scanElements(); // the page-load scan: the re-apply ends on `flex` (last writer), same computed layout as the master
      bridge.scanElements(); // any later scan (a click, an HMR update): copy #0's entry repaints `grid` → the layout changes
      expect(scans).toBe(2);
      await vi.advanceTimersByTimeAsync(10_000);
      // DESIRED: nothing more — nobody touched the page. Today: one self-triggered scan + repaint every 500 ms, forever.
      expect(scans).toBeLessThanOrEqual(3);
    } finally {
      bridge?.stopMutationObserver();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
