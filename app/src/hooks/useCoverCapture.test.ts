import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCoverCapture } from './useCoverCapture';

// Mock db
const mockPut = vi.fn();
vi.mock('@/db', () => ({
  db: {
    assets: {
      put: (...args: unknown[]) => mockPut(...args),
    },
  },
}));

describe('useCoverCapture', () => {
  let messageHandler: ((event: MessageEvent) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    // Capture the message event handler
    vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
      if (type === 'message') messageHandler = handler as (event: MessageEvent) => void;
    });
    vi.spyOn(window, 'removeEventListener').mockImplementation(() => {});
  });

  afterEach(() => {
    messageHandler = null;
  });

  it('sends CAPTURE_SCREENSHOT to iframe and saves blob on success', async () => {
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;

    mockPut.mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useCoverCapture({ iframeRef: { current: mockIframe }, projectId: 'browser_123' })
    );

    // Trigger capture
    let capturePromise: Promise<boolean>;
    act(() => {
      capturePromise = result.current.captureScreenshot();
    });

    // Verify postMessage was sent
    expect(mockIframe.contentWindow!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CAPTURE_SCREENSHOT' }),
      '*'
    );

    // Simulate iframe response
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    await act(async () => {
      messageHandler?.({
        data: { type: 'SCREENSHOT_CAPTURED', payload: { dataUrl } },
      } as MessageEvent);
    });

    const success = await capturePromise!;
    expect(success).toBe(true);
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'cover_browser_123',
        projectId: 'browser_123',
        name: 'cover',
        mimeType: 'image/jpeg',
      })
    );
  });

  it('returns false on timeout', async () => {
    vi.useFakeTimers();
    const mockIframe = {
      contentWindow: { postMessage: vi.fn() },
    } as unknown as HTMLIFrameElement;

    const { result } = renderHook(() =>
      useCoverCapture({ iframeRef: { current: mockIframe }, projectId: 'browser_123' })
    );

    let capturePromise: Promise<boolean>;
    act(() => {
      capturePromise = result.current.captureScreenshot();
    });

    // Advance past timeout
    await act(async () => {
      vi.advanceTimersByTime(5100);
    });

    const success = await capturePromise!;
    expect(success).toBe(false);
    expect(mockPut).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('returns false when iframe ref is null', async () => {
    const { result } = renderHook(() =>
      useCoverCapture({ iframeRef: { current: null }, projectId: 'browser_123' })
    );

    let success: boolean;
    await act(async () => {
      success = await result.current.captureScreenshot();
    });

    expect(success!).toBe(false);
  });
});
