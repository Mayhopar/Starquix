/**
 * Bridge Types
 *
 * TypeScript interfaces for IFrameBridge message protocol.
 * Defines the contract between parent (editor) and child (iframe).
 */

// --- Core Types ---

export interface SourceLocation {
  file: string;
  line: number;
  column: number;
  /** Fingerprint of the authored source which supplied these coordinates. */
  sourceVersion?: string;
  /** Accepted source generation which admitted this scanned location. */
  sourceRevision?: number;
}

export interface ElementRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Rendered layout, including CSS rules and the active viewport's cascade. */
export type ContainerLayout =
  | 'flex-row' | 'flex-column' | 'flex-row-reverse' | 'flex-column-reverse'
  | 'grid-row' | 'grid-column';

export interface ComputedStyles {
  fontSize: string;
  fontWeight: string;
  fontFamily: string;
  lineHeight: string;
  letterSpacing: string;
  textAlign: string;
  color: string;
  width: string;
  height: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  backgroundColor: string;
}

export interface GridCellInfo {
  key: string;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  rect: ElementRect;
}

// --- Payload Types (Iframe -> Parent) ---

export interface IframeReadyPayload {
  documentId?: string;
  href?: string;
  documentHeight: number;
  documentWidth: number;
  /** 1 = this bridge understands class intents (UpdateClassesPayload.intent, CLASS_INTENT_SETTLED). */
  classIntentV?: number;
}

export interface ElementClickPayload {
  key: string;
  tagName: string;
  classes: string;
  /** Read-only same-origin article link paths; distinct from source editability. */
  postLinkPaths?: readonly string[];
  computedStyles?: ComputedStyles;
  sourceLocation?: SourceLocation;
  rect: ElementRect;
  parentKey: string | null;
  parentDisplay: string | null;
  isDoubleClick: boolean;
  hasChildren: boolean;
  isDirectSelect: boolean;
  isOutsideContext: boolean;
  /** Present when element is an <img> tag */
  imageAttributes?: {
    src: string | null;
    alt: string | null;
    loading: string | null;
  };
  /** Thumbnail data URL, present when element is a loaded <img> */
  imagePreviewDataUrl?: string;
  /** Set by bridge when drill-down selects a child element */
  drillDownContext?: string;
}

export interface ElementHoverPayload {
  computedStyles?: import('@/services/imageFillGeometry').ImageFillGeometry;
  key: string;
  tagName: string;
  rect: ElementRect;
  parentKey: string | null;
}

export interface ElementHoverEndPayload {}

export interface ElementsScannedPayload {
  documentId?: string;
  /** Taken right after a predicted DOM change: keys are pre-write coordinates. */
  predicted?: boolean;
  elements: Array<{
    key: string;
    sourceKey?: string;
    tagName: string;
    classes: string;
    layout?: ContainerLayout;
    postLinkPaths?: readonly string[];
    sourceLocation?: SourceLocation;
    /** task-148 item 7 — the invocation tag that placed this element's
     *  component, in the placing file. Local mode only. */
    usageLocation?: SourceLocation;
    /** The master's classes for a class read from an override prop (`data-sq-cf`). */
    masterClasses?: string;
    /** The master's text for text read from an override prop (`data-sq-tf`). */
    masterText?: string;
    /** The master's <img> src for a src read from an override prop (`data-sq-sf`). */
    masterSrc?: string;
    rect: ElementRect;
    parentKey: string | null;
    hasSourceTracking?: boolean;
    /** Present when tagName is 'img': its `src` attribute, '' when absent
     *  (capped at 200 chars). '' = the canvas empty-image receiver; the value
     *  is local mode's ↻ `now` half (task-186 FIX-2). */
    imageSrc?: string;
    /** task-206: present when the element sits inside a rendered <Media/>
     *  (.sq-media). The rehype wrapper's body-line stamps for the invocation
     *  in the post .mdx — the MediaBlock's write target. */
    mediaUnit?: { bodyLine: number; bodyEnd: number };
    /** The enclosing post body block's `data-sq-body-line` (body-relative, 1-based). */
    bodyLine?: number;
  }>;
}

export interface RectUpdatedPayload {
  key: string;
  rect: ElementRect;
}

export interface PageChangedPayload {
  path: string;
}

export interface WheelPayload {
  deltaX: number;
  deltaY: number;
  clientX: number;
  clientY: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export interface ElementRectResponsePayload {
  key: string;
  rect: ElementRect;
}


export interface KeyboardEventPayload {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** Absent from the preview-mode Escape relay and from a stale cached bridge. */
  repeat?: boolean;
}

export interface TextSelectionChangedPayload {
  key: string;
  selectedText: string;
  hasSelection: boolean;
  isInsideLink: boolean;
  existingHref?: string;
  existingTarget?: '_blank' | '_self';
  linkKey?: string;
}

export interface MarkupChangedPayload {
  key: string;
  innerHTML: string;
  /** Link selector key (e.g., "instanceId:a-0") when a link was created/modified */
  linkKey?: string;
  /** Link href when a link was created/modified */
  href?: string;
  /** Link target when a link was created/modified */
  target?: '_blank' | '_self';
}

/** Seamless canvas: typed text mirrored to .sq/drafts while editing (bridge flushTextDraft). */
export interface TextDraftPayload {
  key: string;
  file: string;
  sourceVersion: string;
  markup: string;
  page: string;
}

export interface EditModeExitedPayload {
  key: string;
  textContent: string;
  originalText: string;
}

export interface DragElementDropPayload {
  key: string;
  newParentKey: string | null;
  insertIndex: number;
  cancelled: boolean;
  reparented?: boolean;
}

export interface DragElementExitIframePayload {
  key: string;
}

export interface GridGeometryResponsePayload {
  containerRect: ElementRect;
  columns: number[];
  rows: number[];
  columnGap: number;
  rowGap: number;
  cells: GridCellInfo[];
  explicitRowCount: number;
}

export interface ContentHeightPayload {
  height: number;
  /** Optional for compatibility with older height-only bridges. */
  viewportHeight?: number;
  viewportWidth?: number;
  revision?: number;
  /** CSS transitions can finish reflowing after the host stops resizing. */
  transitioning?: boolean;
  documentId?: string;
  href?: string;
  mode?: 'design' | 'preview';
}

/** An element's box tagged with its key — the shape every rect batch uses. */
export interface KeyedRect {
  key: string;
  rect: ElementRect;
}

export interface RectsUpdatedPayload {
  rects: KeyedRect[];
}

export interface ImagePreviewRefreshPayload {
  key: string;
  dataUrl: string;
}

export interface BgImagePreviewPayload {
  key: string;
  dataUrl: string;
}

export interface ScreenshotCapturedPayload {
  dataUrl: string;
}

export interface ScreenshotFailedPayload {
  error: string;
}

// --- Payload Types (Parent -> Iframe) ---

/** A durable class edit's call-order number (services/classIntents.ts). The bridge applies only the newest seq
 * per key, drops writes WITHOUT one for a held key, and keeps a held key's value until the file carries it.
 * `hold` defaults to true; false = apply but do not hold. A new `epoch` resets the bridge's bookkeeping. */
export interface ClassIntentTag { epoch: string; seq: number; hold?: boolean }

export interface UpdateClassesPayload {
  key?: string;
  classes: string;
  sourceLocation?: SourceLocation;
  intent?: ClassIntentTag;
}

export interface SetContextPayload {
  contextKey: string | null;
}

export interface RequestElementRectPayload {
  key: string;
}

export interface CaptureScreenshotPayload {
  scriptUrl: string;
  width?: number;
  height?: number;
}

export interface WrapSelectionInLinkPayload {
  key: string;
  href: string;
  target?: '_blank' | '_self';
}

export interface UnwrapLinkPayload {
  key: string;
  linkSelector: string;
}

export interface UpdateTextPayload {
  key: string;
  textContent: string;
}

export interface UpdateInstanceOverridePayload {
  instanceId: string;
  selector: string;
  classes?: string;
}

export interface UpdateLinkAttributePayload {
  key: string;
  attribute: string;
  value: string;
}

export interface UpdateImageAttributePayload {
  key: string;
  attribute: string;
  value: string;
}

export interface SimulateClickPayload {
  x: number;
  y: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  isDoubleClick: boolean;
}

export interface SqWriteClassesPayload {
  sourceLocation: SourceLocation;
  newClasses: string;
  requestId: string;
}

export interface SqWriteTextPayload {
  sourceLocation: SourceLocation;
  newText: string;
  requestId: string;
}

export interface SqWriteImagePayload {
  sourceLocation: SourceLocation;
  attribute: string;
  newValue: string;
  requestId: string;
}

export interface ReorderElementsPayload {
  elementIds: string[];
}

export interface ReparentElementDomPayload {
  key: string;
  newParentKey: string | null;
  insertIndex: number;
}

export interface RequestGridGeometryPayload {
  key: string;
}

export interface EnterEditModePayload {
  key: string;
  /**
   * Authoritative pre-override source text for the key (parent resolves it
   * from raw staticMarkup). When present the bridge stores it
   * unconditionally as the RESTORE_ORIGINAL_TEXT baseline; when absent the
   * bridge falls back to first-seen DOM text (task-049 TI-1/TI-2).
   */
  originalText?: string;
}

export interface RestoreOriginalTextPayload {
  key: string;
}

/**
 * task-151: "put this element back the way the SOURCE renders it" — sent when
 * an undo REMOVES a sourceClasses entry. The bridge's own capture (taken before
 * it applied the first override) wins; `fallbackClasses` covers the case where
 * it never applied one for the key.
 */
export interface RestoreOriginalClassesPayload {
  key: string;
  fallbackClasses?: string;
  sourceLocation?: SourceLocation;
  intent?: ClassIntentTag;
}

/** The rows that wrote these held values are materialized: verify against the file, then release.
 * `alive` = held keys whose row has not landed yet (the parent is still there). */
export interface ClassIntentSettledPayload {
  settled: Array<{ key: string; seq: number; epoch?: string }>;
  alive?: Array<{ key: string; seq: number; epoch?: string }>;
}

/** task-151: same, for a removed sourceImageAttributes entry. */
export interface RestoreOriginalImageAttributesPayload {
  key: string;
  /** Attributes the removed entry held; omitted = every one the bridge captured. */
  attributes?: string[];
}

export interface SetLinkInteractingPayload {
  interacting: boolean;
}

export interface InsertDrawnElementPayload {
  key: string;
  tag: string;
  classes: string;
  textContent: string;
  parentKey: string | null;
  slotType?: string;
  /** Vector shapes: inline SVG markup rendered as innerHTML for non-slot drawn elements (task-106). */
  staticMarkup?: string;
}

export interface RemoveDrawnElementPayload {
  key: string;
}

export interface RemoveElementFromDomPayload {
  key: string;
}

/** ⌘D predicted paint: a copy of `key` after `anchorKey` (or inside its end), unkeyed until the refresh. */
export interface CloneElementInDomPayload {
  key: string;
  anchorKey: string;
  position: 'after' | 'inside-end';
}

export interface DragElementStartPayload {
  key: string;
  iframeX: number;
  iframeY: number;
}

export interface DragElementMovePayload {
  iframeX: number;
  iframeY: number;
  snapRect?: { left: number; top: number; width: number; height: number };
}

export interface DragElementEndPayload {
  iframeX: number;
  iframeY: number;
}

export interface DragElementReenterIframePayload {
  key: string;
  iframeX: number;
  iframeY: number;
}

export interface RequestPreviewRefreshPayload {
  key: string;
}

export interface BlogSlotRenderData {
  /** Yjs id of the BlogSlot component instance. The bridge looks up the
   *  posts wrapper by data-key prefix on this id. */
  slotElementId: string;
  collectionId: string;
  posts: Array<{ frontmatter: Record<string, unknown>; slug?: string }>;
  bindings: Record<string, string>;
  settings: {
    layout: string;
    columns: number;
    gap: string;
    pagination: string;
    postsPerPage: number;
  };
  /** Route prefix for post links, e.g. '/blog' */
  postRoute?: string;
  /** Link mode: 'auto' | 'none' | field name */
  postLinkMode?: string;
  /** True for legacy drawn BlogSlots (pre-task-028). Triggers the bridge
   *  legacy Phase 5 path: cardTemplateMarkup injected N times into
   *  the empty `<slotId>:posts` wrapper. */
  isDrawn?: boolean;
  cardTemplateMarkup?: string;
  cardElementId?: string;
}

export interface PostPageRenderData {
  /** Post frontmatter values */
  frontmatter: Record<string, unknown>;
  /** Post markdown body rendered as HTML */
  bodyHtml: string;
  /** Field bindings: elementKey -> fieldName */
  bindings: Record<string, string>;
  /** Collection name for reference */
  collectionName: string;
}

export interface TransferAssetPayload {
  assetId: string;
  mimeType: string;
  arrayBuffer: ArrayBuffer;
}

// --- Discriminated Union Messages (Iframe -> Parent) ---

export interface IframeReadyMessage {
  type: 'IFRAME_READY';
  payload: IframeReadyPayload;
  timestamp: number;
}

export interface ElementClickMessage {
  type: 'ELEMENT_CLICK';
  payload: ElementClickPayload;
  timestamp: number;
}

export interface ElementHoverMessage {
  type: 'ELEMENT_HOVER';
  payload: ElementHoverPayload;
  timestamp: number;
}

export interface ElementHoverEndMessage {
  type: 'ELEMENT_HOVER_END';
  payload: ElementHoverEndPayload;
  timestamp: number;
}

export interface ElementsScannedMessage {
  type: 'ELEMENTS_SCANNED';
  payload: ElementsScannedPayload;
  timestamp: number;
}

export interface RectUpdatedMessage {
  type: 'RECT_UPDATED';
  payload: RectUpdatedPayload;
  timestamp: number;
}

export interface PageChangedMessage {
  type: 'PAGE_CHANGED';
  payload: PageChangedPayload;
  timestamp: number;
}

export interface WheelMessage {
  type: 'WHEEL';
  payload: WheelPayload;
  timestamp: number;
}

export interface ElementRectResponseMessage {
  type: 'ELEMENT_RECT_RESPONSE';
  payload: ElementRectResponsePayload;
  timestamp: number;
}

/**
 * Section rects an AI run is currently touching. The editor canvas draws the
 * glow rings from these (ViewportFrame → AIGlowRings) — the ring bleeds well
 * outside its box, so inside the iframe it was sliced by the frame boundary.
 * Rects are viewport-relative, which equals document coordinates here: the
 * design iframe is sized to the whole page, so it never scrolls internally.
 * Empty array = run over, clear everything.
 */
export interface AIActiveRectsMessage {
  type: 'AI_ACTIVE_RECTS';
  payload: { rects: KeyedRect[] };
}

/**
 * The stream-preview container's box while markup streams in. Same reason as
 * AI_ACTIVE_RECTS: the ring paints outside its box and the container spans the
 * page width, so an in-iframe ring lost both side strokes to the frame edge.
 * Re-sent on every paint (the container grows); null = preview gone.
 */
export interface AIPreviewRectMessage {
  type: 'AI_PREVIEW_RECT';
  payload: { rect: ElementRect | null };
}

export interface KeyboardEventMessage {
  type: 'KEYBOARD_EVENT';
  payload: KeyboardEventPayload;
  timestamp: number;
}

export interface TextSelectionChangedMessage {
  type: 'TEXT_SELECTION_CHANGED';
  payload: TextSelectionChangedPayload;
  timestamp: number;
}

export interface MarkupChangedMessage {
  type: 'MARKUP_CHANGED';
  payload: MarkupChangedPayload;
  timestamp: number;
}

export interface ScreenshotCapturedMessage {
  type: 'SCREENSHOT_CAPTURED';
  payload: ScreenshotCapturedPayload;
  timestamp: number;
}

export interface ScreenshotFailedMessage {
  type: 'SCREENSHOT_FAILED';
  payload: ScreenshotFailedPayload;
  timestamp: number;
}

export interface EditModeExitedMessage {
  type: 'EDIT_MODE_EXITED';
  payload: EditModeExitedPayload;
  timestamp: number;
}

export interface DragElementDropMessage {
  type: 'DRAG_ELEMENT_DROP';
  payload: DragElementDropPayload;
  timestamp: number;
}

export interface DragElementExitIframeMessage {
  type: 'DRAG_ELEMENT_EXIT_IFRAME';
  payload: DragElementExitIframePayload;
  timestamp: number;
}

export interface GridGeometryResponseMessage {
  type: 'GRID_GEOMETRY_RESPONSE';
  payload: GridGeometryResponsePayload;
  timestamp: number;
}

export interface ContentHeightMessage {
  type: 'CONTENT_HEIGHT';
  payload: ContentHeightPayload;
  timestamp: number;
}

export interface RectsUpdatedMessage {
  type: 'RECTS_UPDATED';
  payload: RectsUpdatedPayload;
  timestamp: number;
}

export interface ImagePreviewRefreshMessage {
  type: 'IMAGE_PREVIEW_REFRESH';
  payload: ImagePreviewRefreshPayload;
  timestamp: number;
}

export interface BgImagePreviewMessage {
  type: 'BG_IMAGE_PREVIEW';
  payload: BgImagePreviewPayload;
  timestamp: number;
}

export type IframeToParentMessage =
  | LocalRouteResultMessage
  | IframeReadyMessage
  | ElementClickMessage
  | ElementHoverMessage
  | ElementHoverEndMessage
  | ElementsScannedMessage
  | RectUpdatedMessage
  | PageChangedMessage
  | WheelMessage
  | ElementRectResponseMessage
  | AIActiveRectsMessage
  | AIPreviewRectMessage
  | KeyboardEventMessage
  | TextSelectionChangedMessage
  | MarkupChangedMessage
  | ScreenshotCapturedMessage
  | ScreenshotFailedMessage
  | EditModeExitedMessage
  | DragElementDropMessage
  | DragElementExitIframeMessage
  | GridGeometryResponseMessage
  | ContentHeightMessage
  | RectsUpdatedMessage
  | ImagePreviewRefreshMessage
  | BgImagePreviewMessage
  | ElementSectionHtmlMessage
  | ElementCopyHtmlMessage
  | LayoutVerifiedMessage;

// --- Discriminated Union Messages (Parent -> Iframe) ---

export interface UpdateClassesMessage {
  type: 'UPDATE_CLASSES';
  payload: UpdateClassesPayload;
}

/** Same-document pre-paint payload refresh; rejected if origin/path/query changed. */
export interface SyncLocalOverridesFragmentMessage {
  type: 'SYNC_LOCAL_OVERRIDES_FRAGMENT';
  payload: { url: string };
}

export interface SyncClassesToIframeMessage {
  type: 'SYNC_CLASSES_TO_IFRAME';
  payload: UpdateClassesPayload;
}

export interface SetContextMessage {
  type: 'SET_CONTEXT';
  payload: SetContextPayload;
}

export interface RequestElementRectMessage {
  type: 'REQUEST_ELEMENT_RECT';
  payload: RequestElementRectPayload;
}

export interface CaptureScreenshotMessage {
  type: 'CAPTURE_SCREENSHOT';
  payload: CaptureScreenshotPayload;
}

export interface WrapSelectionInLinkMessage {
  type: 'WRAP_SELECTION_IN_LINK';
  payload: WrapSelectionInLinkPayload;
}

export interface UnwrapLinkMessage {
  type: 'UNWRAP_LINK';
  payload: UnwrapLinkPayload;
}

export interface SetElementStyleMessage {
  type: 'SET_ELEMENT_STYLE';
  payload: { key: string; styles: Record<string, string> };
}

export interface TransferAssetMessage {
  type: 'TRANSFER_ASSET';
  payload: TransferAssetPayload;
}

export interface SetFontsCssMessage {
  type: 'SET_FONTS_CSS';
  payload: { css: string };
}

export interface UpdateTextMessage {
  type: 'UPDATE_TEXT';
  payload: UpdateTextPayload;
}

export interface UpdateInstanceOverrideMessage {
  type: 'UPDATE_INSTANCE_OVERRIDE';
  payload: UpdateInstanceOverridePayload;
}

export interface UpdateLinkAttributeMessage {
  type: 'UPDATE_LINK_ATTRIBUTE';
  payload: UpdateLinkAttributePayload;
}

export interface UpdateImageAttributeMessage {
  type: 'UPDATE_IMAGE_ATTRIBUTE';
  payload: UpdateImageAttributePayload;
}

export interface SimulateClickMessage {
  type: 'SIMULATE_CLICK';
  payload: SimulateClickPayload;
}

export interface SqWriteClassesMessage {
  type: 'SQ_WRITE_CLASSES';
  payload: SqWriteClassesPayload;
}

export interface SqWriteTextMessage {
  type: 'SQ_WRITE_TEXT';
  payload: SqWriteTextPayload;
}

export interface SqWriteImageMessage {
  type: 'SQ_WRITE_IMAGE';
  payload: SqWriteImagePayload;
}

export interface ReorderElementsMessage {
  type: 'REORDER_ELEMENTS';
  payload: ReorderElementsPayload;
}

export interface ReparentElementDomMessage {
  type: 'REPARENT_ELEMENT_DOM';
  payload: ReparentElementDomPayload;
}

export interface RequestGridGeometryMessage {
  type: 'REQUEST_GRID_GEOMETRY';
  payload: RequestGridGeometryPayload;
}

export interface EnterEditModeMessage {
  type: 'ENTER_EDIT_MODE';
  payload: EnterEditModePayload;
}

export interface RestoreOriginalTextMessage {
  type: 'RESTORE_ORIGINAL_TEXT';
  payload: RestoreOriginalTextPayload;
}

export interface RestoreOriginalClassesMessage {
  type: 'RESTORE_ORIGINAL_CLASSES';
  payload: RestoreOriginalClassesPayload;
}

export interface ClassIntentSettledMessage {
  type: 'CLASS_INTENT_SETTLED';
  payload: ClassIntentSettledPayload;
}

export interface RestoreOriginalImageAttributesMessage {
  type: 'RESTORE_ORIGINAL_IMAGE_ATTRIBUTES';
  payload: RestoreOriginalImageAttributesPayload;
}

export interface SetLinkInteractingMessage {
  type: 'SET_LINK_INTERACTING';
  payload: SetLinkInteractingPayload;
}

export interface InsertDrawnElementMessage {
  type: 'INSERT_DRAWN_ELEMENT';
  payload: InsertDrawnElementPayload;
}

export interface RemoveDrawnElementMessage {
  type: 'REMOVE_DRAWN_ELEMENT';
  payload: RemoveDrawnElementPayload;
}

export interface RemoveElementFromDomMessage {
  type: 'REMOVE_ELEMENT_FROM_DOM';
  payload: RemoveElementFromDomPayload;
}

export interface CloneElementInDomMessage {
  type: 'CLONE_ELEMENT_IN_DOM';
  payload: CloneElementInDomPayload;
}

export interface DragElementStartMessage {
  type: 'DRAG_ELEMENT_START';
  payload: DragElementStartPayload;
}

export interface DragElementMoveMessage {
  type: 'DRAG_ELEMENT_MOVE';
  payload: DragElementMovePayload;
}

export interface DragElementEndMessage {
  type: 'DRAG_ELEMENT_END';
  payload: DragElementEndPayload;
}

export interface DragElementReenterIframeMessage {
  type: 'DRAG_ELEMENT_REENTER_IFRAME';
  payload: DragElementReenterIframePayload;
}

export interface RequestPreviewRefreshMessage {
  type: 'REQUEST_PREVIEW_REFRESH';
  payload: RequestPreviewRefreshPayload;
}

export interface SetAIActiveHighlightsMessage {
  type: 'SET_AI_ACTIVE_HIGHLIGHTS';
  payload: { keys: string[] };
}

export interface GetElementSectionHtmlMessage {
  type: 'GET_ELEMENT_SECTION_HTML';
  payload: { key: string };
}

export interface GetElementCopyHtmlMessage {
  type: 'GET_ELEMENT_COPY_HTML';
  payload: { key: string; requestId: string };
}

export interface VerifyLayoutMessage {
  type: 'VERIFY_LAYOUT';
  payload: { requestId: string; keys: string[] };
}

export interface LayoutVerifiedFinding {
  key: string;
  severity: 'error' | 'warning';
  issue: string;
  suggestion: string;
}

export interface LayoutVerifiedMessage {
  type: 'LAYOUT_VERIFIED';
  payload: { requestId: string; findings: LayoutVerifiedFinding[] };
  timestamp: number;
}

export interface ElementSectionHtmlPayload {
  key: string;
  html: string | null;
}

export interface ElementSectionHtmlMessage {
  type: 'ELEMENT_SECTION_HTML';
  payload: ElementSectionHtmlPayload;
  timestamp: number;
}

export interface ElementCopyHtmlPayload {
  requestId: string;
  key: string;
  html: string | null;
}

export interface ElementCopyHtmlMessage {
  type: 'ELEMENT_COPY_HTML';
  payload: ElementCopyHtmlPayload;
  timestamp: number;
}

export interface RequestLocalRouteMessage { type: 'REQUEST_LOCAL_ROUTE'; payload: { requestId: string } }
export interface RequestLocalScanMessage { type: 'REQUEST_LOCAL_SCAN'; payload: { href: string; documentId?: string } }
export interface LocalRouteResultMessage { type: 'LOCAL_ROUTE_RESULT'; payload: { requestId: string; href: string; documentId?: string } }

export type ParentToIframeMessage =
  | RequestLocalRouteMessage
  | RequestLocalScanMessage
  | UpdateClassesMessage
  | SyncLocalOverridesFragmentMessage
  | SyncClassesToIframeMessage
  | SetContextMessage
  | RequestElementRectMessage
  | WrapSelectionInLinkMessage
  | UnwrapLinkMessage
  | CaptureScreenshotMessage
  | SetElementStyleMessage
  | TransferAssetMessage
  | UpdateTextMessage
  | UpdateInstanceOverrideMessage
  | UpdateLinkAttributeMessage
  | UpdateImageAttributeMessage
  | SimulateClickMessage
  | SqWriteClassesMessage
  | SqWriteTextMessage
  | SqWriteImageMessage
  | ReorderElementsMessage
  | ReparentElementDomMessage
  | RequestGridGeometryMessage
  | EnterEditModeMessage
  | RestoreOriginalTextMessage
  | RestoreOriginalClassesMessage
  | ClassIntentSettledMessage
  | RestoreOriginalImageAttributesMessage
  | SetLinkInteractingMessage
  | InsertDrawnElementMessage
  | RemoveDrawnElementMessage
  | RemoveElementFromDomMessage
  | CloneElementInDomMessage
  | DragElementStartMessage
  | DragElementMoveMessage
  | DragElementEndMessage
  | DragElementReenterIframeMessage
  | RequestPreviewRefreshMessage
  | SetAIActiveHighlightsMessage
  | GetElementSectionHtmlMessage
  | GetElementCopyHtmlMessage
  | VerifyLayoutMessage
  | { type: 'SET_VARIABLES_CSS'; payload: { css: string } }
  | SetFontsCssMessage;
