/**
 * Conic glow ring — the AI "working" stroke.
 *
 * Rendered only by the editor canvas (ViewportFrame → AIGlowRings) — for the
 * sections an AI run is touching AND for the stream-preview container. Nothing
 * inside the iframe draws it any more: the ring paints OUTSIDE its box (--in
 * reaches -1.25×spread, plus a 3×spread blur) and full-bleed sections sit flush
 * with the iframe's edges, so an in-iframe ring was always sliced by the frame
 * boundary. Over the canvas it bleeds onto the editor background instead.
 *
 * Geometry: 3 depths (crisp edge / wash / bloom) × 2 counter-phases from ONE
 * gradient. The +180° copies average out the fast-side/slow-side wobble of
 * center-based conic rotation on wide boxes. Ring-only: a mask-exclude band
 * keeps the interior clean.
 *
 * Knobs: --sq-ai-hue = base "r, g, b" (also the stream-preview caret fill);
 * --sq-ai-hue-1/-3/-4 = light/mid/deep steps of the SAME blue — B pinned at
 * 255, only R/G drop. Dropping B desaturates toward slate and reads dirty.
 * --sq-ai-spread = one size knob; every inset/band/blur derives from it.
 * Colors + spread were tuned in stroke-playground.html (which has no mask —
 * the ring band is tuned here).
 */

/** The six ring layers, in paint order. */
export const GLOW_LAYERS = ['l1', 'l2', 'l3', 'l1 b', 'l2 b', 'l3 b'] as const;

const c1 = 'rgba(var(--sq-ai-hue-1,150,204,255),';
const c2 = 'rgba(var(--sq-ai-hue,95,170,255),';
const c3 = 'rgba(var(--sq-ai-hue-3,45,134,255),';
const c4 = 'rgba(var(--sq-ai-hue-4,0,96,255),';
const s = 'var(--sq-ai-spread,20px)';

// Inlined verbatim into a <style> tag by AIGlowRings.
export const GLOW_CSS =
  '@property --sq-angle{syntax:"<angle>";initial-value:0deg;inherits:false}' +
  // Layer = the playground's exactly: whole box filled with the conic gradient
  // and blurred, nothing masked. The playground keeps its interior clean with
  // an OPAQUE .box::after painted on top; we sit over live page content and
  // can't cover it, so the interior is removed by clip-path instead.
  '.sq-ai-glow{position:absolute;pointer-events:none;box-sizing:border-box;border-radius:8px;' +
  'inset:var(--in);filter:blur(var(--soft));opacity:calc(var(--o)*var(--ph,1));' +
  'background:conic-gradient(from calc(var(--sq-angle) + var(--p,0deg)),' +
  c1 + '1) 0%,' + c2 + '0.06) 18%,' + c3 + '0.13) 55%,' + c4 + '0.35) 86%,' + c1 + '1) 100%);' +
  // Even-odd hole at the SECTION border (each layer sits --in outside it, so the
  // hole is calc(-1*--in) in from its own edges). Both loops are closed or the
  // seam between them paints as a wedge (live 2026-07-26).
  // The outer boundary is parked 400px out — far beyond the widest bloom
  // (3x--spread of blur) — so it never shears the glow. That shear is exactly
  // what the old mask-composite ring did: a mask clips its element's paint to
  // the mask box, cutting the bloom off at a hard square edge 1.25x--spread
  // outside the section. That edge WAS the "stroke is still cropped" report.
  'clip-path:polygon(evenodd,' +
  '-400px -400px,calc(100% + 400px) -400px,calc(100% + 400px) calc(100% + 400px),-400px calc(100% + 400px),-400px -400px,' +
  'calc(-1*var(--in)) calc(-1*var(--in)),calc(-1*var(--in)) calc(100% + var(--in)),' +
  'calc(100% + var(--in)) calc(100% + var(--in)),calc(100% + var(--in)) calc(-1*var(--in)),' +
  'calc(-1*var(--in)) calc(-1*var(--in)));' +
  'animation:sq-glow-spin 7s linear infinite}' +
  '@keyframes sq-glow-spin{to{--sq-angle:360deg}}' +
  '.sq-ai-glow.l1{--in:calc(-.25*' + s + ');--soft:calc(.5*' + s + ');--o:.9}' +
  '.sq-ai-glow.l2{--in:calc(-.5*' + s + ');--soft:calc(1.25*' + s + ');--o:.5}' +
  '.sq-ai-glow.l3{--in:calc(-1.25*' + s + ');--soft:calc(3*' + s + ');--o:.3}' +
  '.sq-ai-glow.b{--p:180deg;--ph:.5}' +
  '@media (prefers-reduced-motion: reduce){.sq-ai-glow{animation:none}}';

/** Flat wash under the ring — the "AI is holding this section" fill. */
export const GLOW_FILL = 'rgba(217,217,217,0.1)';
