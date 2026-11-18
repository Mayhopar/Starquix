import { buildPenMarkup, ellipsePenPath, roundPath, seedPathClasses, type PenAnchor, type PenPath } from './penGeometry';

export const SHAPE_KINDS = ['rect', 'ellipse', 'line', 'arrow', 'polygon'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export interface ShapeResult {
  classes: string;
  staticMarkup: string;
  /** PenPath JSON — same contract as pen-tool commits (task-109). */
  penPath: string;
}

const corner = (x: number, y: number): PenAnchor => ({ x, y, corner: true });

function shapePath(kind: ShapeKind, w: number, h: number, downSlope: boolean): PenPath {
  switch (kind) {
    case 'rect':
      return { anchors: [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)], closed: true };
    case 'ellipse':
      return ellipsePenPath(w / 2, h / 2, w / 2, h / 2);
    case 'line':
    case 'arrow': {
      const path: PenPath = {
        anchors: downSlope ? [corner(0, 0), corner(w, h)] : [corner(0, h), corner(w, 0)],
        closed: false,
      };
      if (kind === 'arrow') path.markerEnd = 'arrow';
      return path;
    }
    case 'polygon':
      return {
        anchors: [
          corner(0.25 * w, 0), corner(0.75 * w, 0), corner(w, 0.5 * h),
          corner(0.75 * w, h), corner(0.25 * w, h), corner(0, 0.5 * h),
        ],
        closed: true,
      };
  }
}

/**
 * Build penPath + derived markup + seed classes for a drawn shape.
 * Same model as pen commits: real-px coords, viewBox 1:1 at commit, path
 * carries no paint attrs — wrapper fill-* and stroke-* classes style it.
 */
export function buildShape(kind: ShapeKind, w: number, h: number, downSlope: boolean): ShapeResult {
  const path = roundPath(shapePath(kind, w, h, downSlope));
  return {
    classes: seedPathClasses(w, h, path.closed, false),
    staticMarkup: buildPenMarkup(path, w, h),
    penPath: JSON.stringify(path),
  };
}
