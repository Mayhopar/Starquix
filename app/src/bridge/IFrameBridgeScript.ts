/**
 * IFrameBridge Script — Assembler
 *
 * This file assembles the IFrameBridge from its parts.
 * Each part is a template string fragment containing related
 * functions and prototype methods.
 *
 * The assembled script is injected into iframes as a single IIFE.
 * There is no module system inside the iframe — all parts share
 * a single function scope after concatenation.
 *
 * IMPORTANT: This is a template string. Constants are inlined at build time.
 */

import {
  SCAN_RETRY_BASE_MS,
  NAVIGATION_SETTLE_MS,
  DOUBLE_CLICK_THRESHOLD_MS,
  HOVER_THROTTLE_MS,
  SCAN_INITIAL_DELAY_MS,
  SCAN_MAX_RETRIES,
  CLICK_MOVE_THRESHOLD_PX,
  DRAG_START_THRESHOLD_PX,
} from './constants.ts';

import { BRIDGE_HEAD_CONSTANTS } from './parts/head.ts';
import { BRIDGE_UTILS } from './parts/utils.ts';
import { BRIDGE_FLOW_DRAG } from './parts/flow-drag.ts';
import { BRIDGE_STYLES } from './parts/styles.ts';
import { BRIDGE_VH_PIN } from './parts/vh-pin.ts';
import { BRIDGE_SCANNING } from './parts/scanning.ts';
import { BRIDGE_MESSAGING } from './parts/messaging.ts';
import { BRIDGE_SCREENSHOTS } from './parts/screenshots.ts';
import { BRIDGE_GEOMETRY } from './parts/geometry.ts';
import { BRIDGE_DOM_UPDATES } from './parts/dom-updates.ts';
import { BRIDGE_TEXT_EDITING } from './parts/text-editing.ts';
import { BRIDGE_LINKS } from './parts/links.ts';
import { BRIDGE_EVENTS } from './parts/events.ts';
import { BRIDGE_ASSETS } from './parts/assets.ts';
import { BRIDGE_FONTS } from './parts/fonts.ts';
import { BRIDGE_BLOG } from './parts/blog.ts';
import { BRIDGE_SELECTION } from './parts/selection.ts';
import { BRIDGE_EDIT_MODE } from './parts/edit-mode.ts';
import { BRIDGE_SOURCE_REFRESH } from './parts/source-refresh.ts';
import { BRIDGE_VERIFY } from './parts/verify.ts';
import { BRIDGE_STREAM_PREVIEW } from './parts/streamPreview.ts';

/**
 * The IFrameBridge script as a string for injection.
 * Constants are substituted at bundle time via template literals.
 */
export const IFRAME_BRIDGE_SCRIPT = `
(function() {
  if (window.__SQ_BRIDGE__) return;
  window.__SQ_BRIDGE__ = true;

  var isInIframe = window.parent !== window;

  var SCAN_RETRY_BASE_MS = ${SCAN_RETRY_BASE_MS};
  var NAVIGATION_SETTLE_MS = ${NAVIGATION_SETTLE_MS};
  var DOUBLE_CLICK_THRESHOLD_MS = ${DOUBLE_CLICK_THRESHOLD_MS};
  var HOVER_THROTTLE_MS = ${HOVER_THROTTLE_MS};
  var SCAN_INITIAL_DELAY_MS = ${SCAN_INITIAL_DELAY_MS};
  var SCAN_MAX_RETRIES = ${SCAN_MAX_RETRIES};
  var CLICK_MOVE_THRESHOLD_PX = ${CLICK_MOVE_THRESHOLD_PX};
  var DRAG_START_THRESHOLD_PX = ${DRAG_START_THRESHOLD_PX};
  ${BRIDGE_HEAD_CONSTANTS}

  // Load Tailwind CDN for instant visual updates (no JIT compilation needed)
  function loadTailwindCDN() {
    if (window.__TAILWIND_CDN_LOADED__) return;
    window.__TAILWIND_CDN_LOADED__ = true;

    var script = document.createElement('script');
    script.src = '/scripts/tailwind.js';
    script.onload = function() {
      // Check if tailwind object is available
      var checkCount = 0;
      var checkInterval = setInterval(function() {
        checkCount++;
        if (typeof tailwind !== 'undefined') {
          clearInterval(checkInterval);
          tailwind.config = { corePlugins: { preflight: false } };
        } else if (checkCount > 30) {
          clearInterval(checkInterval);
          console.error('[IFrameBridge] ❌ Tailwind object never became available');
        }
      }, 100);
    };
    script.onerror = function(e) {
      console.error('[IFrameBridge] ❌ Tailwind CDN failed to load:', e);
    };
    document.head.appendChild(script);
  }

  // ── Parts ──────────────────────────────────────────────

  ${BRIDGE_UTILS}

  ${BRIDGE_FLOW_DRAG}

  // ── IFrameBridge Constructor ───────────────────────────

  function IFrameBridge() {
    this.throttledHover = null;
    this.isDragging = false;
    this.mouseDownTarget = null;
    this.mouseDownPos = { x: 0, y: 0 };
    this.lastClickKey = null;
    this.lastClickTime = 0;
    this.lastHoveredKey = null;
    this.contextKey = null;
    this.mode = 'design';
    this.currentPath = window.location.pathname;
    this.styleElement = null;
    this.mutationObserverStarted = false;
    this.listenersActive = false;
    this.boundHandlers = null;
    this.previewListenersActive = false; // task-116: preview listeners attached?
    this.boundPreviewNavClick = null;    // bound once, so add/remove match
    this.boundPreviewKeyDown = null;
    this.pendingClassUpdates = [];  // Queue for class updates waiting for elements
    this.elementsReady = false;      // True after first successful ELEMENTS_SCANNED
    this.editingElement = null;      // Currently editing element (contentEditable)
    this.editBlurHandler = null;     // Handler for element blur to exit edit mode
    this.windowBlurHandler = null;   // Handler for window blur to exit edit mode
    this.originalTextContent = null; // Text before editing started
    this.originalTextByKey = {};     // Map of key -> original text for undo support
    // task-151: pre-override baselines the undo observers restore to. The iframe
    // is the only place that ever holds the element as the SOURCE renders it —
    // captured first-wins when an override is first applied, discarded with the
    // document on every reload. See handleRestoreOriginalClasses /
    // handleRestoreOriginalImageAttributes.
    this.originalClassesByKey = {};   // key -> class attribute before the first override
    this.originalImageAttrsByKey = {}; // key -> { attribute: value|null } before the first override
    // instant-edit P0b: class intents (parts/dom-updates.ts). A held key keeps its value until the file carries it.
    this._classHoldByKey = {};        // key -> hold
    this._classHoldByEl = new WeakMap();   // element -> hold
    this._classSeqHigh = {};          // key -> highest intent seq applied (survives a release)
    this._classSettledSeq = {};       // key -> highest seq the parent reported settled
    this._classSeqEpoch = null;
    this._classAliveAt = 0;
    this._morphSeq = 0;
    this._restoringClasses = false;    // suppresses the capture during a restore
    this._restoringImageAttrs = false;
    this._editGraceUntil = 0;       // Timestamp until which stray clicks are ignored
    this.savedSelectionRange = null; // Saved selection range for link wrapping when focus leaves iframe
    this.parentOrigin = null;        // Validated parent origin for secure postMessage
    this._styleElementCache = { key: null, element: null }; // Cache for SET_ELEMENT_STYLE lookups
    this._assetMap = {};  // assetId → iframe-origin blobUrl
    this._pendingAssetClasses = {};  // key → payload for deferred sq-asset: class resolution
    this._pendingAssetImages = {};   // key → payload for deferred sq-asset: image attr resolution
    this._blogCardInfo = [];         // Blog card metadata from last RENDER (for key re-assignment after HMR)
    this._blogCardKeysDirty = false; // Set true after RENDER; handleClick skips _ensureBlogCardKeys when false
    this._flowDrag = new FlowDragManager(this);
    this._preAppliedFileClasses = {}; // key → FILE class value, consumed by the FIRST scan (local pre-paint apply)
    this._handlers = {};
    this.registerHandlers();

    // Local mode: apply URL-fragment placement overrides BEFORE FIRST PAINT.
    // Must run here — the bridge <script> executes synchronously in <head>,
    // before any body element exists, which is the only moment early enough
    // to beat the parser to the placed elements (see preApplyLocalOverrides).
    this.preApplyLocalOverrides();
    // Seamless canvas: claim Vite's reloads and refresh in place (source-refresh.ts).
    this.installSourceRefresh();

    // Load Tailwind CDN for instant class updates
    loadTailwindCDN();

    window.addEventListener('message', this.handleMessage.bind(this));
    this.setupEventListeners();
    this.setupNavigationDetection();
    this.injectDesignModeStyles();
    this.armFixedRepaintOnResize();
    this.notifyReady();
  }

  // ── Prototype Methods (from parts) ─────────────────────

  ${BRIDGE_STYLES}

  ${BRIDGE_VH_PIN}

  ${BRIDGE_SCANNING}

  ${BRIDGE_MESSAGING}

  ${BRIDGE_SCREENSHOTS}

  ${BRIDGE_GEOMETRY}

  ${BRIDGE_DOM_UPDATES}

  ${BRIDGE_TEXT_EDITING}

  ${BRIDGE_LINKS}

  ${BRIDGE_EVENTS}

  ${BRIDGE_ASSETS}

  ${BRIDGE_FONTS}

  ${BRIDGE_BLOG}

  ${BRIDGE_SELECTION}

  ${BRIDGE_EDIT_MODE}

  ${BRIDGE_SOURCE_REFRESH}

  ${BRIDGE_VERIFY}

  ${BRIDGE_STREAM_PREVIEW}

  // ── Initialize ─────────────────────────────────────────

  window.__SQ_BRIDGE__ = new IFrameBridge();
})();
`;
