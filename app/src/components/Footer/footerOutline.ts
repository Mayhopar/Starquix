/**
 * The footer's ONE surface — the active tab's panel on top of the control bar,
 * joined by concave fillets — as ONE closed SVG path.
 *
 * Every state (T = panel + bar, or the bare bar pill) is emitted with the SAME
 * command sequence, so the CSS `d` transition morphs any state into any other:
 * one anti-aliased outline that cannot come apart mid-motion (owner,
 * 2026-10-12: separate boxes + gradient fillets showed jagged edges and
 * detached joints while moving).
 *
 * Origin = bottom-centre of the bar, y up is negative. Coordinates sit on the
 * centre of the old 1px borders (inset 0.5) so a 1px stroke lands on exactly
 * those pixels. The panel overlaps the bar by 1px (-mt-px): its bottom border
 * row is the bar's top border row.
 */

export const OUTLINE_RADIUS = 12; // rounded-xl

export interface FooterOutlineGeometry {
  /** The control bar's border box. */
  bar: { w: number; h: number };
  /** The panel's border box, or null when only the bar is shown. */
  panel: { w: number; h: number; squareTopLeft?: boolean } | null;
}

type Pt = [number, number];
const K = 0.5523; // cubic handle for a quarter circle
const n = (v: number) => (Math.abs(v) < 1e-6 ? 0 : +v.toFixed(2));
const pt = ([x, y]: Pt) => `${n(x)} ${n(y)}`;

/** Quarter-circle-ish corner from p0 to p3 around the tangent intersection v. */
function corner(p0: Pt, v: Pt, p3: Pt): string {
  const p1: Pt = [p0[0] + (v[0] - p0[0]) * K, p0[1] + (v[1] - p0[1]) * K];
  const p2: Pt = [p3[0] + (v[0] - p3[0]) * K, p3[1] + (v[1] - p3[1]) * K];
  return `C ${pt(p1)} ${pt(p2)} ${pt(p3)}`;
}

export function footerOutlinePath({ bar, panel }: FooterOutlineGeometry): string {
  const R = OUTLINE_RADIUS;
  const b = bar.w / 2 - 0.5;
  const yb = -0.5;
  const barTop = -bar.h + 0.5;
  const rb = Math.min(R, b, (bar.h - 1) / 2);

  let a: number, yt: number, yj: number, rtr: number, rtl: number, rs: number, rf: number;
  if (panel) {
    a = Math.max(b, panel.w / 2 - 0.5);
    yj = barTop; // panel bottom border = bar top border
    yt = yj - (panel.h - 1);
    const wing = a - b;
    rs = Math.min(R, wing / 2, (yj - yt) / 2); // panel's convex corner over the wing
    rf = Math.min(R, wing / 2, (yb - yj - rb) / 2); // concave fillet into the bar
    rtr = Math.min(R, a, yj - yt - rs);
    rtl = panel.squareTopLeft ? 0 : rtr;
  } else {
    // bare pill: the joint collapses to a point right under the top corners
    a = b;
    yt = barTop;
    rtr = rtl = Math.min(R, b, (yb - yt - rb) / 2);
    yj = yt + rtr;
    rs = rf = 0;
  }

  return [
    `M 0 ${n(yt)}`,
    `L ${pt([a - rtr, yt])}`, corner([a - rtr, yt], [a, yt], [a, yt + rtr]),
    `L ${pt([a, yj - rs])}`, corner([a, yj - rs], [a, yj], [a - rs, yj]),
    `L ${pt([b + rf, yj])}`, corner([b + rf, yj], [b, yj], [b, yj + rf]),
    `L ${pt([b, yb - rb])}`, corner([b, yb - rb], [b, yb], [b - rb, yb]),
    `L ${pt([-(b - rb), yb])}`, corner([-(b - rb), yb], [-b, yb], [-b, yb - rb]),
    `L ${pt([-b, yj + rf])}`, corner([-b, yj + rf], [-b, yj], [-(b + rf), yj]),
    `L ${pt([-(a - rs), yj])}`, corner([-(a - rs), yj], [-a, yj], [-a, yj - rs]),
    `L ${pt([-a, yt + rtl])}`, corner([-a, yt + rtl], [-a, yt], [-(a - rtl), yt]),
    'Z',
  ].join(' ');
}
