// A refused write is never a silent wall (audit 2026-10-18): the blocked edit
// gets ONE message whose action discards it, so every later edit can save.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import toast, { Toaster } from 'react-hot-toast';
import type { MaterializationStatus } from '@/services/durableEdits/materializer';

const h = vi.hoisted(() => ({
  status: null as unknown as MaterializationStatus,
  listeners: new Set<() => void>(),
  discard: vi.fn(async () => {}),
}));
vi.mock('@/services/durableEdits/materializer', async (original) => ({
  ...await original<typeof import('@/services/durableEdits/materializer')>(),
  getMaterializationStatus: () => h.status,
  subscribeMaterializationStatus: (listener: () => void) => { h.listeners.add(listener); return () => h.listeners.delete(listener); },
  discardBlockedEdit: h.discard,
}));
import { MaterializationFailure } from '@/services/durableEdits/materializer';
import { useSaveConflictToast } from '../useSaveConflictToast';

function Host() { useSaveConflictToast('p'); return <Toaster />; }
const publish = (next: Partial<MaterializationStatus>) => act(() => {
  h.status = { ...h.status, ...next };
  for (const listener of h.listeners) listener();
});

beforeEach(() => {
  h.status = { projectId: 'p', acceptedRevision: 2, materializedRevision: 0, issue: null };
  h.listeners.clear(); h.discard.mockClear();
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, onchange: null, addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
  }
});

describe('useSaveConflictToast', () => {
  it('names the file a blocked edit no longer fits and discards that edit on request', async () => {
    render(<Host />);
    publish({ issue: { operationId: 'op-1', revision: 1, kind: 'deterministic',
      error: new MaterializationFailure('deterministic', 'File changed outside Starquix', 'src/components/Header.astro') } });
    expect(await screen.findByText(/Header\.astro changed outside Starquix/)).toBeTruthy();
    const reloads = vi.fn(); window.addEventListener('sq:reload-preview', reloads);
    fireEvent.click(screen.getByText('Discard change'));
    expect(h.discard).toHaveBeenCalledWith('p');
    await vi.waitFor(() => expect(reloads).toHaveBeenCalledTimes(1)); // the canvas drops the discarded edit
    window.removeEventListener('sq:reload-preview', reloads);
  });

  it('stays up while a retry is pending and leaves once the blocked edit lands', async () => {
    render(<Host />);
    const issue = { operationId: 'op-1', revision: 1, kind: 'deterministic' as const, error: new Error('refused') };
    publish({ issue });
    expect(await screen.findByText(/Couldn't save a change/)).toBeTruthy();
    publish({ issue: null }); // a flush clears the issue while it retries
    expect(screen.queryByText(/Couldn't save a change/)).toBeTruthy();
    publish({ materializedRevision: 1 });
    // react-hot-toast removes a dismissed toast after its 1 s exit.
    await vi.waitFor(() => expect(screen.queryByText(/Couldn't save a change/)).toBeNull(), { timeout: 3000 });
  });

  it('while it is up, a failed component open adds no second message (one cause, one message)', async () => {
    const { toastComponentOpenFailure } = await import('@/utils/sourceActionFeedback');
    render(<Host />);
    publish({ issue: { operationId: 'op-1', revision: 1, kind: 'deterministic', error: new Error('refused') } });
    expect(await screen.findByText(/Couldn't save a change/)).toBeTruthy();
    act(() => { toastComponentOpenFailure('Hero3'); });
    expect(screen.queryByText("Couldn't open Hero3. Try again.")).toBeNull();
    publish({ issue: null, materializedRevision: 1 }); // the blocked edit landed: the conflict toast leaves
    act(() => { toastComponentOpenFailure('Hero3'); });
    expect(await screen.findByText("Couldn't open Hero3. Try again.")).toBeTruthy();
    act(() => { toast.remove(); }); // toasts are global: none may animate into the next test
  });

  it('says nothing while a write only waits on the transport', async () => {
    render(<Host />);
    publish({ issue: { operationId: 'op-1', revision: 1, kind: 'unknown', error: new Error('instance restarting') } });
    expect(screen.queryByText(/Couldn't save a change/)).toBeNull();
  });
});
