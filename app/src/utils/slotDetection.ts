/**
 * A `<slot>` is a compile-time placeholder, not a styleable DOM node. It surfaces
 * through different signals depending on representation — any one marks a slot:
 *  - Yjs `type === 'slot'`     — codegen-shaped slot element
 *  - Yjs `slotType === 'slot'` — the slot draw tool (type stays 'frame'/'text')
 *  - scanned `tagName === 'slot'` — an empty literal `<slot>` (e.g. a layout
 *    opened in the editor, a SOURCE child not in the elements map)
 *  - scanned `slotName !== undefined` — a FILLED layout slot, which renders as
 *    `<div data-sq-slot>` (tagName 'div'), identified only by its stamped name
 *
 * Single source of truth for "is this a slot?" — used by DesignBar (which slot
 * panel to show) and the Layers tree (slot icon/label).
 */
/** Scanner-labeled blog slot rows: the scan reports the blog slot wrapper
 *  (drawn `data-slot-type="blog"` or instance-path `data-blog-source="posts"`)
 *  with tagName 'Blog Slot' / 'Blog: <Card>'. Deliberately NOT folded into
 *  isSlotSelection — blog slots keep their own panel/accent semantics (no
 *  slotName, no layout-slot panel). One predicate so icon, color, and any
 *  other consumer can't drift from the scanner's label contract. */
export function isBlogSlotLabel(tagName: string | null | undefined): boolean {
  return !!tagName && tagName.toLowerCase().startsWith('blog');
}

export function isSlotSelection(signals: {
  tagName?: string | null;
  slotName?: string;
  elementType?: string;
  slotType?: string;
}): boolean {
  return (
    signals.elementType === 'slot' ||
    signals.slotType === 'slot' ||
    signals.tagName?.toLowerCase() === 'slot' ||
    signals.slotName !== undefined
  );
}
