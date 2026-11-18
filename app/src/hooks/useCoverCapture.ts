import { useCallback, useEffect, useRef } from 'react';
import { db } from '@/db';

interface UseCoverCaptureOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  projectId: string;
}

const CAPTURE_TIMEOUT_MS = 5000;
const CAPTURE_WIDTH = 800;

/** Convert a data URL to an ArrayBuffer (more reliable in IndexedDB than Blob). */
function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const binary = atob(dataUrl.split(',')[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** The ONE place the cover-screenshot asset-id convention lives. */
export function coverAssetId(projectId: string): string {
  return `cover_${projectId}`;
}

export function isCoverAssetId(id: string): boolean {
  return id.startsWith('cover_');
}

/**
 * Hook to capture a screenshot from the editor iframe and save it as a cover image.
 * Sends CAPTURE_SCREENSHOT to the iframe bridge, receives the data URL response,
 * and stores the blob in the DBAsset table.
 */
export function useCoverCapture({ iframeRef, projectId }: UseCoverCaptureOptions) {
  const resolveRef = useRef<((success: boolean) => void) | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'SCREENSHOT_CAPTURED' && resolveRef.current) {
        const { dataUrl } = data.payload;
        const buffer = dataUrlToArrayBuffer(dataUrl);

        db.assets.put({
          id: coverAssetId(projectId),
          projectId,
          name: 'cover',
          mimeType: 'image/jpeg',
          blob: buffer,
          createdAt: new Date(),
        }).then(() => {
          resolveRef.current?.(true);
          resolveRef.current = null;
        }).catch((err) => {
          console.error('[useCoverCapture] Failed to save cover:', err);
          resolveRef.current?.(false);
          resolveRef.current = null;
        });
      }

      if (data.type === 'SCREENSHOT_FAILED' && resolveRef.current) {
        console.warn('[useCoverCapture] Screenshot failed:', data.payload?.error);
        resolveRef.current(false);
        resolveRef.current = null;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [projectId]);

  const captureScreenshot = useCallback((): Promise<boolean> => {
    const iframe = iframeRef.current;
    console.log('[useCoverCapture] captureScreenshot called, iframe:', !!iframe, 'contentWindow:', !!iframe?.contentWindow);
    if (!iframe?.contentWindow) {
      return Promise.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;

      console.log('[useCoverCapture] Posting CAPTURE_SCREENSHOT to iframe');
      iframe.contentWindow!.postMessage({
        type: 'CAPTURE_SCREENSHOT',
        payload: {
          width: CAPTURE_WIDTH,
        },
      }, '*');

      // Timeout: resolve false if no response
      setTimeout(() => {
        if (resolveRef.current === resolve) {
          resolveRef.current = null;
          resolve(false);
        }
      }, CAPTURE_TIMEOUT_MS);
    });
  }, [iframeRef]);

  return { captureScreenshot };
}
