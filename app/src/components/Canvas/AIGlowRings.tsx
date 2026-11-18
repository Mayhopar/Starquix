/**
 * AI "working" rings — one glowing stroke per section an AI run is touching,
 * plus one around the stream-preview container while markup streams in.
 *
 * Drawn HERE, in the canvas, not in the preview iframe: the ring paints well
 * outside its own box (`--in` reaches -1.25×spread, plus a 3×spread blur) and
 * full-bleed sections sit flush with the iframe's edges, so an in-iframe ring
 * was always sliced off by the frame boundary. The canvas wrapper is
 * overflow-visible, so here the glow bleeds onto the editor background.
 * (It is still cut where the canvas COLUMN ends — see Canvas.tsx's
 * overflow-hidden scroll container and its 32px `pt-8` headroom.)
 *
 * Boxes arrive as AI_ACTIVE_RECTS / AI_PREVIEW_RECT from the bridge in
 * iframe-document coordinates — the same space every other overlay in
 * ViewportFrame uses, and stable without scroll sync because the design iframe
 * is sized to the whole page. Ring CSS: `glowRing.ts`.
 */
import { GLOW_CSS, GLOW_FILL, GLOW_LAYERS } from './glowRing';
import type { ElementRect, KeyedRect } from '@/bridge';

// Static across every ring and every render — built once.
const LAYERS = GLOW_LAYERS.map(layer => <div key={layer} className={`sq-ai-glow ${layer}`} />);

function Ring({ label, rect }: { label: string; rect: ElementRect }) {
  return (
    <div
      data-sq-ai-glow={label}
      className="absolute pointer-events-none rounded-lg z-[998]" // ui-lint-line: overlay stacking order (AI ring under slot chrome)
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height, background: GLOW_FILL }}
    >
      {LAYERS}
    </div>
  );
}

export function AIGlowRings({ rects, previewRect }: { rects: KeyedRect[]; previewRect?: ElementRect | null }) {
  if (rects.length === 0 && !previewRect) return null;
  return (
    <>
      <style>{GLOW_CSS}</style>
      {rects.map(({ key, rect }) => <Ring key={key} label={key} rect={rect} />)}
      {/* The streaming container is reported on its own channel — it grows per
          paint, while section rects only move per commit. */}
      {previewRect && <Ring label="preview" rect={previewRect} />}
    </>
  );
}
