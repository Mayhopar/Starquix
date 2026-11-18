/**
 * The footer's motion knobs: ONE file to tune how the surface moves.
 *
 * Closing/opening the panel is ONE continuous motion along a path (owner 2026-11-05: the old shrink moved width
 * and height together and passed through a hammer shape; a staged version stopped at the corner and stuttered):
 *
 *   m = 0  open (the panel at full size)  …  m = 1  closed (only the bar)
 *
 * Going 0 → 1 the width narrows to the bar's by `widthDoneAt` while the height starts to go at `heightStartsAt`
 * and does the REST of its shrinking after the width is the bar's. Opening walks the SAME path backwards: the
 * height comes up first, the width widens while it is still finishing. Time maps onto m with an ease-out, so the
 * click answers at once and the end settles softly.
 */

/** Tab ↔ tab resizes (and the bar's track): a long, soft landing instead of the stock ease-out. */
export const RESIZE_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

export const PANEL_MOTION = {
  closeMs: 220,
  openMs: 240,
  /** ease-out exponent of time → m (higher = faster start, softer landing) */
  closeCurve: 2.2,
  openCurve: 2.6,
  /** m at which the width has reached the bar's */
  widthDoneAt: 0.55,
  /** m at which the height starts to go (while the width is still shrinking) */
  heightStartsAt: 0.2,
  /** > 1: the height starts gently and does most of its dropping after the width is done */
  heightPow: 1.7,
  /** opening: the content fades in late in the motion, not while the panel is still a stub */
  contentDelayMs: 90,
  contentFadeMs: 150,
} as const;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** time 0..1 → eased progress 0..1 (fast start, soft landing) */
export const easeOut = (u: number, power: number) => 1 - (1 - clamp01(u)) ** power;

/** How far the width (px) and the height (py) have gone from open (0) to closed (1) at path position m. */
export function shapeProgress(m: number): { px: number; py: number } {
  const x = clamp01(m / PANEL_MOTION.widthDoneAt);
  const y = clamp01((m - PANEL_MOTION.heightStartsAt) / (1 - PANEL_MOTION.heightStartsAt));
  return { px: 1 - (1 - x) * (1 - x), py: y ** PANEL_MOTION.heightPow };
}

const NUM = /-?\d+(?:\.\d+)?/g;

/**
 * The outline between its open and closed shapes with SEPARATE progress for x and y (the CSS `d` transition moves
 * both in lockstep, which is the hammer). Both paths come from footerOutlinePath: the same command sequence, so
 * the numbers line up pairwise as (x, y).
 */
export function lerpPath(open: string, closed: string, px: number, py: number): string {
  const a = open.match(NUM)?.map(Number) ?? [];
  const b = closed.match(NUM)?.map(Number) ?? [];
  let i = 0;
  return open.replace(NUM, () => {
    const t = i % 2 === 0 ? px : py;
    const v = a[i] + ((b[i] ?? a[i]) - a[i]) * t;
    i++;
    return String(+v.toFixed(2));
  });
}
