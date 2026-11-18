// task-129: stream-preview events must carry the breakpoint at EMIT time,
// not the run-start capture — a mid-run switch retargets the preview.
import { describe, it, expect } from 'vitest';
import { createPreviewDispatchers } from '../useAIAgent';

function capture(fn: () => void): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  const listener = (e: Event) => events.push((e as CustomEvent).detail);
  window.addEventListener('sq:ai-stream-preview', listener);
  window.addEventListener('sq:ai-stream-preview-end', listener);
  try {
    fn();
  } finally {
    window.removeEventListener('sq:ai-stream-preview', listener);
    window.removeEventListener('sq:ai-stream-preview-end', listener);
  }
  return events;
}

describe('createPreviewDispatchers', () => {
  it('stamps events with the breakpoint at emit time, not creation time', () => {
    const bpRef = { current: 'lg' as string | null };
    const { emit, endEmit } = createPreviewDispatchers(bpRef);
    const events = capture(() => {
      emit({ mode: 'section', partial: '<p>a</p>' });
      bpRef.current = 'xs'; // mid-run switch
      emit({ mode: 'section', partial: '<p>ab</p>' });
      endEmit();
    });
    expect(events.map(e => e.breakpoint)).toEqual(['lg', 'xs', 'xs']);
  });

  it('endEmit stamps the cancelled flag (task-128 restore path)', () => {
    const { endEmit } = createPreviewDispatchers({ current: 'lg' });
    const events = capture(() => {
      endEmit();
      endEmit(true);
    });
    expect(events.map(e => !!e.cancelled)).toEqual([false, true]);
  });

  it('falls back to base when the ref is null', () => {
    const { emit } = createPreviewDispatchers({ current: null });
    const events = capture(() => {
      emit({ mode: 'section', partial: '<p>a</p>' });
    });
    expect(events[0].breakpoint).toBe('base');
  });
});
