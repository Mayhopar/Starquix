/**
 * Bug Fix Tests: ViteTextWriter.ts
 *
 * Tests for Bug #20: Event listeners never removed on disconnect
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DevServerService

describe('Bug #20: ViteTextWriter event listener cleanup', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let messageHandlers: ((event: MessageEvent) => void)[] = [];

  beforeEach(() => {
    messageHandlers = [];

    addEventListenerSpy = vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'message') {
        messageHandlers.push(handler as (event: MessageEvent) => void);
      }
    });

    removeEventListenerSpy = vi.spyOn(window, 'removeEventListener').mockImplementation((type, handler) => {
      if (type === 'message') {
        const index = messageHandlers.indexOf(handler as (event: MessageEvent) => void);
        if (index > -1) {
          messageHandlers.splice(index, 1);
        }
      }
    });

    // Reset module cache to get fresh instance
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('should add message event listener on construction', async () => {
    const { viteTextWriter } = await import('../ViteTextWriter');

    expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(messageHandlers.length).toBe(1);
  });

  it('should remove message event listener on disconnect (bug fix)', async () => {
    const { viteTextWriter } = await import('../ViteTextWriter');

    expect(messageHandlers.length).toBe(1);

    viteTextWriter.disconnect();

    // With the fix, the listener should be removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(messageHandlers.length).toBe(0);
  });

  it('writeTextUpdate self-gates: resolves false without a send when unavailable (design 2026-06-11 §1.3)', async () => {
    const { viteTextWriter } = await import('../ViteTextWriter');

    const mockIframe = {
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;
    viteTextWriter.setIframeRef(mockIframe);
    // Dev default: no astroServerUrl → writer unavailable
    expect(viteTextWriter.isAvailable()).toBe(false);

    await expect(
      viteTextWriter.writeTextUpdate({ file: 'test.astro', line: 1, column: 1 }, 'x'),
    ).resolves.toBe(false);

    // The gate short-circuits before sendViaPostMessage — nothing posted
    expect(mockIframe.contentWindow!.postMessage).not.toHaveBeenCalled();
  });

  it('should clear pending requests on disconnect and reject them', async () => {
    const { viteTextWriter } = await import('../ViteTextWriter');

    // Setup iframe ref
    const mockIframe = {
      contentWindow: {
        postMessage: vi.fn()
      }
    } as unknown as HTMLIFrameElement;

    viteTextWriter.setIframeRef(mockIframe);

    // A running local instance makes the writer "available" (Phase 6: the only runtime)
    (viteTextWriter as any).localInstanceUrl = 'http://localhost:4321';
    // task-108: writes are also gated per-mode now — arm server-write mode
    const { setServerWriteMode } = await import('../serverWriteMode');
    setServerWriteMode(true);

    // Start a write request (will timeout)
    const writePromise = viteTextWriter.writeTextUpdate(
      { file: 'test.astro', line: 1, column: 1 },
      'new text content'
    );

    // Disconnect should clear pending requests and reject them
    viteTextWriter.disconnect();

    // The pending request should be cleared
    expect((viteTextWriter as any).pendingRequests.size).toBe(0);

    // The promise should be rejected with disconnect error
    await expect(writePromise).rejects.toThrow('ViteTextWriter disconnected');
  });
});
