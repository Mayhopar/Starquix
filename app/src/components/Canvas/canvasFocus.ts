// app/src/components/Canvas/canvasFocus.ts
/**
 * Pure canvas focus resolution for the Layout drill (real-key model).
 *
 * Chrome is now SCANNED (data-sq-chrome), so a laid-out page is a real tree:
 * top-level chrome tags (`<layoutElementId>:<selector>`, e.g. the slot-div) are
 * the roots and content nests under the slot. The Layout itself has NO DOM node —
 * it is N sibling chrome tags — so it is the single editor-synthesized OUTERMOST
 * selection level (key = the layout-chrome instance root, `layoutchrome-<pageId>`).
 *
 *   - single click at the outermost level → select the Layout (union rect)
 *   - double-click → enter the Layout context and select the clicked top-level
 *     chrome tag the bridge resolved; from there the bridge's native element drill
 *     (findEditableElement) takes over on real keys.
 *
 * Pages without a layout, and any click once already drilled in, are unchanged
 * ('passthrough' → the caller runs its normal selection flow). Kept pure and
 * DOM-free so it is unit-testable without the iframe.
 */
import { unionRect, type SimpleRect } from '@/utils/boundsUnion';
import { isLayoutChromeChildKey } from '@/utils/layoutChromeKeys';
import { isWrapperKey } from '@/store/keyKind';
import type { ScannedElement } from '@/context/SelectionContext';

export interface CanvasFocusInput {
  /** Key the bridge resolved for the click, or null for a background click. */
  clickedKey: string | null;
  /** The bridge's progressive-drill target container, if it auto-drilled. */
  drillDownContext?: string | null;
  isDoubleClick: boolean;
  /** Editor drill-down context (null = outermost = the Layout level). */
  contextKey: string | null;
  /** The page's layout-chrome instance root key (`layoutchrome-<pageId>`), or null. */
  layoutRootKey: string | null;
  /** All scanned elements (used to resolve the clicked chrome element). */
  scannedElements: ScannedElement[];
}

export type CanvasFocusResult =
  | { action: 'passthrough' }
  | { action: 'select-layout'; layoutKey: string }
  | { action: 'enter-layout'; layoutKey: string; chromeElement: ScannedElement };

export function resolveCanvasFocus(input: CanvasFocusInput): CanvasFocusResult {
  const { clickedKey, drillDownContext, isDoubleClick, contextKey, layoutRootKey, scannedElements } = input;

  // Only intervene at the OUTERMOST level of a laid-out page, and only when the
  // bridge resolved a within-layout CHROME tag (`<layoutRootKey>:…`). Content roots
  // are nested under the slot, so a root-level click always resolves to a chrome
  // tag first; anything else is genuine content outside the layout — passthrough.
  //
  // "Outermost" is NOT just contextKey === null: ViewportFrame auto-enters the
  // Astro page wrapper (`[pageId].astro`) as the default context on load, so on a
  // laid-out page the outermost context IS that wrapper. Treat it as outermost too
  // — otherwise the very first click never resolves to the Layout.
  const atOutermost = contextKey === null || isWrapperKey(contextKey);
  if (!layoutRootKey || !atOutermost || !clickedKey) return { action: 'passthrough' };

  // The chrome tag this click resolves to. Normally the bridge returns a layout
  // chrome key directly. On a double-click the bridge can auto-drill PAST the slot
  // into its content (clickedKey = the content, drillDownContext = the slot) — in
  // that case stop at the slot (the drill container), don't jump over it to content.
  const chromeKey = isLayoutChromeChildKey(clickedKey, layoutRootKey)
    ? clickedKey
    : isLayoutChromeChildKey(drillDownContext, layoutRootKey)
      ? drillDownContext
      : null;
  if (!chromeKey) return { action: 'passthrough' };

  // A bridge drill payload (drillDownContext set) or a plain double-click both mean
  // "drill"; a plain single click means "select the Layout".
  const wantsDrill = !!drillDownContext || isDoubleClick;
  if (!wantsDrill) return { action: 'select-layout', layoutKey: layoutRootKey };

  // Drill: enter the Layout context and select the chrome tag (the slot).
  const chromeElement = scannedElements.find((el) => el.key === chromeKey);
  if (!chromeElement) return { action: 'select-layout', layoutKey: layoutRootKey };

  return { action: 'enter-layout', layoutKey: layoutRootKey, chromeElement };
}

/**
 * The canvas selection rect for the Layout. The Layout has no DOM node of its own
 * (its chrome is N sibling tags), so we outline the UNION of its scanned chrome
 * tags — every scanned element keyed `<layoutRootKey>:<selector>`. Editor-side:
 * the scan already carries chrome rects, so no iframe round-trip. Returns null
 * when no chrome is present. Pure so it's unit-testable without the iframe.
 */
export function layoutSelectionRect(
  scannedElements: ScannedElement[],
  layoutRootKey: string | null,
): SimpleRect | null {
  if (!layoutRootKey) return null;
  const rects: SimpleRect[] = [];
  for (const el of scannedElements) {
    if (isLayoutChromeChildKey(el.key, layoutRootKey)) rects.push(el.rect);
  }
  // Local FRAGMENT layouts only (layout-element paradigm 2026-08-24): a layout
  // with a scanned <body> selects by its REAL key — real rect, this function
  // never fires for it. A fragment layout (no <body> of its own) still mints
  // the synthetic node, whose bounds are the union of the scanned ROOT
  // elements. Without this, selecting that node drew nothing (2026-08-23).
  if (rects.length === 0) {
    for (const el of scannedElements) {
      if (el.parentKey === null && el.rect) rects.push(el.rect);
    }
  }
  return unionRect(rects);
}
