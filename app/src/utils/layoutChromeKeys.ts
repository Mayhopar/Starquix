// app/src/utils/layoutChromeKeys.ts
//
// Single source of truth for the layout-chrome key namespace. A page's layout
// chrome is rendered under the layout-chrome instance id `layoutchrome-<pageId>`
// (see store/layoutElement.ts pageLayoutElementId); the root is that bare id and
// every chrome tag (slot, header, …) is an instance-child `…:<selector>`.
// Keep all "is this a chrome key" checks here so the convention lives in one place.

/** The layout-chrome ROOT or any of its children (`layoutchrome-<pageId>[:…]`). */
export function isLayoutChromeKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith('layoutchrome-');
}

/** A child of a SPECIFIC layout root: `<layoutRootKey>:<selector>` (slot, header…). */
export function isLayoutChromeChildKey(
  key: string | null | undefined,
  layoutRootKey: string | null | undefined,
): boolean {
  return !!key && !!layoutRootKey && key.startsWith(`${layoutRootKey}:`);
}

// A rendered `<slot>` inside the layout chrome. Both spellings below describe
// the SAME tag, at two different stages of the pipeline: the full doc key while
// it is still `<layoutRootKey>:<selector>`, and the bare sub-selector once
// override routing has stripped the root prefix.

const SLOT_SELECTOR_RE = /^slot-\d+$/;
const LAYOUT_SLOT_KEY_RE = /^layoutchrome-[^:]+:slot-\d+$/;

/**
 * A chrome sub-selector naming a rendered `<slot>` (`slot-0`, `slot-1`, …).
 * A `<slot>` is a compile-time placeholder, not a container — the write-back
 * server cannot resolve it as a parentSelector (mapKeyToPosition skips slot
 * tags), so callers route these as top-level chrome instead.
 */
export function isSlotSelector(selector: string | null | undefined): boolean {
  return !!selector && SLOT_SELECTOR_RE.test(selector);
}

/** ANY page's layout-chrome slot child: `layoutchrome-<pageId>:slot-<n>`. */
export function isLayoutSlotKey(key: string | null | undefined): boolean {
  return !!key && LAYOUT_SLOT_KEY_RE.test(key);
}
