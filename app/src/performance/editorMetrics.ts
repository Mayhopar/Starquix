/** Opt-in, document-content-free counters. No subscriptions in the disabled path. */
export type MetricName = 'selector' | 'tree-build' | 'viewport-commit' | 'scan' | 'bridge-message';
export type Metric = { name: MetricName; operation: number; at: number; amount: number };
export interface EditorMetrics {
  record(name: MetricName, operation?: number, amount?: number): void;
  read(): readonly Metric[];
  clear(): void;
}
export function createEditorMetrics(enabled: boolean, now: () => number, capacity = 2_000): EditorMetrics {
  const samples: Metric[] = [];
  return {
    record(name, operation = 0, amount = 1) {
      if (!enabled || capacity <= 0) return;
      samples.push({ name, operation, at: now(), amount });
      if (samples.length > capacity) samples.splice(0, samples.length - capacity);
    },
    read: () => samples.slice(),
    clear: () => { samples.length = 0; },
  };
}
export const editorMetricsEnabled = (() => {
  try { return typeof sessionStorage !== 'undefined' && sessionStorage['sq:performance'] === '1'; }
  catch { return false; }
})();
let operation = 0;
export const editorMetrics = createEditorMetrics(editorMetricsEnabled, () => performance.timeOrigin + performance.now());
export function recordEditorMetric(name: MetricName): void {
  if (editorMetricsEnabled) editorMetrics.record(name, operation);
}
// This is diagnostics only: numeric operation correlation, never an editor mutation API.
if (editorMetricsEnabled && typeof window !== 'undefined') {
  Object.assign(window, { __SQ_EDITOR_METRICS__: {
    read: editorMetrics.read, clear: editorMetrics.clear,
    begin(id: number) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid performance operation');
      operation = id;
    },
  } });
}
