import { afterEach, expect, it, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom } from './harness';
afterEach(resetHarnessDom);
it('keeps diagnostics absent when disabled and rejects stale documents and non-parent senders', () => {
  const bridge = mountBridgeForTest() as ReturnType<typeof mountBridgeForTest> & {
    handleMessage(e: MessageEvent): void;
    _performance?: { read(): unknown[] };
  };
  bridge._handlers = {};
  bridge.registerHandlers();
  const documentId = (document as Document & { __sqBridgeDocumentId: string }).__sqBridgeDocumentId;
  const send = (id: string, source: MessageEventSource | null = window.parent, enabled = true) => bridge.handleMessage(new MessageEvent('message', {
    source, origin: window.location.origin, data: { type: 'SQ_PERFORMANCE', payload: { documentId: id, operation: 7, enabled } },
  }));
  expect(bridge._performance).toBeUndefined();
  send(documentId, window.parent, false);
  expect(bridge._performance).toBeUndefined();
  send('departed-document'); send(documentId, null);
  expect(bridge._performance).toBeUndefined();
  send(documentId);
  expect(bridge._performance).toBeDefined();
  bridge.handleMessage(new MessageEvent('message', { source: window.parent, origin: window.location.origin, data: { type: 'SET_CONTEXT', payload: { contextKey: 'private text/path' } } }));
  expect(bridge._performance!.read()).toEqual([expect.objectContaining({ name: 'bridge-message', operation: 7, amount: 1 })]);
  expect(JSON.stringify(bridge._performance!.read())).not.toContain('private');
  send('departed-document', window.parent, false);
  expect(bridge._performance).toBeDefined();
  for (let i = 0; i < 2001; i++) bridge.handleMessage(new MessageEvent('message', { source: window.parent, origin: window.location.origin, data: { type: 'SET_CONTEXT' } }));
  expect(bridge._performance!.read()).toHaveLength(2000);
  expect(Object.keys(bridge._performance!.read()[0] as object)).toEqual(['name', 'operation', 'at', 'amount']);
  send(documentId, window.parent, false);
  expect(bridge._performance).toBeUndefined();
});

it('rearms only the replacement document and explicitly excludes its pre-handshake initial scan', async () => {
  vi.useFakeTimers();
  const makeDocument = async (id: string) => {
    vi.resetModules(); (document as any).__sqBridgeDocumentId = id;
    (window as any).__SQ_LOCAL_MODE__ = true;
    document.body.innerHTML = '<main data-sq-source="src/pages/index.astro:1:1"><p data-sq-source="src/pages/index.astro:2:1">Fixture</p></main>';
    const { mountBridgeForTest } = await import('./harness');
    const bridge = mountBridgeForTest() as any;
    delete bridge.scanElements; bridge._assetMap = {};
    Object.defineProperty(document, 'readyState', { configurable: true, value: 'complete' });
    bridge.notifyReady(); await vi.advanceTimersByTimeAsync(0);
    return bridge;
  };
  const enable = (bridge: any, documentId: string, operation: number, source: MessageEventSource | null = window.parent) => bridge.handleMessage(new MessageEvent('message', {
    source, origin: location.origin, data: { type: 'SQ_PERFORMANCE', payload: { enabled: true, documentId, operation } },
  }));
  try {
    const departed = await makeDocument('departed'); enable(departed, 'departed', 7); departed.scanElements();
    const replacement = await makeDocument('replacement');
    enable(replacement, 'departed', 8); enable(replacement, 'replacement', 8, null);
    expect(replacement._performance).toBeUndefined();
    enable(replacement, 'replacement', 8);
    // The actual initial scan already ran. Late rearm MUST NOT claim it counted it.
    expect(replacement._performance.read()).toEqual([]);
    replacement.scanElements();
    expect(replacement._performance.read()).toContainEqual(expect.objectContaining({ name: 'scan', operation: 8 }));
    expect(replacement._performance.read().every((m: any) => m.operation === 8)).toBe(true);
    expect(departed._performance.read().every((m: any) => m.operation === 7)).toBe(true);
  } finally {
    delete (window as any).__SQ_LOCAL_MODE__; delete (document as any).__sqBridgeDocumentId; delete (document as any).readyState;
    vi.useRealTimers(); vi.resetModules();
  }
});
