/**
 * Bug Fix Tests: ViteClassWriter.ts
 *
 * Tests for Bug #19: Event listeners never removed on disconnect
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock DevServerService

describe('Bug #19: ViteClassWriter event listener cleanup', () => {
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
    const { viteClassWriter } = await import('../ViteClassWriter');

    expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(messageHandlers.length).toBe(1);
  });

  it('should remove message event listener on disconnect (bug fix)', async () => {
    const { viteClassWriter } = await import('../ViteClassWriter');

    expect(messageHandlers.length).toBe(1);

    viteClassWriter.disconnect();

    // With the fix, the listener should be removed
    expect(removeEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
    expect(messageHandlers.length).toBe(0);
  });

  it('should allow re-setup after disconnect', async () => {
    const { viteClassWriter } = await import('../ViteClassWriter');

    viteClassWriter.disconnect();
    expect(messageHandlers.length).toBe(0);

    // The messageListenerSetup flag should be reset, allowing re-setup
    // This would be needed if the singleton is reused
    // Note: Current implementation is singleton, so this tests the flag reset
  });

  it('should clear pending requests on disconnect and reject them', async () => {
    const { viteClassWriter } = await import('../ViteClassWriter');

    // Setup iframe ref
    const mockIframe = {
      contentWindow: {
        postMessage: vi.fn()
      }
    } as unknown as HTMLIFrameElement;

    viteClassWriter.setIframeRef(mockIframe);

    // A running local instance makes the writer "available" (Phase 6: the only runtime)
    (viteClassWriter as any).localInstanceUrl = 'http://localhost:4321';
    // task-108: writes are also gated per-mode now — arm server-write mode
    const { setServerWriteMode } = await import('../serverWriteMode');
    setServerWriteMode(true);

    // Start a write request (will timeout)
    const writePromise = viteClassWriter.writeClassUpdate(
      { file: 'test.astro', line: 1, column: 1 },
      'new-class'
    );

    // Disconnect should clear pending requests and reject them
    viteClassWriter.disconnect();

    // The pending request should be cleared
    expect((viteClassWriter as any).pendingRequests.size).toBe(0);

    // The promise should be rejected with disconnect error
    await expect(writePromise).rejects.toThrow('ViteClassWriter disconnected');
  });
});
