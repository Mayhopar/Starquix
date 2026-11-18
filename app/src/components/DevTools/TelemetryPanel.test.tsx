import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TelemetryPanel } from './TelemetryPanel';
import {
  reportExportEvent,
  clearExportEventBuffer,
  setExportTelemetrySink,
} from '@/services/exportTelemetry';

describe('TelemetryPanel', () => {
  beforeEach(() => {
    setExportTelemetrySink(null); // default sink (console + buffer + DOM event)
    clearExportEventBuffer();
    // Suppress the debug/error logs the default sink emits.
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearExportEventBuffer();
  });

  it('stays hidden until Cmd+Shift+T is pressed', () => {
    render(<TelemetryPanel />);
    expect(screen.queryByText(/Telemetry —/)).toBeNull();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'T', metaKey: true, shiftKey: true }),
      );
    });

    expect(screen.getByText(/Telemetry —/)).toBeInTheDocument();
  });

  it('rehydrates from the ring buffer on open', () => {
    reportExportEvent('export.started', { projectName: 'demo' });
    reportExportEvent('export.completed', { fileCount: 5 });

    render(<TelemetryPanel />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', ctrlKey: true, shiftKey: true }),
      );
    });

    expect(screen.getByText('export.started')).toBeInTheDocument();
    expect(screen.getByText('export.completed')).toBeInTheDocument();
    expect(screen.getByText(/Telemetry — 2 events/)).toBeInTheDocument();
  });

  it('appends live events dispatched after open', async () => {
    render(<TelemetryPanel />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }),
      );
    });

    expect(screen.getByText(/Telemetry — 0 events/)).toBeInTheDocument();

    act(() => {
      reportExportEvent('shape.drift', { location: 'readBlogSlotBinding' });
    });

    // Re-render is throttled (~100ms) to cope with bursty event streams.
    await waitFor(() => {
      expect(screen.getByText('shape.drift')).toBeInTheDocument();
    });
    expect(screen.getByText(/Telemetry — 1 events/)).toBeInTheDocument();
  });

  it('clear button empties the panel and the buffer', () => {
    reportExportEvent('export.started');
    render(<TelemetryPanel />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }),
      );
    });

    expect(screen.getByText('export.started')).toBeInTheDocument();

    fireEvent.click(screen.getByText('clear'));

    expect(screen.queryByText('export.started')).toBeNull();
    expect(screen.getByText(/Telemetry — 0 events/)).toBeInTheDocument();
  });

  it('Escape-like close button hides the panel', () => {
    render(<TelemetryPanel />);
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 't', metaKey: true, shiftKey: true }),
      );
    });
    expect(screen.getByText(/Telemetry —/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('×'));

    expect(screen.queryByText(/Telemetry —/)).toBeNull();
  });
});
