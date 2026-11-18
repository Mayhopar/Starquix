/**
 * Bridge handler test harness.
 *
 * Mounts the real bridge part strings onto a fresh IFrameBridge constructor
 * in jsdom. `preview-template/public/scripts/bridge.js` is GENERATED from
 * these exact parts (scripts/build-bridge.mjs), so what this harness runs
 * IS the code the iframe ships — byte for byte, not a lookalike.
 *
 * The harness is intentionally minimal — methods the handlers call but
 * don't define (e.g. `addDesignModeListeners`, `sendToParent`) are
 * stubbed on `IFrameBridge.prototype` and replaced with `vi.fn()` spies
 * by callers.
 *
 * To extend coverage to other parts (events, scanning), add the part
 * string to PART_SOURCES in production order.
 */
import { vi } from 'vitest';
import { BRIDGE_HEAD_CONSTANTS } from '../head';
import { BRIDGE_UTILS } from '../utils';
import { BRIDGE_DOM_UPDATES } from '../dom-updates';
import { BRIDGE_SCANNING } from '../scanning';
import { BRIDGE_GEOMETRY } from '../geometry';
import { BRIDGE_ASSETS } from '../assets';
import { BRIDGE_FONTS } from '../fonts';
import { BRIDGE_BLOG } from '../blog';
import { BRIDGE_SELECTION } from '../selection';
import { BRIDGE_EDIT_MODE } from '../edit-mode';
import { BRIDGE_SOURCE_REFRESH } from '../source-refresh';
import { BRIDGE_LINKS } from '../links';
import { BRIDGE_TEXT_EDITING } from '../text-editing';
import { BRIDGE_VERIFY } from '../verify';
import { BRIDGE_STREAM_PREVIEW } from '../streamPreview';
import { BRIDGE_EVENTS } from '../events';
import { BRIDGE_STYLES } from '../styles';
import { BRIDGE_VH_PIN } from '../vh-pin';
import { BRIDGE_MESSAGING } from '../messaging';
import { BRIDGE_SCREENSHOTS } from '../screenshots';
import {
  SCAN_RETRY_BASE_MS,
  NAVIGATION_SETTLE_MS,
  SCAN_MAX_RETRIES,
  CLICK_MOVE_THRESHOLD_PX,
  DRAG_START_THRESHOLD_PX,
  DOUBLE_CLICK_THRESHOLD_MS,
  HOVER_THROTTLE_MS,
  SCAN_INITIAL_DELAY_MS,
} from '../../constants';

// Free helpers referenced by the part strings but defined in
// IFrameBridgeScript.ts outside the parts. Provide stubs so eval() succeeds.
const HARNESS_PRELUDE = `
  ${BRIDGE_HEAD_CONSTANTS}
  var SCAN_RETRY_BASE_MS = ${SCAN_RETRY_BASE_MS};
  var NAVIGATION_SETTLE_MS = ${NAVIGATION_SETTLE_MS};
  var SCAN_MAX_RETRIES = ${SCAN_MAX_RETRIES};
  var CLICK_MOVE_THRESHOLD_PX = ${CLICK_MOVE_THRESHOLD_PX};
  var DRAG_START_THRESHOLD_PX = ${DRAG_START_THRESHOLD_PX};
  var DOUBLE_CLICK_THRESHOLD_MS = ${DOUBLE_CLICK_THRESHOLD_MS};
  var HOVER_THROTTLE_MS = ${HOVER_THROTTLE_MS};
  var SCAN_INITIAL_DELAY_MS = ${SCAN_INITIAL_DELAY_MS};
  var isInIframe = false; // harness runs at top level (messaging part reads it)
  function loadTailwindCDN() {}
  // BRIDGE_SCANNING calls these; geometry/styles parts aren't mounted here.
  IFrameBridge.prototype.reportContentHeight = function() {};
  // All cross-part methods (blog, assets, selection, links, text-editing)
  // are mounted for real below — no stand-ins needed. sendToParent and other
  // editor-facing spies are installed per instance in the test constructor.

`;

export type HarnessBridge = {
  mode: 'design' | 'preview';
  styleElement: HTMLStyleElement | null;
  pendingClassUpdates: Array<Record<string, unknown>>;
  editingElement: HTMLElement | null;
  contextKey: string | null;
  savedSelectionRange: { key: string } | null;
  originalTextContent: string | null;
  linkInteracting: boolean;
  // Stubs callers may spy on — replaced with vi.fn() per instance.
  addDesignModeListeners: () => void;
  removeDesignModeListeners: () => void;
  updateDesignModeStyles: () => void;
  sendToParent: (msg: unknown) => void;
  scanElements: () => void;
  reportRectUpdate: (key: string, el: Element) => void;
  // Real prototype methods evaluated from BRIDGE_DOM_UPDATES:
  handleWriteClasses: (payload: {
    sourceLocation?: { file: string; line: number; column: number };
    requestId?: string;
    classes?: string;
  }) => void;
  handleReorderElements: (payload: { elementIds: string[] }) => void;
  handleReparentElementDom: (payload: {
    key: string;
    newParentKey: string | null;
    insertIndex?: number;
  }) => void;
  handleUpdateClasses: (
    payload: { key?: string; classes?: string; sourceLocation?: unknown; intent?: { epoch: string; seq: number; hold?: boolean } },
    isRetry?: boolean,
  ) => void;
  handleClassIntentSettled: (payload: { settled: Array<{ key: string; seq: number; epoch?: string }>; alive?: Array<{ key: string; seq: number; epoch?: string }> }) => void;
  classHoldFor: (el: Element | null) => { key: string; seq: number; settled: boolean } | null;
  _classHoldByKey: Record<string, { key: string; seq: number; settled: boolean; misses: number }>;
  _classHoldByEl: WeakMap<object, unknown>;
  _classSettledSeq: Record<string, number>;
  _classSeqEpoch: string | null;
  _classAliveAt: number;
  _morphSeq: number;
  _pendingAssetClasses: Record<string, unknown>;
  _classSeqHigh: Record<string, number>;
  applySourceHtml: (html: string) => Promise<void>;
  handleUpdateText: (payload: { key: string; textContent: string }) => void;
  handleUpdateSlotPlaceholder: (payload: { key: string; collectionName?: string }) => void;
  handleInsertDrawnElement: (payload: Record<string, unknown>) => void;
  handleRemoveDrawnElement: (payload: { key: string }) => void;
  handleSetVariablesCSS: (payload: { css: string }) => void;
  handleSetFontsCss: (payload: { css?: string } | null) => void;
  handleRepaintFixed: () => void;
  armFixedRepaintOnResize: () => void;
  registerHandlers: () => void;
  _handlers: Record<string, (p: unknown) => void>;
  handleTransferAsset: (payload: { assetId: string; arrayBuffer: ArrayBuffer; mimeType?: string }) => void;
  _assetMap: Record<string, string>;
  handleRender: (payload: Record<string, unknown>) => void;
  handleUpdateInstanceOverride: (payload: Record<string, unknown>) => void;
  // Utility methods from BRIDGE_UTILS (also evaluated):
  findElementByKey: (key: string) => Element | null;
  getElementClasses: (el: Element) => string;
  getElementKey: (el: Element) => string;
  parseInstanceKey: (key: string) => { instanceId: string; selector: string } | null;
  // Text-editing handlers from BRIDGE_TEXT_EDITING (also evaluated):
  handleEnterEditMode: (payload: { key: string; originalText?: string }) => void;
  handleRestoreOriginalText: (payload: { key: string }) => void;
  originalTextByKey: Record<string, string>;
  // task-151 pre-override baselines + their restore handlers.
  originalClassesByKey: Record<string, string>;
  originalImageAttrsByKey: Record<string, Record<string, string | null>>;
  _restoringClasses: boolean;
  _restoringImageAttrs: boolean;
  handleRestoreOriginalClasses: (payload: {
    key: string;
    fallbackClasses?: string;
    sourceLocation?: unknown;
    intent?: { epoch: string; seq: number; hold?: boolean };
  }) => void;
  handleRestoreOriginalImageAttributes: (payload: { key: string; attributes?: string[] }) => void;
  // Link handlers from BRIDGE_LINKS (also evaluated):
  handleWrapSelectionInLink: (payload: { key: string; href: string; target?: string }) => void;
  handleUnwrapLink: (payload: { key: string; linkSelector?: string }) => void;
  sanitizeLinkHtml: (innerHTML: string) => string;
  hasBlockChildren: (element: Element) => boolean;
  editedInlineMarkup: (element: Element) => string | null;
  resolveMarkupTarget: (element: Element, key: string) => { element: Element; key: string };
  isInstanceChildKey: (key: string) => boolean;
  reconstructRangeFromSaved: (saved: unknown, element: Element | null) => Range | null;
  scanThen: (cb?: () => void) => void;
  // Preview mode from BRIDGE_EVENTS (task-116). addDesignModeListeners /
  // removeDesignModeListeners / updateDesignModeStyles stay instance spies —
  // `delete bridge.updateDesignModeStyles` opts into the real BRIDGE_STYLES one.
  handleSetMode: (payload: { mode?: string } | null) => void;
  handlePreviewLinkClick: (event: MouseEvent) => void;
  handlePreviewKeyDown: (event: KeyboardEvent) => void;
  previewListenersActive: boolean;
  boundPreviewNavClick: ((e: MouseEvent) => void) | null;
  boundPreviewKeyDown: ((e: KeyboardEvent) => void) | null;
  listenersActive: boolean;
  toggleDesignModeListeners: (add: boolean) => void;
  // Messaging part (task-120): ready notification + ASSETS_OWNED emission.
  notifyReady: () => void;
  // Local pre-paint override apply (#sq-ov fragment) + its scan stash.
  preApplyLocalOverrides: () => void;
  _preAppliedFileClasses: Record<string, string>;
  // Seamless canvas source refresh (BRIDGE_SOURCE_REFRESH).
  installSourceRefresh: () => void;
  requestSourceRefresh: () => void;
  documentBoundary: (reason: string) => void;
  onEditExitedForRefresh: () => void;
  flushTextDraft: () => void;
  _refreshDone: Promise<void>;
  _refreshRetry: ReturnType<typeof setTimeout> | null;
  // task-133: structural write relays (BRIDGE_EDIT_MODE).
  handleWriteInsert: (payload: unknown) => void;
  handleWriteAppendPage: (payload: unknown) => void;
  handleWriteRemove: (payload: unknown) => void;
  handleWriteMove: (payload: unknown) => void;
  handleWriteImport: (payload: unknown) => void;
  handleWriteRestore: (payload: unknown) => void;
  handleWriteRestoreRegion: (payload: unknown) => void;
  // task-141: ⌘K Media placeholder styles (BRIDGE_STYLES).
  injectMediaPlaceholderStyles: () => void;
  // task-141: direct canvas file drop (BRIDGE_EVENTS).
  handleFileDragOver: (event: {
    dataTransfer: { types?: string[]; dropEffect?: string } | null;
    preventDefault: () => void;
    target?: EventTarget | null;
  }) => void;
  handleFileDrop: (event: {
    dataTransfer: { files: File[] } | null;
    preventDefault: () => void;
    stopPropagation: () => void;
    target?: EventTarget | null;
  }) => void;
};

let cached: { ctor: { new (): HarnessBridge } } | null = null;

function buildBridgeConstructor(): { new (): HarnessBridge } {
  if (cached) return cached.ctor;

  function IFrameBridge(this: HarnessBridge) {
    this.mode = 'design';
    this.styleElement = null;
    this.pendingClassUpdates = [];
    this.editingElement = null;
    this.contextKey = null;
    this.savedSelectionRange = null;
    this.originalTextContent = null;
    this.originalTextByKey = {};
    // task-151 pre-override baselines (real ctor: IFrameBridgeScript.ts).
    this.originalClassesByKey = {};
    this.originalImageAttrsByKey = {};
    this._restoringClasses = false;
    this._restoringImageAttrs = false;
    // instant-edit P0b class-intent state (real ctor: IFrameBridgeScript.ts).
    this._classHoldByKey = {};
    this._classHoldByEl = new WeakMap();
    this._classSeqHigh = {};
    this._classSettledSeq = {};
    this._classSeqEpoch = null;
    this._classAliveAt = 0;
    this._morphSeq = 0;
    this._assetMap = {};
    this._pendingAssetClasses = {};
    this.linkInteracting = false;
    this.previewListenersActive = false;
    this.boundPreviewNavClick = null;
    this.boundPreviewKeyDown = null;
    this.listenersActive = true; // design mode starts with its listeners attached
    // vi.fn() so individual tests can inspect calls without re-stubbing.
    this.addDesignModeListeners = vi.fn();
    this.removeDesignModeListeners = vi.fn();
    this.updateDesignModeStyles = vi.fn();
    this.sendToParent = vi.fn();
    this.scanElements = vi.fn();
    this.reportRectUpdate = vi.fn();
    this.installSourceRefresh();
  }

  const src = HARNESS_PRELUDE + '\n' + BRIDGE_UTILS + '\n' + BRIDGE_DOM_UPDATES + '\n' +
    BRIDGE_SCANNING + '\n' + BRIDGE_GEOMETRY + '\n' + BRIDGE_TEXT_EDITING + '\n' + BRIDGE_LINKS + '\n' +
    BRIDGE_ASSETS + '\n' + BRIDGE_FONTS + '\n' + BRIDGE_BLOG + '\n' + BRIDGE_SELECTION + '\n' + BRIDGE_EDIT_MODE + '\n' + BRIDGE_SOURCE_REFRESH + '\n' + BRIDGE_VERIFY + '\n' +
    BRIDGE_STREAM_PREVIEW + '\n' + BRIDGE_STYLES + '\n' + BRIDGE_VH_PIN + '\n' + BRIDGE_SCREENSHOTS + '\n' +
    BRIDGE_EVENTS + '\n' + BRIDGE_MESSAGING;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('IFrameBridge', src)(IFrameBridge);

  cached = { ctor: IFrameBridge as unknown as { new (): HarnessBridge } };
  return cached.ctor;
}

export function mountBridgeForTest(): HarnessBridge {
  const Ctor = buildBridgeConstructor();
  return new Ctor();
}

export function resetHarnessDom(): void {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
}
