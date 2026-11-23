import { Fragment } from 'react';
import type { ElementRect } from '@/bridge';
import { measureGaps, type Segment } from './measureGaps';

// Inside the zoomed #canvas-content: hairlines and labels counter-scale by the live --sq-inv-scale.
const INV = 'var(--sq-inv-scale, 1)';
const HAIRLINE = `calc(${INV} * 1px)`;

function box({ x1, y1, x2, y2 }: Segment, offset: { x: number; y: number }): React.CSSProperties {
  return {
    left: Math.min(x1, x2) + offset.x,
    top: Math.min(y1, y2) + offset.y,
    width: y1 === y2 ? Math.abs(x2 - x1) : 0,
    height: x1 === x2 ? Math.abs(y2 - y1) : 0,
  };
}

/** Figma-style: hold Option with a selection, hover another box → distances between them (SelectionOverlay gates on Option). */
export function MeasureOverlay({ selected, hovered, offset }: {
  selected: ElementRect; hovered: ElementRect; offset: { x: number; y: number };
}) {
  const { gaps, guides } = measureGaps(selected, hovered);
  return (
    <>
      {guides.map((g, i) => (
        <div
          key={`guide-${i}`}
          data-testid="measure-guide"
          className="absolute pointer-events-none border-dashed border-overlay-measure z-[1001]" // ui-lint-line: overlay stacking order (measure above selection)
          style={{ ...box(g, offset), [g.x1 === g.x2 ? 'borderLeftWidth' : 'borderTopWidth']: HAIRLINE }}
        />
      ))}
      {gaps.map((g, i) => {
        const horizontal = g.y1 === g.y2;
        return (
          <Fragment key={`gap-${i}`}>
            <div
              data-testid="measure-line"
              className="absolute pointer-events-none bg-overlay-measure z-[1001]" // ui-lint-line: overlay stacking order (measure above selection)
              style={{
                ...box(g, offset),
                [horizontal ? 'height' : 'width']: HAIRLINE,
                transform: horizontal ? 'translateY(-50%)' : 'translateX(-50%)',
              }}
            />
            {/* 0×0 anchor at the line's midpoint, scaled back to screen px; the label sits just below / right of the line */}
            <div
              className="absolute pointer-events-none z-[1001]" // ui-lint-line: overlay stacking order (measure above selection)
              style={{
                left: (g.x1 + g.x2) / 2 + offset.x,
                top: (g.y1 + g.y2) / 2 + offset.y,
                transform: `scale(${INV})`,
                transformOrigin: '0 0',
              }}
            >
              <div
                className={`absolute px-1 rounded-inner bg-overlay-measure text-overlay-measure-text text-2xs tabular-nums whitespace-nowrap ${horizontal ? 'top-1 -translate-x-1/2' : 'left-1 -translate-y-1/2'}`}
                data-testid="measure-label"
              >
                {Math.round(g.value * 10) / 10}
              </div>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}
