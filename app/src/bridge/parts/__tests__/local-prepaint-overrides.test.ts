/**
 * Local surface-switch blink — final ~150 ms (owner report 2026-08-06).
 *
 * A local page frame is a REAL navigation and paints RAW FILE BYTES; the
 * placement override lives in the parent's doc and used to land only via the
 * post-ELEMENTS_SCANNED UPDATE_CLASSES round-trip — measured live 127–160 ms
 * after navigation start, while the element enters the DOM at ~75 ms. The
 * file-bytes window opens BEFORE first paint by parser ordering, so no
 * parent-mediated re-apply can ever close it.
 *
 * Fix under test: the parent rides the edited sourceClasses map on the frame
 * URL fragment (`#sq-ov=`), and the bridge — whose <script> tag executes
 * synchronously in <head>, before any body element exists — arms a
 * MutationObserver that applies the override to each matching element AS THE
 * PARSER INSERTS IT. Mutation callbacks are microtasks and run before
 * update-the-rendering, so the FIRST painted bytes already carry the override.
 *
 * The badge contract must not move: the scan still reports the FILE value the
 * first time it sees a pre-applied element (consume-once stash), so the
 * parent's baseline/↻ bookkeeping sees the byte-identical stream it sees
 * today, and originalClassesByKey still holds the pre-override baseline for
 * RESTORE_ORIGINAL_CLASSES.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type LocalWindow = Window & { __SQ_LOCAL_MODE__?: boolean };

const KEY = 'src/components/Card.astro:5:3~q0123456789abcdef';
const FILE_CLASSES = 'card-title';
const OVERRIDE_CLASSES = 'card-title bg-blue-500';

function setHash(overrides: Record<string, string>): void {
  window.location.hash = '#sq-ov=' + encodeURIComponent(JSON.stringify(overrides));
}

/** Flush MutationObserver microtasks. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function insertCardH3(classes = FILE_CLASSES): HTMLElement {
  const el = document.createElement('h3');
  el.setAttribute('class', classes);
  el.setAttribute('data-sq-source', 'src/components/Card.astro:5:3');
  el.setAttribute('data-sq-placement', 'q0123456789abcdef');
  document.body.appendChild(el);
  return el;
}

function runScan(bridge: HarnessBridge): Array<{ key: string; classes: string }> {
  delete (bridge as unknown as { scanElements?: unknown }).scanElements;
  (bridge as unknown as { _assetMap: Record<string, string> })._assetMap = {};
  (bridge as unknown as { mutationObserverStarted: boolean }).mutationObserverStarted = true;
  (bridge.sendToParent as unknown as ReturnType<typeof vi.fn>).mockClear();
  (bridge as unknown as { scanElements: () => void }).scanElements();
  const send = bridge.sendToParent as unknown as ReturnType<typeof vi.fn>;
  const scanned = send.mock.calls
    .map((c) => c[0] as { type: string; payload?: { elements: Array<{ key: string; classes: string }> } })
    .find((m) => m.type === 'ELEMENTS_SCANNED');
  return scanned?.payload?.elements ?? [];
}

type PreApplyBridge = HarnessBridge & { preApplyLocalOverrides: () => void };

describe('local pre-paint override apply (#sq-ov fragment)', () => {
  beforeEach(() => {
    resetHarnessDom();
    (window as LocalWindow).__SQ_LOCAL_MODE__ = true;
  });
  afterEach(() => {
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    window.location.hash = '';
  });

  it('applies the override to an element as the parser inserts it', async () => {
    setHash({ [KEY]: OVERRIDE_CLASSES });
    const bridge = mountBridgeForTest() as PreApplyBridge;
    bridge.preApplyLocalOverrides();

    const el = insertCardH3();
    await flush();

    expect(el.getAttribute('class')).toBe(OVERRIDE_CLASSES);
    // task-151 baseline: the pre-override FILE value, so an undo that removes
    // the overlay entry can still restore the source rendering.
    expect(bridge.originalClassesByKey[KEY]).toBe(FILE_CLASSES);
  });

  it('first scan reports the FILE classes (badge bookkeeping unchanged), later scans the DOM', async () => {
    setHash({ [KEY]: OVERRIDE_CLASSES });
    const bridge = mountBridgeForTest() as PreApplyBridge;
    bridge.preApplyLocalOverrides();
    insertCardH3();
    await flush();

    const first = runScan(bridge);
    expect(first.find((e) => e.key === KEY)?.classes).toBe(FILE_CLASSES);

    const second = runScan(bridge);
    expect(second.find((e) => e.key === KEY)?.classes).toBe(OVERRIDE_CLASSES);
  });

  it('repeat elements get scan-identical #N keys — override on #1 hits only the second', async () => {
    setHash({ [KEY + '#1']: OVERRIDE_CLASSES });
    const bridge = mountBridgeForTest() as PreApplyBridge;
    bridge.preApplyLocalOverrides();

    const a = insertCardH3();
    const b = insertCardH3();
    await flush();

    expect(a.getAttribute('class')).toBe(FILE_CLASSES);
    expect(b.getAttribute('class')).toBe(OVERRIDE_CLASSES);
  });

  it('outside local mode the fragment is inert (WC/server byte-identical)', async () => {
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    setHash({ [KEY]: OVERRIDE_CLASSES });
    const bridge = mountBridgeForTest() as PreApplyBridge;
    bridge.preApplyLocalOverrides();

    const el = insertCardH3();
    await flush();

    expect(el.getAttribute('class')).toBe(FILE_CLASSES);
  });

  it('fails open: malformed fragment applies nothing and throws nothing', async () => {
    window.location.hash = '#sq-ov=%7Bnot-json';
    const bridge = mountBridgeForTest() as PreApplyBridge;
    expect(() => bridge.preApplyLocalOverrides()).not.toThrow();

    const el = insertCardH3();
    await flush();
    expect(el.getAttribute('class')).toBe(FILE_CLASSES);
  });
});

// The running document must retain the fragment for the next HMR reload,
// without a parent iframe.src mutation interrupting an in-flight file write.
describe('handleSyncLocalOverridesFragment (SYNC_LOCAL_OVERRIDES_FRAGMENT)', () => {
  let bridge: HarnessBridge & { _handlers: Record<string, (payload: { url: string }) => void> };
  beforeEach(() => {
    resetHarnessDom();
    (window as LocalWindow).__SQ_LOCAL_MODE__ = true;
    window.history.replaceState({ fixture: true }, '', '/about?q=1');
    bridge = mountBridgeForTest() as typeof bridge;
    bridge._handlers = {};
    bridge.registerHandlers();
  });
  afterEach(() => {
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    window.history.replaceState(null, '', '/');
    vi.restoreAllMocks();
  });

  it('updates and removes only the current document fragment, preserving history state and DOM', () => {
    const el = insertCardH3();
    const replace = vi.spyOn(window.history, 'replaceState');
    const url = window.location.href;
    const hash = '#sq-ov=' + encodeURIComponent(JSON.stringify({ [KEY]: OVERRIDE_CLASSES }));
    bridge._handlers.SYNC_LOCAL_OVERRIDES_FRAGMENT({ url: url + hash });
    expect(window.location.hash).toBe(hash);
    expect(window.history.state).toEqual({ fixture: true });
    expect(el.getAttribute('class')).toBe(FILE_CLASSES); // Existing class update path owns the DOM.
    expect(replace).toHaveBeenCalledTimes(1);
    bridge._handlers.SYNC_LOCAL_OVERRIDES_FRAGMENT({ url: url + hash });
    expect(replace).toHaveBeenCalledTimes(1); // StrictMode/replay is idempotent.
    bridge._handlers.SYNC_LOCAL_OVERRIDES_FRAGMENT({ url });
    expect(window.location.hash).toBe('');
    expect(document.body.contains(el)).toBe(true);
  });

  it.each(['/other?q=1#sq-ov=stale', '/about?q=2#sq-ov=stale', '/about/?q=1#sq-ov=stale', 'https://other.test/about?q=1#sq-ov=stale', '/about?q=1#anchor'])('rejects stale document or unrelated fragment: %s', url => {
    const replace = vi.spyOn(window.history, 'replaceState');
    bridge._handlers.SYNC_LOCAL_OVERRIDES_FRAGMENT({ url: new URL(url, window.location.href).href });
    expect(replace).not.toHaveBeenCalled();
  });

  it('is inert outside files-truth local mode', () => {
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
    const replace = vi.spyOn(window.history, 'replaceState');
    bridge._handlers.SYNC_LOCAL_OVERRIDES_FRAGMENT({ url: window.location.href + '#sq-ov=next' });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('current document identity', () => {
  it('keeps ready and repeated route replies tied to one document independently of parent request IDs', () => {
    resetHarnessDom(); (window as LocalWindow).__SQ_LOCAL_MODE__ = true;
    const bridge = mountBridgeForTest() as HarnessBridge & { handleRequestLocalRoute: (p: { requestId: string }) => void; notifyReady: () => void };
    bridge.notifyReady(); bridge.handleRequestLocalRoute({ requestId: 'first' }); bridge.handleRequestLocalRoute({ requestId: 'second' });
    const messages = vi.mocked(bridge.sendToParent).mock.calls.map(([message]) => message as { type: string; payload: { documentId: string } });
    const ready = messages.find(m => m.type === 'IFRAME_READY')!;
    expect(ready.payload.documentId).toEqual(expect.any(String));
    expect(ready.payload.documentId.length).toBeGreaterThan(0);
    const results = messages.filter(m => m.type === 'LOCAL_ROUTE_RESULT');
    expect(results).toHaveLength(2);
    expect(results.map(m => m.payload.documentId)).toEqual([ready.payload.documentId, ready.payload.documentId]);
    delete (window as LocalWindow).__SQ_LOCAL_MODE__;
  });
});
