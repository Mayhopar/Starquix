/**
 * Base Vite Writer
 *
 * Shared infrastructure for browser-safe clients that write updates
 * to source files via the Astro dev server's Vite plugin.
 *
 * Subclasses only need to implement their specific write method.
 */

import { ImportBindingConflictError } from './sourceWriteFailure';
import {
  isCrossFileAtOrigin,
  isLocalCrossFileWrite,
  allowsCrossFileOverrideWrite,
  notifyLocalCrossFileWrite,
  type LocalWriteOrigin,
} from '@/utils/localWriteScope';

import { isServerWriteMode } from './serverWriteMode';

// Only a dispatched request whose ACK timed out is eligible for read-only recovery.
export class ViteWriteTimeoutError extends Error {
  constructor() { super('Write request timeout'); this.name = 'ViteWriteTimeoutError'; }
}

interface PendingRequest {
  resolve: (value: boolean | Record<string, unknown>) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  /** task-133: resolve the FULL result payload instead of `true` (extras like insertedLine ride on it) */
  full?: boolean;
}

export interface ViteWriterConfig {
  /**
   * Message type(s) the iframe sends back on completion (e.g. 'SQ_WRITE_RESULT').
   * task-133: an array lets one writer own several ops — requestIds are unique
   * per request, so a shared pending map can never cross-resolve.
   */
  resultMessageType: string | string[];
  /** Human-readable name for console warnings and error messages */
  writerName: string;
  /** Prefix for request IDs (default: 'req_') */
  requestIdPrefix?: string;
}

/**
 * Fired when a write request is actually put on the wire (all scope checks
 * passed). `ClassStoreContext` listens and records what the file is about to
 * render, because the ack that would confirm it is routinely destroyed by the
 * HMR reload the write itself triggers.
 */
let writeDispatchedListener:
  | ((messageType: string, payload: Record<string, unknown>) => void)
  | null = null;

export function setWriteDispatchedListener(
  fn: ((messageType: string, payload: Record<string, unknown>) => void) | null,
): void {
  writeDispatchedListener = fn;
}

function notifyWriteDispatched(messageType: string, payload: Record<string, unknown>): void {
  writeDispatchedListener?.(messageType, payload);
}

export abstract class BaseViteWriter {
  private pendingRequests = new Map<string, PendingRequest>();
  private localInstanceUrl: string | null = null; // task-132 local runtime
  private iframeRef: HTMLIFrameElement | null = null;
  private messageListenerSetup = false;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private readonly config: ViteWriterConfig;
  private readonly resultTypes: Set<string>;

  constructor(config: ViteWriterConfig) {
    this.config = config;
    this.resultTypes = new Set(
      Array.isArray(config.resultMessageType) ? config.resultMessageType : [config.resultMessageType]
    );

    // Subscribe to DevServerService to get Astro server URL

    this.setupMessageListener();
  }

  private setupMessageListener(): void {
    if (this.messageListenerSetup) return;
    this.messageListenerSetup = true;

    this.messageHandler = (event: MessageEvent) => {
      // Validate message source - must come from our iframe
      if (this.iframeRef && event.source !== this.iframeRef.contentWindow) {
        return;
      }

      const message = event.data;
      if (!message || typeof message.type !== 'string' || !this.resultTypes.has(message.type)) return;

      const payload = message.payload;
      if (!payload || !payload.requestId) return;

      const pending = this.pendingRequests.get(payload.requestId);
      if (pending) {
        clearTimeout(pending.timeoutId);
        this.pendingRequests.delete(payload.requestId);
        if (payload.success) {
          pending.resolve(pending.full ? payload : true);
        } else {
          pending.reject(message.type === 'SQ_WRITE_IMPORT_RESULT' && payload.code === 'import-binding-conflict' && payload.outcome === 'no-write'
            ? new ImportBindingConflictError(payload.error || 'Import binding conflict')
            : new Error(payload.error || 'Write failed'));
        }
      }
    };

    window.addEventListener('message', this.messageHandler);
  }

  setIframeRef(iframe: HTMLIFrameElement | null): void {
    this.iframeRef = iframe;
  }

  /**
   * Fed by ViewportFrame's real-instance effect (task-108 §2 paid tier). A
   * running real instance arms writes the same way a running :4321 does —
   * writes are origin-agnostic postMessage calls into the iframe, this URL
   * is only ever used as an availability gate, never as a request target.
   */
  /**
   * task-132 local mode: availability follows the spawned instance's
   * lifecycle — running arms, anything else disarms.
   */
  setLocalInstanceState(state: import('@/hooks/useLocalInstance').LocalInstanceLite | null): void {
    this.localInstanceUrl = state?.status === 'running' && state.url ? state.url : null;
  }

  /** Read-only pre-dispatch readiness; does not authorize or perform a write. */
  hasWriteFrame(iframe?: HTMLIFrameElement): boolean {
    return this.isAvailable() && !!this.iframeRef?.contentWindow && (!iframe || this.iframeRef === iframe);
  }

  isAvailable(): boolean {
    // task-108 §7: per-mode gate retires legacy-removal OQ3 — a running :4321
    // (or a running real instance, task-108 §2, or a task-132 local instance)
    // alone must not arm source-writes for WC-mode projects;
    // isServerWriteMode() gates that.
    return isServerWriteMode() && this.localInstanceUrl !== null;
  }

  /**
   * `masterWrite` is the ONE sanctioned way past the local write-scope law: an
   * explicit "Push changes to source" on a component instance, where writing
   * the master file for every page IS the user's request. The project variables
   * service also opts in for its required shared CSS import (an explicit
   * project-wide operation). Ordinary instance gestures must never do this
   * implicitly (data-loss incident 2026-08-02).
   */
  protected sendViaPostMessage(
    messageType: string,
    payload: Record<string, unknown>,
    masterWrite = false,
    origin?: LocalWriteOrigin,
    recoveryOwnsFailure = false,
  ): Promise<boolean> {
    return this.sendRequest(messageType, payload, false, masterWrite, origin, recoveryOwnsFailure) as Promise<boolean>;
  }

  /**
   * task-133: like sendViaPostMessage, but resolves the FULL success payload
   * (requestId, success, plus op extras like insertedLine/removedSource) so
   * callers can build undo records. Failure semantics are identical to the
   * boolean path: resolves `false` when writes aren't armed, rejects on
   * server error or timeout. Existing subclasses stay boolean-only.
   */
  protected sendViaPostMessageForPayload<T extends Record<string, unknown>>(
    messageType: string,
    payload: Record<string, unknown>,
    masterWrite = false,
    origin?: LocalWriteOrigin,
  ): Promise<T | false> {
    return this.sendRequest(messageType, payload, true, masterWrite, origin) as Promise<T | false>;
  }

  /**
   * The write tiers that already have a doc-overlay home — the SAME one WC
   * uses (sourceClasses / sourceText / sourceImageAttributes, persisted by
   * useSourceOverridesPersistence, re-applied by the ELEMENTS_SCANNED handler).
   * A cross-file write of one of these is simply not written to the master
   * file; the overlay carries it, exactly as in WC. Structural writes and the
   * media tag swap are NOT here — they have no overlay tier, so they keep the
   * refusal rather than silently doing nothing.
   * Message types are the ones the concrete writers send (ViteClassWriter /
   * ViteTextWriter / ViteImageWriter).
   */
  private static readonly OVERRIDE_TIER_MESSAGES = new Set([
    'SQ_WRITE_CLASSES',
    'SQ_WRITE_TEXT',
    'SQ_WRITE_IMAGE',
  ]);

  private sendRequest(
    messageType: string,
    payload: Record<string, unknown>,
    full: boolean,
    masterWrite = false,
    origin?: LocalWriteOrigin,
    recoveryOwnsFailure = false,
  ): Promise<boolean | Record<string, unknown>> {
    if (!this.isAvailable()) {
      console.warn(`[${this.config.writerName}] No write target available, skipping`);
      return Promise.resolve(false);
    }

    const contentWindow = this.iframeRef?.contentWindow;
    if (!contentWindow) {
      console.warn(`[${this.config.writerName}] Iframe ref not set, skipping write`);
      return Promise.resolve(false);
    }

    // THE local-mode write-scope law (utils/localWriteScope.ts, data-loss
    // incident 2026-08-02). Every source write — classes, text, image attrs,
    // tag swap, structural — carries the target file in `sourceLocation`, so
    // this ONE check covers them all and no future writer can slip past it.
    // From a page view the target must BE the page file: anything else is an
    // instance-scope edit of a shared component, which in normal (WC) Starquix
    // would have become an override and here would rewrite the master for every
    // page. The component view makes the component file the surface, so master
    // edits there are same-file and proceed unchanged.
    // task-174: this `typeof targetFile === 'string'` test is the law's ONLY
    // blind spot — a payload with no sourceLocation is not gated at all. Until
    // 2026-08-05 one writer exploited it (ViteVariablesWriter sent a bare
    // `{ css }`); it is deleted, so today EVERY source write carries a file and
    // the guard covers all of them. Keep it that way: the pin is 'every writer
    // payload carries a sourceLocation' in
    // vite-plugin/__tests__/writeBridgeSenderFieldParity.test.ts. A writer that
    // must reach a file outside the edited page needs `masterWrite`, not a
    // missing field.
    // task-181 / 2026-08-05: a DEFERRED write carries the surface it was made
    // on (`origin`, captured at gesture time by the class queue). Judging it
    // against the CURRENT surface asks a staler question than the queue already
    // answered, and silently dropped master edits made in the component view
    // when the user navigated back inside the 5 s debounce. One rule, two
    // clocks — both live in utils/localWriteScope.ts. No origin (every
    // immediate writer) → unchanged current-surface default-deny.
    const targetFile = (payload.sourceLocation as { file?: unknown } | undefined)?.file;
    const isCrossFile = (file: string) =>
      origin ? isCrossFileAtOrigin(origin, file) : isLocalCrossFileWrite(file);
    if (typeof targetFile === 'string' && !masterWrite && isCrossFile(targetFile)) {
      // task-149 (owner ruling 2026-08-03: local must behave EXACTLY like WC
      // from a PAGE view): the master is never written from a page view, and a
      // cross-file CLASS / TEXT / IMAGE edit there stays a doc overlay, exactly
      // as WC. From a MASTER surface the overlay is a dead letter — local pages
      // render files, never the session doc — so override-tier writes cross
      // into the component's own file instead (allowsCrossFileOverrideWrite,
      // 2026-08-27: "made Back fixed in the layout master, nothing propagated").
      // Everything else (structural insert/remove/move/import, tag swap) has no
      // overlay tier and keeps the honest refusal on every surface.
      if (BaseViteWriter.OVERRIDE_TIER_MESSAGES.has(messageType)) {
        if (!allowsCrossFileOverrideWrite(origin, targetFile)) {
          // Instance edit (Figma model, owner ruling 2026-09-10): absorbed
          // into the doc's source tiers, persisted per project by
          // hooks/useSourceOverridesPersistence, shown as `*` with Push /
          // Reset (store/localMasterOverrides). No file write, no refusal.
          return Promise.resolve(false);
        }
        // Master-surface gesture — fall through and dispatch to the component's file.
      } else {
        console.warn(
          `[${this.config.writerName}] refused ${messageType}: ${targetFile} is not the page being edited`,
        );
        notifyLocalCrossFileWrite(targetFile);
        return Promise.resolve(false);
      }
    }

    const prefix = this.config.requestIdPrefix ?? 'req_';
    const requestId = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const request = new Promise<boolean | Record<string, unknown>>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new ViteWriteTimeoutError());
        }
      }, 10000);

      this.pendingRequests.set(requestId, { resolve, reject, timeoutId, full });

      try {
        contentWindow.postMessage({
          type: messageType,
          payload: { ...payload, requestId }
        }, '*');
        // DISPATCHED — every scope check above has passed and the request is on
        // the wire, so the file is about to hold this value.
        //
        // The ack cannot carry this: writing the file makes the dev server
        // HMR-reload the very frame that owes us the response, so the reply is
        // routinely lost and the promise rejects with "Write request timeout"
        // (measured 2026-08-05, repeatedly, on writes that HAD landed).
        // Anything waiting on the ack — the reload badge's "what does the file
        // render now" half — would never learn the file moved.
        //
        // Deliberately NOT used for the write baseline, which must stay
        // strictly self-consistent with bytes known to be on disk.
        notifyWriteDispatched(messageType, payload);
      } catch (err) {
        this.pendingRequests.delete(requestId);
        clearTimeout(timeoutId);
        reject(err as Error);
      }
    });
    return request;
  }

  disconnect(): void {
    // Reject and clean up pending requests
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(`${this.config.writerName} disconnected`));
    }
    this.pendingRequests.clear();
    this.iframeRef = null;

    // Remove message event listener
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
      this.messageHandler = null;
      this.messageListenerSetup = false;
    }

    // Unsubscribe from DevServerService
  }
}
