import { splitSegment } from './penGeometry';
import type { PenAnchor, PenHandle, PenPath } from './penGeometry';

/** Fallback close-hit radius (iframe px) — callers pass a zoom-aware one via the event. */
const DEFAULT_CLOSE_RADIUS = 6;
/** Pointer travel below this during placement keeps the anchor a corner (no handles). */
const DRAG_THRESHOLD = 2;
const SNAP_STEP = Math.PI / 12; // 15°

export interface PenPointerEvent {
  type: 'pointerdown' | 'pointermove' | 'pointerup';
  x: number;
  y: number;
  alt: boolean;
  shift: boolean;
  /** Close-hit radius in iframe px — pass screen-px ÷ zoom so the target feels constant. */
  closeRadius?: number;
}

export type PenDrawEvent =
  | PenPointerEvent
  | { type: 'enter' }
  | { type: 'escape' }
  | { type: 'backspace' };

export interface PenDrawState {
  path: PenPath;
  /** Index of the anchor being placed (between pointerdown and pointerup). */
  placing: number | null;
  /** Last pointer position — the component's rubber-band endpoint. */
  cursor: { x: number; y: number } | null;
  committed: PenPath | null;
  cancelled: boolean;
}

export function initialDrawState(): PenDrawState {
  return { path: { anchors: [], closed: false }, placing: null, cursor: null, committed: null, cancelled: false };
}

/** Project `to` onto the 15°-snapped ray from `from`. */
export function snapAngle(from: { x: number; y: number }, to: { x: number; y: number }): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return to;
  const snapped = Math.round(Math.atan2(dy, dx) / SNAP_STEP) * SNAP_STEP;
  const ux = Math.cos(snapped);
  const uy = Math.sin(snapped);
  const len = dx * ux + dy * uy;
  return { x: from.x + ux * len, y: from.y + uy * len };
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
/** Mirror a handle across its anchor (`|| 0` normalizes -0 for test equality). */
const mirror = (h: PenHandle): PenHandle => ({ dx: -h.dx || 0, dy: -h.dy || 0 });

export function penDrawReducer(state: PenDrawState, event: PenDrawEvent): PenDrawState {
  if (state.committed || state.cancelled) return state; // terminal

  switch (event.type) {
    case 'enter': {
      if (state.path.anchors.length >= 2) {
        return { ...state, committed: { ...state.path, closed: false } };
      }
      return { ...state, cancelled: true };
    }
    case 'escape':
      return { ...state, cancelled: true };
    case 'backspace': {
      const { anchors } = state.path;
      if (anchors.length <= 1) return { ...state, cancelled: true };
      return { ...state, path: { ...state.path, anchors: anchors.slice(0, -1) }, placing: null };
    }
    case 'pointerdown': {
      const { anchors } = state.path;
      if (anchors.length >= 2 && dist(event, anchors[0]) <= (event.closeRadius ?? DEFAULT_CLOSE_RADIUS)) {
        return { ...state, committed: { anchors, closed: true } };
      }
      let pos = { x: event.x, y: event.y };
      if (event.shift && anchors.length > 0) pos = snapAngle(anchors[anchors.length - 1], pos);
      const anchor: PenAnchor = { x: pos.x, y: pos.y, corner: true };
      return {
        ...state,
        path: { ...state.path, anchors: [...anchors, anchor] },
        placing: anchors.length,
        cursor: pos,
      };
    }
    case 'pointermove': {
      // Nothing consumes the cursor until an anchor exists — skip the state
      // churn (armed-but-unused pen would re-render per mousemove otherwise).
      if (state.placing === null && state.path.anchors.length === 0) return state;
      if (state.placing === null) return { ...state, cursor: { x: event.x, y: event.y } };
      const anchors = state.path.anchors.slice();
      const a = anchors[state.placing];
      const dx = event.x - a.x;
      const dy = event.y - a.y;
      anchors[state.placing] =
        Math.hypot(dx, dy) > DRAG_THRESHOLD
          ? { ...a, corner: false, hOut: { dx, dy }, hIn: mirror({ dx, dy }) }
          : { ...a, corner: true, hOut: null, hIn: null };
      return { ...state, path: { ...state.path, anchors }, cursor: { x: event.x, y: event.y } };
    }
    case 'pointerup':
      return { ...state, placing: null };
  }
}

// ---------------------------------------------------------------------------
// Edit mode
// ---------------------------------------------------------------------------

export interface PenDragTarget {
  kind: 'anchor' | 'hIn' | 'hOut';
  index: number;
}

export type PenEditEvent =
  | PenPointerEvent
  | { type: 'drag-start'; target: PenDragTarget; x: number; y: number; alt: boolean; shift: boolean }
  | { type: 'toggle-anchor'; index: number }
  | { type: 'add-anchor'; segmentIndex: number; x: number; y: number }
  | { type: 'delete-anchor'; index: number };

export interface PenEditState {
  path: PenPath;
  /**
   * In-flight drag. px/py = pointer at drag-start; x0/y0 = the dragged POINT
   * (anchor or handle tip) at drag-start. Moves apply the pointer DELTA to
   * x0/y0 — grabbing a dot off-center never jumps it to the cursor.
   */
  drag: (PenDragTarget & { px: number; py: number; x0: number; y0: number }) | null;
  /** True once a delete leaves <2 anchors — caller removes the whole element. */
  deleted: boolean;
}

export function initialEditState(path: PenPath): PenEditState {
  return { path, drag: null, deleted: false };
}

/** Seed handles for a corner→smooth toggle: 1/3 of the way toward each neighbor. */
function seedHandles(anchors: PenAnchor[], index: number, closed: boolean): Pick<PenAnchor, 'hIn' | 'hOut'> {
  const n = anchors.length;
  const a = anchors[index];
  const prev = index > 0 ? anchors[index - 1] : closed ? anchors[n - 1] : null;
  const next = index < n - 1 ? anchors[index + 1] : closed ? anchors[0] : null;
  const toward = (t: PenAnchor | null) => (t ? { dx: (t.x - a.x) / 3, dy: (t.y - a.y) / 3 } : null);
  return { hIn: toward(prev), hOut: toward(next) };
}

export function penEditReducer(state: PenEditState, event: PenEditEvent): PenEditState {
  if (state.deleted) return state;

  switch (event.type) {
    case 'drag-start': {
      const a = state.path.anchors[event.target.index];
      if (!a) return state;
      let x0: number;
      let y0: number;
      if (event.target.kind === 'anchor') {
        x0 = a.x;
        y0 = a.y;
      } else {
        const h = event.target.kind === 'hOut' ? a.hOut : a.hIn;
        if (!h) return state;
        x0 = a.x + h.dx;
        y0 = a.y + h.dy;
      }
      return { ...state, drag: { ...event.target, px: event.x, py: event.y, x0, y0 } };
    }
    case 'pointermove': {
      if (!state.drag) return state;
      const anchors = state.path.anchors.slice();
      const { kind, index, px, py, x0, y0 } = state.drag;
      const a = anchors[index];
      if (!a) return state;
      // Grab-offset drag: new point = start point + pointer delta.
      let point = { x: x0 + (event.x - px), y: y0 + (event.y - py) };
      if (kind === 'anchor') {
        if (event.shift) point = snapAngle({ x: x0, y: y0 }, point);
        anchors[index] = { ...a, x: point.x, y: point.y };
      } else {
        // Shift constrains the handle ANGLE about its anchor.
        if (event.shift) point = snapAngle({ x: a.x, y: a.y }, point);
        const d = { dx: point.x - a.x, dy: point.y - a.y };
        const other = kind === 'hOut' ? 'hIn' : 'hOut';
        anchors[index] = { ...a, [kind]: d, ...(event.alt ? {} : { [other]: mirror(d) }) };
      }
      return { ...state, path: { ...state.path, anchors } };
    }
    case 'pointerup':
      return { ...state, drag: null };
    case 'pointerdown':
      return state; // drags begin via drag-start (component hit-tests chrome)
    case 'toggle-anchor': {
      const anchors = state.path.anchors.slice();
      const a = anchors[event.index];
      if (!a) return state;
      anchors[event.index] = a.corner
        ? { ...a, corner: false, ...seedHandles(anchors, event.index, state.path.closed) }
        : { ...a, corner: true, hIn: null, hOut: null };
      return { ...state, path: { ...state.path, anchors } };
    }
    case 'add-anchor': {
      const anchors = state.path.anchors.slice();
      const i = event.segmentIndex;
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      if (!a || !b) return state;
      // Shape-preserving split: straight segments project the click onto the
      // line; curves split via de Casteljau (rendered curve unchanged).
      const split = splitSegment(a, b, { x: event.x, y: event.y });
      anchors[i] = split.a;
      anchors[(i + 1) % anchors.length] = split.b;
      anchors.splice(i + 1, 0, split.mid);
      return { ...state, path: { ...state.path, anchors } };
    }
    case 'delete-anchor': {
      const anchors = state.path.anchors.filter((_, i) => i !== event.index);
      if (anchors.length < 2) return { ...state, deleted: true };
      return { ...state, path: { ...state.path, anchors }, drag: null };
    }
  }
}
