import { expect, it, vi } from 'vitest';
import { createEditorMetrics } from './editorMetrics';
it('records nothing when disabled and retains only the newest bounded samples', () => {
  const off = createEditorMetrics(false, () => 1, 2);
  off.record('selector');
  expect(off.read()).toEqual([]);
  const on = createEditorMetrics(true, () => 12, 2);
  on.record('selector', 1); on.record('tree-build', 2); on.record('scan', 3);
  expect(on.read()).toEqual([
    { name: 'tree-build', operation: 2, at: 12, amount: 1 },
    { name: 'scan', operation: 3, at: 12, amount: 1 },
  ]);
  on.clear(); expect(on.read()).toEqual([]);
});
it('disabled instrumentation never reads the clock and stores no document payload', () => {
  const now = vi.fn(() => 12);
  createEditorMetrics(false, now).record('selector');
  createEditorMetrics(true, now, 0).record('scan');
  expect(now).not.toHaveBeenCalled();
  const on = createEditorMetrics(true, now);
  on.record('selector', 42, 3);
  expect(Object.keys(on.read()[0])).toEqual(['name', 'operation', 'at', 'amount']);
  const copy = on.read() as unknown[]; copy.length = 0;
  expect(on.read()).toHaveLength(1);
});
it('keeps host diagnostics inert when session storage is unavailable', async () => {
  vi.resetModules();
  vi.stubGlobal('sessionStorage', new Proxy({}, { get() { throw new Error('Storage unavailable'); } }));
  const listener = vi.spyOn(window, 'addEventListener');
  try {
    const module = await import('./editorMetrics');
    expect(module.editorMetricsEnabled).toBe(false);
    module.recordEditorMetric('selector');
    expect(module.editorMetrics.read()).toEqual([]);
    expect((window as any).__SQ_EDITOR_METRICS__).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  } finally { listener.mockRestore(); vi.unstubAllGlobals(); vi.resetModules(); }
});
