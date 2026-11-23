/**
 * Hover + rect tracking messages. Covers both the legacy preview messages
 * (ELEMENT_HOVERED / ELEMENT_RECT — fields at the top level of event.data)
 * and the IFrameBridge messages (payload-wrapped).
 */
import { isSelectionResolving } from './scanning';
import type { ElementRect, KeyedRect, ElementHoverPayload, RectUpdatedPayload, RectsUpdatedPayload } from '@/bridge';
import type { ViewportMessageContext } from './context';
import { altKeyStore } from '../hoverRectStore';

export function handleElementHover(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as ElementHoverPayload;
  ctx.actions.setHoveredRect({ rect: p.rect, key: p.key, tagName: p.tagName, ...(p.computedStyles ? { computedStyles: p.computedStyles } : {}) });
}

/** Option state relayed from a focused iframe (MeasureOverlay). */
export function handleAltKey(_ctx: ViewportMessageContext, payload: unknown): void {
  altKeyStore.set(!!(payload as { down?: boolean }).down);
}

export function handleElementHoverEnd(ctx: ViewportMessageContext): void {
  ctx.actions.setHoveredRect(null);
}

/** Legacy preview message — rect lives at the top level of event.data; no key/tagName available. */
export function handleElementHovered(ctx: ViewportMessageContext, _payload: unknown, event: MessageEvent): void {
  const rect = (event.data as { rect?: ElementRect }).rect;
  ctx.actions.setHoveredRect(rect ? { rect } : null);
}

/** Legacy preview message — elementId/rect live at the top level of event.data. */
export function handleElementRect(ctx: ViewportMessageContext, _payload: unknown, event: MessageEvent): void {
  const { elementId: respElementId, rect } = event.data as { elementId: string; rect: ElementRect | null };
  if (respElementId === ctx.refs.selectedElementId.current && rect) {
    ctx.actions.updateSelectionRect(rect);
  }
}

export function handleElementRectResponse(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as { key?: string; rect?: ElementRect } | undefined;
  if (p?.key === ctx.refs.selectedKey.current && p?.rect) {
    ctx.actions.updateSelectionRect(p.rect);
  }
  // AI chip hover highlight
  if (p?.key && p?.key === ctx.refs.aiHighlightKey.current && p?.rect) {
    ctx.actions.setHoveredRect({ rect: p.rect, key: p.key });
  }
}

/**
 * Section rects an AI run is touching — the canvas draws the glow rings from
 * these (AIGlowRings). Empty array = run finished, clear them.
 */
export function handleAIActiveRects(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as { rects?: KeyedRect[] } | undefined;
  ctx.actions.setAIGlowRects(p?.rects ?? []);
}

/** Stream-preview container box — the canvas rings it (AIGlowRings). */
export function handleAIPreviewRect(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as { rect?: ElementRect | null } | undefined;
  ctx.actions.setAIPreviewRect(p?.rect ?? null);
}

export function handleRectUpdated(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as RectUpdatedPayload;
  // Only the SELECTED element's reflow may move the selection overlay.
  // RECT_UPDATED fires for every class re-apply (override sync bursts touch
  // every overridden selector of an element), and an unguarded update snapped
  // the selection box to whichever element reported LAST (live-caught: svg
  // selected, box drawn over a sibling). Keyless payloads keep legacy behavior.
  if (!p.key || p.key === ctx.refs.selectedKey.current) {
    ctx.actions.updateSelectionRect(p.rect);
  }
  // When a grid refresh is pending for this key, the iframe has now reflowed
  // after the class update, so request fresh grid geometry.
  if (p.key && p.key === ctx.refs.pendingGridRefreshKey.current) {
    ctx.refs.pendingGridRefreshKey.current = null;
    ctx.refs.iframe.current?.contentWindow?.postMessage(
      { type: 'REQUEST_GRID_GEOMETRY', payload: { key: p.key } }, '*',
    );
  }
}

export function handleRectsUpdated(ctx: ViewportMessageContext, payload: unknown): void {
  const p = payload as RectsUpdatedPayload;
  ctx.actions.updateScannedElementRects(p.rects);
  // Keep selection overlay in sync when selected element reflows (not while a
  // structural edit's selection resolves: the old key may name a neighbour now).
  if (ctx.refs.selectedKey.current && !isSelectionResolving()) {
    const match = p.rects.find(r => r.key === ctx.refs.selectedKey.current);
    if (match) {
      ctx.actions.updateSelectionRect(match.rect);
    }
  }
}
