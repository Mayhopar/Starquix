import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import {
  readExportEventBuffer,
  clearExportEventBuffer,
  subscribeToExportEvents,
  type ExportEventName,
  type ExportEventRecord,
} from '@/services/exportTelemetry';

/**
 * Dev-only floating panel that subscribes to the starquix:export-event
 * stream and shows events as they fire. Cmd/Ctrl + Shift + T toggles
 * visibility. Makes telemetry operationally visible: you can watch
 * events happen during a repro, filter by name, and copy the buffer as
 * JSON for bug reports.
 */

const SEVERITY = {
  'export.started': 'ok',
  'export.completed': 'ok',
  'export.failed': 'err',
  'build.started': 'ok',
  'build.succeeded': 'ok',
  'build.failed': 'err',
  'listing.missing': 'err',
  'shape.drift': 'err',
  'runtime.sync.completed': 'ok',
  'runtime.sync.failed': 'err',
} as const satisfies Record<ExportEventName, 'ok' | 'warn' | 'err'>;

const SEVERITY_CLASS: Record<'ok' | 'warn' | 'err', string> = {
  ok: 'text-success',
  warn: 'text-warning',
  err: 'text-error',
};

const PANEL_EVENT_CAP = 200;
const RENDER_THROTTLE_MS = 100;

export const TelemetryPanel = memo(function TelemetryPanel() {
  const [visible, setVisible] = useState(false);
  const [filter, setFilter] = useState<ExportEventName | ''>('');
  // events live in a ref so high-frequency telemetry doesn't re-render
  // per-event. A throttled forceRender keeps the UI fresh at ~10fps.
  const eventsRef = useRef<ExportEventRecord[]>([]);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const renderThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleRender = useCallback(() => {
    if (renderThrottleRef.current) return;
    renderThrottleRef.current = setTimeout(() => {
      renderThrottleRef.current = null;
      forceRender();
    }, RENDER_THROTTLE_MS);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!visible) return;
    eventsRef.current = readExportEventBuffer();
    forceRender();
    const unsubscribe = subscribeToExportEvents((r) => {
      const next = eventsRef.current.concat(r);
      eventsRef.current = next.length > PANEL_EVENT_CAP
        ? next.slice(next.length - PANEL_EVENT_CAP)
        : next;
      scheduleRender();
    });
    return () => {
      unsubscribe();
      if (renderThrottleRef.current) {
        clearTimeout(renderThrottleRef.current);
        renderThrottleRef.current = null;
      }
    };
  }, [visible, scheduleRender]);

  const onClear = useCallback(() => {
    clearExportEventBuffer();
    eventsRef.current = [];
    forceRender();
  }, []);

  const onCopy = useCallback(() => {
    const events = eventsRef.current;
    const filtered = filter ? events.filter((e) => e.name === filter) : events;
    const payload = JSON.stringify(filtered, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(payload);
    } else {
      console.log('[TelemetryPanel] clipboard unavailable, dumping buffer:');
      console.log(payload);
    }
  }, [filter]);

  if (!visible) return null;

  const events = eventsRef.current;
  const shown = filter ? events.filter((e) => e.name === filter) : events;
  // Cheap on a ~200-cap array; re-derived each render because `events`
  // is a mutable ref and memo deps can't track content changes.
  const names = Array.from(new Set(events.map((e) => e.name))).sort();

  return (
    <div className="fixed right-4 bottom-4 z-debug flex max-h-[60vh] w-[420px] flex-col gap-1.5 rounded-outer border border-stroke bg-bg p-2.5 font-mono text-2xs leading-snug text-text shadow-flyout">
      <div className="flex items-center gap-1.5">
        <strong className="flex-1">Telemetry — {events.length} events</strong>
        <Button variant="secondary" size="sm" label="clear" onClick={onClear} />
        <Button variant="secondary" size="sm" label="copy JSON" onClick={onCopy} />
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          aria-label="Close telemetry panel"
          label="×"
          onClick={() => setVisible(false)}
        />
      </div>

      <select
        value={filter}
        onChange={(e) => setFilter(e.target.value as ExportEventName | '')}
        className="rounded-inner border border-input-stroke bg-input-fill px-1 py-0.5 font-mono text-2xs text-text"
      >
        <option value="">All ({events.length})</option>
        {names.map((n) => (
          <option key={n} value={n}>
            {n} ({events.filter((e) => e.name === n).length})
          </option>
        ))}
      </select>

      <div className="min-h-[80px] flex-1 overflow-y-auto rounded-inner border border-stroke bg-bg-contrast p-1">
        {shown.length === 0 && (
          <div className="p-1.5 text-text-muted">No events yet.</div>
        )}
        {shown
          .slice()
          .reverse()
          .map((ev, i) => {
            const color = SEVERITY_CLASS[SEVERITY[ev.name] ?? 'warn'];
            const time = new Date(ev.ts).toLocaleTimeString();
            return (
              <div
                key={`${ev.ts}-${i}`}
                className="border-b border-dotted border-stroke py-0.5"
              >
                <span className="text-text-muted">{time}</span>{' '}
                <span className={color}>{ev.name}</span>{' '}
                <span className="text-text-secondary">
                  {Object.keys(ev.payload).length === 0
                    ? ''
                    : JSON.stringify(ev.payload)}
                </span>
              </div>
            );
          })}
      </div>

      <div className="text-3xs text-text-muted">Cmd/Ctrl + Shift + T to toggle.</div>
    </div>
  );
});
