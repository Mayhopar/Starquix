/**
 * REPRO (investigation 2026-11-23, docs/plans/instance-override-architecture.md): the "ghost"
 * class `justify-start items-stretch col-span-2 gap-y-3 grid lg:col-span-3` that the canvas kept
 * showing on all four blog cards at 20:42:57Z, although no project file contained it and the page
 * passed `textClass="contents"` (the agent's write, rev 1366, 20:42:49Z).
 *
 * It was the user's own last manual edit (journal rev 1365, 20:37:03Z, 28 s after the Push),
 * stored editor-only on copy #0 (a loop usage cannot carry a prop), and the scan re-apply paints
 * an editor-only entry over whatever the files render — broadcast to every copy of the usage.
 * The other copies are modelled with no entry and "settling" (left so by the Reset/Push), so the scan
 * does not re-seed them. That part is a model: the mirror record that would decide it was lost; the
 * three identical reads at 20:42:57–20:43:32 (all four copies = the ghost) support it. Real bridge +
 * real scan handler.
 *
 * `it.fails` = the assertion states the DESIRED behaviour and fails today.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';
import { handleElementsScanned } from '@/components/Canvas/viewportMessages/scanning';
import { makeFakeCtx, makeFakeIframe } from '@/components/Canvas/viewportMessages/__tests__/fakeContext';
import { applyCommand } from '@/store/commands';
import { settleOverrides } from '@/utils/propOverrides';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';

const CARD = 'src/components/BlogCard.astro';
const SRC = `${CARD}:26:3`;
const P = 's73bb06627ed37e6c';
const LOC = { file: CARD, line: 26, column: 3 };
const key = (copy: number) => `${SRC}~${P}${copy ? `#${copy}` : ''}`;
const MASTER = 'flex justify-start items-stretch col-span-2 gap-y-3 flex-row lg:col-span-3'; // the literal the Push wrote (rev 1356)
const GHOST = 'justify-start items-stretch col-span-2 gap-y-3 grid lg:col-span-3';
const AGENT = 'contents';                                      // textClass="contents" on the page (rev 1366)

const setLocalMode = (on: boolean) => { (window as unknown as { __SQ_LOCAL_MODE__?: boolean }).__SQ_LOCAL_MODE__ = on || undefined; };
const dom = () => Array.from(document.querySelectorAll('div')).map(d => d.getAttribute('class'));
/** Copies #1..#3: entries deleted by the Reset, keys left settling (the page still rendered its prop). */
const SETTLING = [1, 2, 3].map(c => ({ key: key(c), kind: 'classes' as const }));

describe('REPRO: an editor-only value is painted over what the files render (the ghost)', () => {
  beforeEach(() => { resetHarnessDom(); setLocalMode(true); });
  afterEach(() => { setLocalMode(false); resetClassWriteBaselines(); _resetLocalPageSyncForTests(); settleOverrides(SETTLING, false); });

  it.fails('after the agent sets the page prop, every copy shows the files\' value', () => {
    // The page re-rendered with the agent's prop: four copies of one usage tag, the tagger reports the master literal.
    document.body.innerHTML = [0, 1, 2, 3].map(i =>
      `<div class="${AGENT}" data-sq-source="${SRC}" data-sq-placement="${P}" data-sq-cf="${MASTER}">copy ${i}</div>`).join('');
    const bridge: HarnessBridge = mountBridgeForTest();
    (bridge as unknown as { reportContentHeight: () => void }).reportContentHeight = vi.fn();
    bridge.scanThen = vi.fn();
    delete (bridge as unknown as { scanElements?: unknown }).scanElements;
    (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;

    const doc = new Y.Doc();
    // rev 1365: the user's store-only edit on copy #0.
    applyCommand(doc, { type: 'REGISTER_SOURCE_ELEMENT', sourceKey: key(0), classes: 'flex flex-col justify-between', sourceLocation: LOC });
    applyCommand(doc, { type: 'UPDATE_SOURCE_CLASSES', sourceKey: key(0), classes: GHOST });
    settleOverrides(SETTLING);

    const { iframe, postMessage } = makeFakeIframe();
    postMessage.mockImplementation((m: { type: string; payload: Parameters<HarnessBridge['handleUpdateClasses']>[0] }) => {
      if (m.type === 'UPDATE_CLASSES') bridge.handleUpdateClasses(m.payload);
    });
    const ctx = makeFakeCtx({ refs: { iframe }, env: { doc } });
    const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
    bridge.scanElements();
    const scanned = send.mock.calls.map(c => c[0] as { type: string; payload?: { elements: never[] } }).find(m => m.type === 'ELEMENTS_SCANNED');
    handleElementsScanned(ctx, { elements: scanned?.payload?.elements ?? [] });

    // DESIRED: the files win. Today: all four copies show GHOST (session read_element_html at 20:42:57Z, timeline R10).
    expect(dom()).toEqual([AGENT, AGENT, AGENT, AGENT]);
  });
});
