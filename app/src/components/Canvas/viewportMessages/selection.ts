/**
 * Selection messages: bridge ELEMENT_CLICK (drill-down, text-edit entry,
 * layout focus, AI context), legacy ELEMENT_CLICKED, and slot placeholder
 * clicks. Moved verbatim from ViewportFrame.tsx.
 */
import { resolveCanvasFocus, layoutSelectionRect } from '../canvasFocus';
import type { ElementRect } from '@/bridge';
import type { ViewportMessageContext } from './context';
import { clearSelectedCellGeometry } from '@/store/gridGeometryStore';
import { lockedKeyPredicate } from '@/components/DesignBar/lockTier';
import { deriveSelectedElementId } from '@/context/SelectionContext';

export interface ElementClickPayload {
  key: string;
  tagName: string;
  classes: string;
  computedStyles?: Record<string, string>;
  sourceLocation?: { file: string; line: number; column: number };
  rect: ElementRect;
  isDoubleClick?: boolean;
  hasChildren?: boolean;
  isDirectSelect?: boolean;
  isOutsideContext?: boolean;
  drillDownContext?: string;
  parentDisplay?: string;
  imageAttributes?: { src: string | null; alt: string | null };
  /** Sent by the bridge for <video> elements; src rides the imageSrc channel. */
  videoAttributes?: { src: string | null; autoplay: string; loop: string; muted: string; controls: string };
  imagePreviewDataUrl?: string;
  altKey?: boolean;
  /** Shift+click = multi-select toggle (design ledger §1). */
  shiftKey?: boolean;
  postSlug?: string;
  postLinkPaths?: readonly string[];
  /** task-140: unresolved data-sq-media fill on the element */
  mediaFill?: boolean;
  /** task-141: element has element children (Media tab: swap vs background) */
  hasElementChildren?: boolean;
  /** task-142: astro <Image> — absolute path of the bound src/ asset */
  boundAssetPath?: string;
  imageComponentIndex?: number;
  /** task-142: owning component file for prop-driven imgs */
  ownerComponentFile?: string;
}

/** Legacy preview message — fields at the top level of event.data. */
export function handleElementClicked(ctx: ViewportMessageContext, _payload: unknown, event: MessageEvent): void {
  const { elementId, rect } = event.data as { elementId: string; rect: ElementRect };
  ctx.refs.selectInContext.current(elementId, { rect });
  ctx.actions.updateSelectionRect(rect);
}

export function handleElementClick(ctx: ViewportMessageContext, rawPayload: unknown): void {
  const clicked = rawPayload as ElementClickPayload;
  // The admitted scan owns source versions/revisions; click payloads only
  // identify the current DOM node and may omit that ownership metadata.
  const scanned = ctx.refs.scannedElements.current.find(element => element.key === clicked.key);
  const payload = { ...clicked, sourceLocation: scanned?.sourceLocation ?? clicked.sourceLocation };

  // Alt+click or Cmd/Ctrl+click (isDirectSelect carries metaKey||ctrlKey through
  // both real and SIMULATE_CLICK paths — the synthetic event has no altKey) →
  // add element to AI context; plain clicks never add, even in AI mode.
  // Gated on aiContextMode: with the AI tab closed there is no tray to add to.
  if (ctx.refs.aiContextMode.current && (payload.altKey || payload.isDirectSelect)) {
    window.dispatchEvent(new CustomEvent('sq:add-ai-context', {
      detail: { key: payload.key, tagName: payload.tagName, classes: payload.classes }
    }));
    if (payload.altKey) return; // alt+click: context only, no selection
  }

  // Shift+click = multi-select toggle (design ledger §1). Never drills, never
  // changes context, never enters text editing; the bridge already left any
  // text session on this outside click — mirror it host-side.
  if (payload.shiftKey) {
    if (ctx.refs.isEditingText.current) ctx.actions.exitEditMode();
    const byKey = new Map(ctx.refs.scannedElements.current.map(e => [e.key, e] as const));
    const decision = ctx.refs.toggleInSelection.current(payload.key, {
      elementId: deriveSelectedElementId(payload.key),
      isLocked: lockedKeyPredicate(byKey, ctx.env.isLocalMode),
    });
    // A joining member reads its classes like a clicked primary (ledger A13).
    if (decision === 'join') ctx.refs.registerElement.current(payload.key, payload.classes || '', payload.sourceLocation);
    if (decision !== 'select') return;
    // nothing selected / primary can't anchor → continue as a plain click
  }

  // Handle drill-down context (Figma-like behavior)
  const { isDoubleClick, hasChildren, isDirectSelect, isOutsideContext, drillDownContext } = payload;

  // Double-click on the already-selected childless element edits its text, whatever
  // its tag (audit #41: a tag list left a div/section uneditable that Enter edits).
  if (isDoubleClick && payload.key === ctx.refs.selectedKey.current && !hasChildren && !ctx.refs.isEditingText.current) {
    ctx.actions.sendEnterEditMode(payload.key); // db-bound keys are blocked inside the funnel itself
    return;
  }

  // On a laid-out page the Layout is the OUTERMOST drill level. At that
  // level (editor contextKey === null) the bridge resolves the outermost
  // chrome tag; the editor synthesizes the Layout on top. Single click →
  // select the Layout (union rect); double click → enter the Layout context
  // and select the clicked top-level chrome tag, after which the bridge's
  // native element drill takes over on real keys. Once drilled in
  // (contextKey set) this is a passthrough and the normal flow runs.
  const layoutFocus = resolveCanvasFocus({
    clickedKey: payload.key,
    drillDownContext,
    isDoubleClick: !!isDoubleClick,
    contextKey: ctx.refs.contextKey.current,
    layoutRootKey: ctx.refs.layoutRootKey.current,
    scannedElements: ctx.refs.scannedElements.current,
  });
  if (layoutFocus.action === 'select-layout') {
    // Select the Layout (real key); outline the union of its chrome tags.
    ctx.refs.selectInContext.current(layoutFocus.layoutKey);
    ctx.actions.updateSelectionRect(layoutSelectionRect(ctx.refs.scannedElements.current, ctx.refs.layoutRootKey.current));
    return;
  }
  if (layoutFocus.action === 'enter-layout') {
    // Drill one level: enter the Layout context, select the clicked
    // top-level chrome tag the bridge already resolved.
    ctx.refs.enterContext.current(layoutFocus.layoutKey);
    const chromeEl = layoutFocus.chromeElement;
    ctx.refs.selectInContext.current(chromeEl.key, {
      sourceLocation: chromeEl.sourceLocation,
      tagName: chromeEl.tagName,
      classes: chromeEl.classes,
      rect: chromeEl.rect,
      parentDisplay: chromeEl.parentDisplay ?? undefined,
    });
    ctx.refs.registerElement.current(chromeEl.key, chromeEl.classes || '', chromeEl.sourceLocation);
    ctx.actions.updateSelectionRect(chromeEl.rect);
    return;
  }

  // Cmd+click = direct selection, skip context logic
  if (!isDirectSelect) {
    // drillDownContext: bridge already drilled down and selected child, just set context
    if (drillDownContext) {
      ctx.refs.enterContext.current(drillDownContext);
    }
    // Double-click on element with children → enter context (drill down)
    else if (isDoubleClick && hasChildren) {
      ctx.refs.enterContext.current(payload.key);
    }
    // Click outside current context → reset all drill state (not just one level)
    else if (isOutsideContext && ctx.refs.contextKey.current) {
      ctx.refs.resetContext.current();
    }
  }

  // Detect position from classes (move behavior)
  const positionClasses = ['absolute', 'fixed', 'relative', 'sticky'];
  const detectedPosition = positionClasses.find(p => payload.classes?.split(/\s+/).includes(p)) || 'static';
  ctx.actions.setSelectedPosition(detectedPosition);

  // Request grid geometry — bridge traverses up to find grid ancestor.
  // Clear the selected-cell store too; it is repopulated by the response when
  // the new selection is a grid child, else stays null (non-grid element).
  ctx.actions.setGridGeometry(null);
  clearSelectedCellGeometry();
  ctx.refs.iframe.current?.contentWindow?.postMessage({
    type: 'REQUEST_GRID_GEOMETRY',
    payload: { key: payload.key },
  }, '*');

  // Selection truth lives in SelectionContext (task-075) — single write.
  ctx.refs.selectInContext.current(payload.key, {
    sourceLocation: payload.sourceLocation,
    tagName: payload.tagName,
    classes: payload.classes,
    computedStyles: payload.computedStyles,
    rect: payload.rect,
    parentDisplay: payload.parentDisplay ?? undefined,
    imageSrc: payload.imageAttributes?.src ?? payload.videoAttributes?.src,
    mediaFill: payload.mediaFill === true,
    hasElementChildren: payload.hasElementChildren === true,
    boundAssetPath: payload.boundAssetPath ?? null,
    imageComponentIndex: payload.imageComponentIndex ?? null,
    ownerComponentFile: payload.ownerComponentFile ?? null,
    imageAlt: payload.imageAttributes?.alt,
    imagePreviewDataUrl: payload.imagePreviewDataUrl,
    postSlug: payload.postSlug,
    postLinkPaths: payload.postLinkPaths,
  });
  // Register element in ClassStore for DesignBar
  ctx.refs.registerElement.current(
    payload.key,
    payload.classes || '',
    payload.sourceLocation
  );
  ctx.actions.updateSelectionRect(payload.rect);
}

export function handleSlotPlaceholderClick(ctx: ViewportMessageContext, payload: unknown): void {
  const slotPayload = payload as { key: string; slotType: string };
  window.dispatchEvent(new CustomEvent('sq:slot-placeholder-click', {
    detail: { key: slotPayload.key, slotType: slotPayload.slotType },
  }));
}
