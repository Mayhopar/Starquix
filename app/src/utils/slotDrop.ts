// app/src/utils/slotDrop.ts
/**
 * Slot-drop resolution (flat storage). Dropping a content root onto a layout
 * slot re-homes it via `SET_ELEMENT_SLOT_NAME` — NOT a reparent: content roots
 * stay flat in `rootElementIds` with `parentId: null`; slot membership is the
 * `slotName` only. The render re-splices and the scan re-derives the nesting.
 *
 * A drop target is a layout slot when its key is in the page's layout-chrome
 * namespace (`<layoutRootKey>:<selector>`) AND the scanned element for it carries
 * a `slotName` (the scan stamps it from the slot's `name` attribute; '' = the
 * default slot). Any other target → null (the caller does a normal reparent).
 *
 * Pure so it is unit-testable without the iframe/dnd.
 */
import type { ScannedElement } from '@/context/SelectionContext';
import { isLayoutChromeChildKey } from '@/utils/layoutChromeKeys';

/**
 * The slot's `slotName` if `targetKey` is a layout slot the dragged content
 * should re-home into, else null. Default slot → '' (clears `slotName`).
 */
export function slotNameForDropTarget(
  targetKey: string | null,
  scannedElements: ScannedElement[],
  layoutRootKey: string | null,
): string | null {
  if (!isLayoutChromeChildKey(targetKey, layoutRootKey)) return null;
  const el = scannedElements.find((e) => e.key === targetKey);
  if (!el || el.slotName === undefined) return null;
  return el.slotName;
}

/** The owning element id for a dragged scanned key (`el-x:sec-0` → `el-x`). */
export function draggedElementId(dragKey: string): string {
  return dragKey.split(':')[0];
}
