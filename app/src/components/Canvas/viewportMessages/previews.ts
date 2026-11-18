/**
 * Preview-thumbnail messages: the bridge captures bg-image / <img> preview
 * data URLs (on ELEMENT_CLICK and on REQUEST_PREVIEW_REFRESH) and posts them
 * here; we forward them into SelectionContext for the DesignBar thumbnails.
 */
import type { BgImagePreviewPayload, ImagePreviewRefreshPayload } from '@/bridge';
import type { ViewportMessageContext } from './context';

export function handleBgImagePreview(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as BgImagePreviewPayload;
  ctx.actions.updateBgImagePreview(p.key, p.dataUrl);
}

export function handleImagePreviewRefresh(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as ImagePreviewRefreshPayload;
  ctx.actions.updateImagePreview(p.key, p.dataUrl);
}
