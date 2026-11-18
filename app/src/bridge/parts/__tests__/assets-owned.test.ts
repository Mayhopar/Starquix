/**
 * task-120 Phase 2 — the bridge reports which asset ids it already holds
 * (ASSETS_OWNED) right after IFRAME_READY, so the parent rehydrates by diff
 * instead of re-transferring every asset.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

function sentTypes(bridge: HarnessBridge): string[] {
  return (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .map((c) => (c[0] as { type: string }).type);
}

function payloadOf(bridge: HarnessBridge, type: string): { ids: string[] } {
  const call = (bridge.sendToParent as ReturnType<typeof vi.fn>).mock.calls
    .find((c) => (c[0] as { type: string }).type === type)!;
  return (call[0] as { payload: { ids: string[] } }).payload;
}

describe('ASSETS_OWNED emission', () => {
  beforeEach(() => {
    resetHarnessDom();
  });

  it('notifyReady sends IFRAME_READY then ASSETS_OWNED with held ids', () => {
    const bridge = mountBridgeForTest();
    bridge._assetMap = { a1: 'blob:x', a2: 'blob:y' };
    bridge.notifyReady();

    const types = sentTypes(bridge);
    expect(types.indexOf('IFRAME_READY')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('ASSETS_OWNED')).toBeGreaterThan(types.indexOf('IFRAME_READY'));
    expect(payloadOf(bridge, 'ASSETS_OWNED').ids.sort()).toEqual(['a1', 'a2']);
  });

  it('fresh boot (no assets) reports an empty list', () => {
    const bridge = mountBridgeForTest();
    bridge._assetMap = {};
    bridge.notifyReady();
    expect(payloadOf(bridge, 'ASSETS_OWNED').ids).toEqual([]);
  });
});
