import { memo } from 'react';
import { useGrid } from './gridPreferences';

// The visual alignment grid over the artboard (top-bar Grid chip → gridPreferences).
// Sibling of PixelGridOverlay in ViewportFrame: absolute over the whole artboard, no
// z-index (so every selection/slot chrome stays above it), pointer-events-none.
// It sits inside #canvas-content, so zoom scales it; hairline width and the density
// fade read the live --sq-inv-scale (Canvas writes it in the rAF path), so nothing
// runs in JS during a zoom gesture. Design: docs/plans/2026-11-16-layout-grid-design.md

/** Square lines' strength over any site background; the hue is the --color-overlay-grid token. */
const LINE_PCT = 30;
/** A square grid fades out as its on-screen pitch (size × zoom) shrinks: opaque from 6px, gone at 3px. */
const FADE_FULL_PX = 6;
const FADE_GONE_PX = 3;

const INV = 'var(--sq-inv-scale, 1)';

function squareStyle(size: number): React.CSSProperties {
  const line = `color-mix(in oklab, var(--color-overlay-grid) ${LINE_PCT}%, transparent)`;
  const w = `calc(${INV} * 1px)`; // a hairline is 1 SCREEN px at any zoom
  return {
    backgroundImage:
      `linear-gradient(to right, ${line} ${w}, transparent ${w}), ` +
      `linear-gradient(to bottom, ${line} ${w}, transparent ${w})`,
    backgroundSize: `${size}px ${size}px`,
    opacity: `clamp(0, calc((${size} / ${INV} - ${FADE_GONE_PX}) / ${FADE_FULL_PX - FADE_GONE_PX}), 1)`,
  };
}

// memo: ViewportFrame re-renders on every selection and scan; the one prop is a string and the store drives the rest.
export const LayoutGridOverlay = memo(function LayoutGridOverlay({ projectId }: { projectId: string | null }) {
  const g = useGrid(projectId);
  if (!g.on) return null;
  return (
    <div
      data-testid="layout-grid-overlay"
      aria-hidden
      className="absolute inset-0 overflow-hidden pointer-events-none"
      style={g.type === 'square' ? squareStyle(g.size) : undefined}
    >
      {g.type === 'columns' && (
        // Margins and gutters collapse the stripes the way CSS would when they do not fit — nothing is drawn, no error.
        <div className="absolute inset-0 flex" style={{ paddingInline: g.margin, columnGap: g.gutter }}>
          {Array.from({ length: g.count }, (_, i) => (
            <div key={i} className="flex-1 min-w-0 bg-overlay-grid/15" />
          ))}
        </div>
      )}
    </div>
  );
});
