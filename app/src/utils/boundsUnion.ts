/**
 * Union of child rects. Testable extract of the algorithm the bridge
 * inlines as `rectOf` (the bridge runs as a string inside the iframe and
 * can't import). Keep the two implementations in sync.
 */

export interface SimpleRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Returns `null` when every rect is empty so the caller can pick a fallback. */
export function unionRect(childRects: readonly SimpleRect[]): SimpleRect | null {
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let any = false;
  for (const cr of childRects) {
    if (cr.width === 0 && cr.height === 0) continue;
    any = true;
    if (cr.top < top) top = cr.top;
    if (cr.left < left) left = cr.left;
    if (cr.top + cr.height > bottom) bottom = cr.top + cr.height;
    if (cr.left + cr.width > right) right = cr.left + cr.width;
  }
  return any ? { top, left, width: right - left, height: bottom - top } : null;
}
