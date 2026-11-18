import type { ScannedElement } from '@/context/SelectionContext';
import { isComponentInstanceContainerKey, isWrapperKey } from '@/store/keyKind';
import { isLayoutSlotKey } from '@/utils/layoutChromeKeys';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface InsertionTarget {
  parentKey: string | null;
  insertIndex: number;
  relativeX: number;
  relativeY: number;
}

/**
 * Find the deepest container that fully contains the drawn rect.
 * Returns insertion target with position relative to the parent.
 *
 * When `lockInstances` is true (task-069 A2), component/theme instance
 * containers (`el-…`) are excluded so a draw over an instance lands on the
 * nearest non-instance ancestor (page-source `file:line:col` or a drawn
 * container), or page root (`null`) if none. Instances are locked — they never
 * parent a foreign drawn element. Gated OFF in the component editor (the master
 * CAN receive drops, via the editor write-back path).
 */
export function findInsertionTarget(
  drawnRect: Rect,
  scannedElements: ScannedElement[],
  lockInstances = false
): InsertionTarget {
  const drawnRight = drawnRect.left + drawnRect.width;
  const drawnBottom = drawnRect.top + drawnRect.height;

  // Filter to elements that fully contain the drawn rect
  const containers = scannedElements.filter(el => {
    // The infra page-wrapper (#sq-components, [pageId].astro) is NEVER a content
    // parent on any page. Excluding it maps a blank-canvas draw to parentKey=null
    // (which bake + export already treat as top-level) instead of the wrapper key
    // (which the editor bake silently drops). task-078.
    if (isWrapperKey(el.key)) return false;
    // A literal <slot> is a compile-time placeholder, never a container
    // (2026-08-26): in the layout master it spans the whole band, won the
    // deepest pick, and the drawn chrome nested INSIDE it — unreachable by
    // normal click and mis-shelved under the slot in Layers. A FILLED slot
    // scans as its wrapper <div data-sq-slot> and still parents normally.
    if (el.tagName === 'slot') return false;
    // Instances can't parent a drawn element when locked — skip them so the
    // search falls through to the nearest non-instance ancestor.
    if (lockInstances && isComponentInstanceContainerKey(el.key)) return false;
    const elRight = el.rect.left + el.rect.width;
    const elBottom = el.rect.top + el.rect.height;
    return (
      el.rect.left <= drawnRect.left &&
      el.rect.top <= drawnRect.top &&
      elRight >= drawnRight &&
      elBottom >= drawnBottom
    );
  });

  // Deepest-container selection. Area is a broken proxy for DOM depth: a
  // full-bleed child can be larger than its parent. So pick the container that is
  // NOT an ancestor of any other container; among siblings, smallest area wins.
  const byKey = new Map(scannedElements.map(e => [e.key, e]));
  const isAncestorOf = (ancestorKey: string, node: ScannedElement): boolean => {
    let cur = node.parentKey;
    while (cur) {
      if (cur === ancestorKey) return true;
      cur = byKey.get(cur)?.parentKey ?? null;
    }
    return false;
  };
  const deepest = containers.filter(
    c => !containers.some(o => o !== c && isAncestorOf(c.key, o))
  );
  deepest.sort((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height);
  const target = deepest[0] ?? null;

  // Position-aware insert index: the number of the parent's children that sit
  // ABOVE the drawn rect. The old blind childCount always appended at the END,
  // which teleported a box drawn at the TOP of a layout page to the bottom of
  // the slot container (C5, proven 2026-08-26). The bridge mounts drawn
  // elements at this index, so "where they drew it" survives into the DOM.
  const indexAmong = (parentKey: string): number =>
    scannedElements.filter(
      (el) => el.parentKey === parentKey && el.rect.top < drawnRect.top,
    ).length;

  if (!target) {
    // A parentKey-less root force-mounts into the page layout's DEFAULT slot
    // container (bridge _rehomeDrawnRoot) — order it against THAT container's
    // children so the mount position still matches the draw position.
    const slotContainer = scannedElements.find((el) => isLayoutSlotKey(el.key));
    return {
      parentKey: null,
      insertIndex: slotContainer ? indexAmong(slotContainer.key) : 0,
      relativeX: drawnRect.left,
      relativeY: drawnRect.top,
    };
  }

  return {
    parentKey: target.key,
    insertIndex: indexAmong(target.key),
    relativeX: drawnRect.left - target.rect.left,
    relativeY: drawnRect.top - target.rect.top,
  };
}
