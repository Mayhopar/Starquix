import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  reportExportEvent,
  setExportTelemetrySink,
  readExportEventBuffer,
  clearExportEventBuffer,
  subscribeToExportEvents,
  type ExportEventName,
  type ExportEventPayload,
  type ExportEventRecord,
} from '../exportTelemetry';

describe('exportTelemetry', () => {
  let captured: Array<{ name: ExportEventName; payload: ExportEventPayload }>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captured = [];
    setExportTelemetrySink({
      report(name, payload) {
        captured.push({ name, payload });
      },
    });
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setExportTelemetrySink(null);
    consoleErrSpy.mockRestore();
  });

  it('routes events to the installed sink', () => {
    reportExportEvent('export.started', { projectName: 'test' });
    reportExportEvent('export.completed', { projectName: 'test', fileCount: 42 });

    expect(captured).toEqual([
      { name: 'export.started', payload: { projectName: 'test' } },
      { name: 'export.completed', payload: { projectName: 'test', fileCount: 42 } },
    ]);
  });

  it('accepts all canonical event names without type error', () => {
    const names: ExportEventName[] = [
      'export.started',
      'export.completed',
      'export.failed',
      'build.started',
      'build.succeeded',
      'build.failed',
      'listing.missing',
      'shape.drift',
      'runtime.sync.completed',
      'runtime.sync.failed',
    ];
    for (const n of names) reportExportEvent(n);
    expect(captured.map((e) => e.name)).toEqual(names);
  });

  it('never throws into the caller when the sink fails', () => {
    setExportTelemetrySink({
      report() {
        throw new Error('sink exploded');
      },
    });

    expect(() => reportExportEvent('export.completed')).not.toThrow();
    expect(consoleErrSpy).toHaveBeenCalled();
  });

  it('supports an empty payload', () => {
    reportExportEvent('build.succeeded');
    expect(captured).toEqual([{ name: 'build.succeeded', payload: {} }]);
  });
});

describe('exportTelemetry default sink', () => {
  let consoleDebugSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setExportTelemetrySink(null);
    clearExportEventBuffer();
    consoleDebugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    consoleErrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    setExportTelemetrySink(null);
    clearExportEventBuffer();
    consoleDebugSpy.mockRestore();
    consoleErrSpy.mockRestore();
  });

  it('appends events to the localStorage ring buffer', () => {
    reportExportEvent('export.started', { projectName: 'a' });
    reportExportEvent('export.completed', { projectName: 'a', fileCount: 7 });
    const buf = readExportEventBuffer();
    expect(buf).toHaveLength(2);
    expect(buf[0].name).toBe('export.started');
    expect(buf[1].payload.fileCount).toBe(7);
    expect(typeof buf[0].ts).toBe('number');
  });

  it('routes shape.drift via console.error; happy events via console.debug', () => {
    reportExportEvent('export.completed', { projectName: 'a' });
    reportExportEvent('shape.drift', { location: 'x' });
    expect(consoleDebugSpy).toHaveBeenCalled();
    expect(consoleErrSpy).toHaveBeenCalled();
  });

  it('dispatches starquix:export-event on window with the record', () => {
    const captured: ExportEventRecord[] = [];
    const unsubscribe = subscribeToExportEvents((r) => captured.push(r));
    reportExportEvent('runtime.sync.completed', { fileCount: 3 });
    unsubscribe();
    expect(captured).toHaveLength(1);
    expect(captured[0].name).toBe('runtime.sync.completed');
    expect(captured[0].payload.fileCount).toBe(3);
  });

  it('caps the ring buffer at BUFFER_MAX (drops oldest)', () => {
    for (let i = 0; i < 520; i += 1) {
      reportExportEvent('runtime.sync.completed', { i });
    }
    const buf = readExportEventBuffer();
    expect(buf.length).toBeLessThanOrEqual(500);
    expect(buf[buf.length - 1].payload.i).toBe(519);
  });

  it('clearExportEventBuffer empties the store', () => {
    reportExportEvent('export.started');
    expect(readExportEventBuffer()).toHaveLength(1);
    clearExportEventBuffer();
    expect(readExportEventBuffer()).toEqual([]);
  });

  it('subscribe returns an unsubscribe that actually stops delivery', () => {
    const captured: ExportEventRecord[] = [];
    const unsubscribe = subscribeToExportEvents((r) => captured.push(r));
    reportExportEvent('export.started');
    unsubscribe();
    reportExportEvent('export.completed');
    expect(captured.map((r) => r.name)).toEqual(['export.started']);
  });
});
