/**
 * ViewportMessageContext — the explicit dependency surface of the iframe
 * message handlers extracted from ViewportFrame.tsx.
 *
 * Design (docs/archive/plans/2026-06-10-godfile-decomposition-design.md §3.2):
 * - `refs` are the stale-closure escape hatches ViewportFrame already
 *   maintains (pass the RefObjects, never unwrapped `.current` values —
 *   handlers read at call time).
 * - `actions` are the stable callbacks/setters the old switch body closed
 *   over. Types are derived from the real hook return types so they can
 *   never drift from the providers.
 * - `env` holds non-ref environment values; ViewportFrame reassigns the
 *   whole context object every render (latest-ref pattern), so these are
 *   always current.
 *
 * If a handler needs something not listed here, ADD it to this type and to
 * the `messageCtxRef` assembly in ViewportFrame — that visibility is the
 * point of the extraction.
 */
import type { RefObject, Dispatch, SetStateAction } from 'react';
import type * as Y from 'yjs';
import type { Breakpoint, GridGeometry, PageData } from '@/store/types';
import type { HoveredElementInfo } from '../hoverRectStore';
import type { ElementRect, KeyedRect } from '@/bridge';
import type {
  useSelectionContext,
  useScannedElements,
  useTextSelection,
  useRectHover,
  ScannedElement,
} from '@/context/SelectionContext';
import type { useClassStore } from '@/context';
import type { useUndoContext } from '@/context/UndoContext';
import type { useDispatch } from '@/store/hooks';

type SelectionAPI = ReturnType<typeof useSelectionContext>;
type ScannedElementsAPI = ReturnType<typeof useScannedElements>;
type TextSelectionAPI = ReturnType<typeof useTextSelection>;
type RectHoverAPI = ReturnType<typeof useRectHover>;
type ClassStoreAPI = ReturnType<typeof useClassStore>;
type UndoAPI = ReturnType<typeof useUndoContext>;

export interface ViewportMessageContext {
  // --- refs (stale-closure escape hatches; read `.current` at call time) ---
  refs: {
    iframe: RefObject<HTMLIFrameElement | null>;
    isReady: RefObject<boolean>;
    selectedKey: RefObject<string | null>;
    scannedElements: RefObject<ScannedElement[]>;
    selectedElementId: RefObject<string | null>;
    contextKey: RefObject<string | null>;
    isEditingText: RefObject<boolean>;
    onZoom: RefObject<((screenX: number, screenY: number, deltaY: number) => void) | undefined>;
    onPan: RefObject<((deltaX: number, deltaY: number) => void) | undefined>;
    scaleProps: RefObject<number>;
    selectInContext: RefObject<SelectionAPI['select']>;
    /** Shift+click multi-select toggle (SelectionContext.toggleInSelection). */
    toggleInSelection: RefObject<SelectionAPI['toggleInSelection']>;
    /** Refresh the selected element's facts from a rescan (optional for test doubles). */
    patchSelection?: RefObject<SelectionAPI['patchSelection']>;
    registerElement: RefObject<ClassStoreAPI['registerElement']>;
    enterContext: RefObject<SelectionAPI['enterContext']>;
    exitContext: RefObject<SelectionAPI['exitContext']>;
    resetContext: RefObject<SelectionAPI['resetContext']>;
    currentPageId: RefObject<string | null>;
    layoutRootKey: RefObject<string | null>;
    breakpoint: RefObject<Breakpoint>;
    aiContextMode: RefObject<boolean>;
    aiHighlightKey: RefObject<string | null>;
    gridGeometry: RefObject<GridGeometry | null>;
    highlightedGridCell: RefObject<{ col: number; row: number } | null>;
    dragMode: RefObject<'grid' | 'reparent' | 'flow' | null>;
    pendingGridRefreshKey: RefObject<string | null>;
    pendingSelect: RefObject<string | null>;
    /** task-181: keyed by the FULL element key — the only address that names
     *  ONE element on ONE surface. The `file:line` sibling map is gone. */
    pendingKeyUpdates: RefObject<Map<string, { key: string; classes: string }>>;
    isLinkInteracting: RefObject<boolean>;
  };
  // --- stable actions (callbacks + setters the switch body used) ---
  actions: {
    claimSnapshot?: () => import('@/store/documentMutation').MutationSnapshot | undefined;
    dispatch: ReturnType<typeof useDispatch>;
    updateSelectionRect: RectHoverAPI['updateSelectionRect'];
    /** task-120 (4.2): plain setter into hoverRectStore (not React state). */
    setHoveredRect: (info: HoveredElementInfo | null) => void;
    setAIGlowRects: Dispatch<SetStateAction<KeyedRect[]>>;
    setAIPreviewRect: Dispatch<SetStateAction<ElementRect | null>>;
    setGridGeometry: Dispatch<SetStateAction<GridGeometry | null>>;
    setHighlightedGridCell: Dispatch<SetStateAction<{ col: number; row: number } | null>>;
    setIsGridOverlayVisible: Dispatch<SetStateAction<boolean>>;
    setReparentDragKey: SelectionAPI['setReparentDragKey'];
    setContentHeight: (height: number, sample?: import('@/bridge/types').ContentHeightPayload) => void;
    setSourceError: (error: import('./sourceStatus').SourceErrorStatus | null) => void;
    setIsIframeReady: Dispatch<SetStateAction<boolean>>;
    /** Reload edge: bumps reloadCount (re-fires every reload-resend effect)
     *  and force-arms the RENDER effect — see ViewportFrame iframeReloaded. */
    iframeReloaded: () => void;
    setScannedElements: ScannedElementsAPI['setScannedElements'];
    updateScannedElementRects: ScannedElementsAPI['updateScannedElementRects'];
    setTextSelection: TextSelectionAPI['setTextSelection'];
    clearTextSelection: TextSelectionAPI['clearTextSelection'];
    exitEditMode: SelectionAPI['exitEditMode'];
    sendEnterEditMode: (key: string, draftMarkup?: string) => void;
    takeSnapshot: UndoAPI['takeSnapshot'];
    /** task-148 follow-up: structural-undo recorder for LOCAL file moves —
     *  canvas drags route to moveLocalElement, which records its inverse here
     *  so they are ⌘Z-able like the Layers/gutter paths. */
    pushStructuralUndo: UndoAPI['pushStructuralUndo'];
    getClassesFromYjs: ClassStoreAPI['getClassesFromYjs'];
    clearSelection: SelectionAPI['clearSelection'];
    updateBgImagePreview: SelectionAPI['updateBgImagePreview'];
    updateImagePreview: SelectionAPI['updateImagePreview'];
    setSelectedPosition: Dispatch<SetStateAction<string>>;
    persistGridClasses: (key: string) => void;
    syncClassToIframe: (key: string) => void;
    refreshGridState: (key: string) => void;
    /** Switch pages — the SAME path the sidebar uses (PagesContext.setActivePage). */
    setActivePage: (pageId: string) => void;
    /** Open a collection's designed post page for a slug — useGoToPost
     *  (creates the post page on demand + setActivePage + setPreviewPost).
     *  Preview-mode blog-card clicks route here. */
    goToPost: (collectionId: string, postSlug: string, parentPageId?: string | null) => void;
  };
  // --- environment values (reassigned every render, always current) ---
  env: {
    doc: Y.Doc;
    projectId: string | null;
    /** All pages — PREVIEW_NAVIGATE resolves a clicked href against these. */
    pages: PageData[];
    /** Lock rule input for multi-select membership (same as the canvas lock badge). */
    isLocalMode: boolean;
  };
}

export type MessageHandler = (
  ctx: ViewportMessageContext,
  payload: unknown,
  event: MessageEvent,
) => void;
