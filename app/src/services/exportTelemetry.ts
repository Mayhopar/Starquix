/**
 * Export telemetry. Single source for "what did the export do?" events.
 *
 * The default sink is real, not a stub: it (1) console-logs with severity
 * routing, (2) appends to a bounded ring buffer in localStorage
 * (starquix:export-events) for post-hoc inspection, and (3) dispatches
 * a CustomEvent('starquix:export-event') on `window` so devtools and
 * future backend sinks (Sentry, Datadog) can subscribe from anywhere
 * without importing this module.
 *
 * Swap the default via setExportTelemetrySink to install a real backend.
 *
 * Events intentionally cover both happy path (export.completed) and
 * failure modes (export.failed, shape.drift, listing.missing).
 */

export type ExportEventName =
  | 'export.started'
  | 'export.completed'
  | 'export.failed'
  | 'build.started'
  | 'build.succeeded'
  | 'build.failed'
  | 'listing.missing'
  | 'shape.drift'
  | 'runtime.sync.completed'
  | 'runtime.sync.failed';

export interface ExportEventPayload {
  // Free-form — each event defines its own keys. Keep top-level scalar
  // so future metric backends can index without a custom parser.
  [key: string]: string | number | boolean | null | undefined;
}

export interface ExportEventRecord {
  name: ExportEventName;
  payload: ExportEventPayload;
  ts: number;
}

interface Sink {
  report(name: ExportEventName, payload: ExportEventPayload): void;
}

const STORAGE_KEY = 'starquix:export-events';
const BUFFER_MAX = 500;
const DOM_EVENT = 'starquix:export-event';

// In-memory ring buffer is the source of truth. localStorage is a
// best-effort mirror so the buffer survives reloads; if it's unavailable
// (SSR, test env quirks, quota) we just skip the mirror and keep going.
const memoryBuffer: ExportEventRecord[] = [];

// Throttle the localStorage mirror: serializing 500 entries on every
// event is O(n²) cumulatively during a busy session (shape.drift +
// runtime.sync.* can fire dozens per second). Flushing at most once
// per MIRROR_THROTTLE_MS keeps the memory buffer lossless while
// amortizing the serialize cost.
const MIRROR_THROTTLE_MS = 500;
let mirrorScheduled = false;

function consoleReport(name: ExportEventName, payload: ExportEventPayload): void {
  const severity: 'debug' | 'warn' | 'error' =
    name.endsWith('.failed') || name === 'shape.drift' || name === 'listing.missing'
      ? 'error'
      : 'debug';
  const fn = console[severity] ?? console.log;
  fn(`[starquix/export] ${name}`, payload);
}

function flushMirror(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(memoryBuffer));
  } catch {
    /* quota exceeded / storage unavailable — memory buffer still works */
  }
}

function scheduleMirror(): void {
  if (mirrorScheduled) return;
  if (typeof setTimeout === 'undefined') {
    flushMirror();
    return;
  }
  mirrorScheduled = true;
  setTimeout(() => {
    mirrorScheduled = false;
    flushMirror();
  }, MIRROR_THROTTLE_MS);
}

function pushToRingBuffer(record: ExportEventRecord): void {
  memoryBuffer.push(record);
  while (memoryBuffer.length > BUFFER_MAX) memoryBuffer.shift();
  scheduleMirror();
}

function dispatchDomEvent(record: ExportEventRecord): void {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(DOM_EVENT, { detail: record }));
  } catch {
    /* environments without CustomEvent just skip */
  }
}

const defaultSink: Sink = {
  report(name, payload) {
    const record: ExportEventRecord = { name, payload, ts: Date.now() };
    consoleReport(name, payload);
    pushToRingBuffer(record);
    dispatchDomEvent(record);
  },
};

let activeSink: Sink = defaultSink;

export function setExportTelemetrySink(sink: Sink | null): void {
  activeSink = sink ?? defaultSink;
}

export function reportExportEvent(
  name: ExportEventName,
  payload: ExportEventPayload = {},
): void {
  try {
    activeSink.report(name, payload);
  } catch (err) {
    // Telemetry must never throw into the caller.
    console.error('[starquix/export] telemetry sink threw:', err);
  }
}

/**
 * Read the current ring buffer. Useful for the export-diff devtool,
 * bug-report gathering, and post-mortem analysis.
 */
export function readExportEventBuffer(): ExportEventRecord[] {
  return memoryBuffer.slice();
}

/** Clear the ring buffer — useful before a repro run. */
export function clearExportEventBuffer(): void {
  memoryBuffer.length = 0;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Subscribe to events as they fire. Returns an unsubscribe function.
 * Works anywhere `window` is available — i.e. the React app. Useful for
 * building in-app telemetry panels without importing this module.
 */
export function subscribeToExportEvents(
  listener: (record: ExportEventRecord) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<ExportEventRecord>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(DOM_EVENT, handler);
  return () => window.removeEventListener(DOM_EVENT, handler);
}
