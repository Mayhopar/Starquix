// Covers IFrameBridge.prototype.handleGetElementCopyHtml (lint-test-coverage rule 2).
import { describe, it, expect, beforeEach } from 'vitest';
import { mountBridgeForTest, resetHarnessDom, type HarnessBridge } from './harness';

type CopyBridge = HarnessBridge & {
  handleGetElementCopyHtml: (p: { key: string; requestId: string }) => void;
};

let bridge: CopyBridge;

const lastReply = () => {
  const calls = (bridge.sendToParent as unknown as { mock: { calls: Array<[{ type: string; payload?: unknown }]> } })
    .mock.calls.filter(c => c[0]?.type === 'ELEMENT_COPY_HTML');
  return calls.length ? (calls[calls.length - 1][0].payload as { requestId: string; key: string; html: string | null }) : null;
};

beforeEach(() => {
  resetHarnessDom();
  bridge = mountBridgeForTest() as CopyBridge;
});

describe('handleGetElementCopyHtml', () => {
  it('replies with cleaned outerHTML for a found element', () => {
    document.body.innerHTML =
      `<section data-key="k1" data-sq-id="sdeadbeefdeadbeef" data-sq-source="f:1:1" contenteditable="true" class="p-2"><span data-key="k1:span-0">t</span></section>`;
    bridge.handleGetElementCopyHtml({ key: 'k1', requestId: 'r' });
    const reply = lastReply();
    expect(reply).not.toBeNull();
    expect(reply!.requestId).toBe('r');
    expect(reply!.html).toContain('class="p-2"');
    expect(reply!.html).not.toContain('data-key');
    expect(reply!.html).not.toContain('data-sq-id');
    expect(reply!.html).not.toContain('data-sq-source');
    expect(reply!.html).not.toContain('contenteditable');
    // live DOM untouched
    expect(document.body.innerHTML).toContain('data-sq-id');
  });

  it('replies html:null for a missing key (always-reply law)', () => {
    bridge.handleGetElementCopyHtml({ key: 'nope', requestId: 'r2' });
    expect(lastReply()).toEqual({ requestId: 'r2', key: 'nope', html: null });
  });

  it('ignores invalid payloads without throwing', () => {
    expect(() => bridge.handleGetElementCopyHtml({} as never)).not.toThrow();
  });
});
