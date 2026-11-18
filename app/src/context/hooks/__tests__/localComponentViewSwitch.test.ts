/**
 * The local surface-switch blink (owner report 2026-08-06).
 *
 * Switching between the master/component view and a page showed three paints
 * instead of one. Paint 1 was the page frame loading PRE-WRITE bytes: leaving
 * the master view flushes the class queue (subscribeLocalComponentView) and the
 * iframe navigates in the same React commit, so the request goes out ~25 ms
 * BEFORE the write reaches disk (measured: dispatch → disk 17 ms with the frame
 * alive; disk landed 42-55 ms AFTER the navigation had started). The frame does
 * not self-heal either — the HMR invalidation is delivered to the frame being
 * destroyed, so the stale paint IS the settled canvas.
 *
 * The law this pins: **the frame must not navigate while the write that the
 * switch itself flushed is still in flight.**
 *
 * Contract migration (7932857b): the queue no longer has markDirty — a class
 * edit is an accepted durable `class-write` command, and leaving the master
 * view flushes it through the materializer (flushDurableSourceWrites). The
 * in-flight write is therefore a real source command held on a project-fs
 * runtime, not a writer mock.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import { classCommands } from '@/services/durableEdits/classCommands';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { useClassPersistenceQueue, switchLocalComponentView } from '../useClassPersistenceQueue';
import { viteClassWriter } from '@/services/ViteClassWriter';
import {
  setLocalComponentViewFile,
  getLocalComponentViewFile,
  LOCAL_COMPONENT_VIEW_FAILED,
} from '@/services/localComponentView';
import { setSaveConflictToastUp } from '@/utils/sourceActionFeedback';
import toast from 'react-hot-toast';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';

vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn() }) }));

// The disk probe the switch asks (`/__sq/local/file?…&probe=1`): `{ ok }` = on disk or not.
const desktop = vi.hoisted(() => ({
  on: false,
  probe: vi.fn<(route: string) => Promise<{ ok: boolean }>>(async () => { throw new Error('no desktop owner'); }),
}));
vi.mock('@/services/desktopDriver', async importOriginal => ({ ...(await importOriginal<object>()), isDesktop: () => desktop.on }));
vi.mock('@/utils/sqLocalBase', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/sqLocalBase')>();
  return { ...actual, localFetch: async (url: string, init?: RequestInit) => {
    if (!desktop.on || !url.includes('&probe=1')) return actual.localFetch(url, init); // durable writes probe too
    const { ok } = await desktop.probe(url);
    return new Response(null, { status: 200, headers: ok ? {} : { 'X-Sq-Missing': '1' } });
  } };
});

vi.mock('@/components/Canvas/reloadPreview', () => ({
  capturePreviewBaseline: vi.fn(async () => null),
}));

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: {
    isAvailable: vi.fn(() => true),
    writeClassUpdate: vi.fn(() => Promise.resolve(true)),
  },
}));

const COMPONENT = 'src/components/Card.astro';
const loc = { file: COMPONENT, line: 5, column: 3 };

/** Drain the microtask queue a few times without resolving any real timer. */
const flushMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  vi.mocked(viteClassWriter.writeClassUpdate).mockReset();
  vi.mocked(viteClassWriter.writeClassUpdate).mockResolvedValue(true);
  vi.mocked(viteClassWriter.isAvailable).mockReturnValue(true);
  resetClassWriteBaselines();
  setLocalComponentViewFile(null);
  desktop.on = false;
  desktop.probe.mockReset();
  desktop.probe.mockRejectedValue(new Error('no desktop owner'));
});

describe('switchLocalComponentView — the frame waits for the flushed write', () => {
  it('does NOT navigate while the master write it flushed is still in flight', async () => {
    await db.delete(); await db.open();
    const projectId = `browser_view_switch_${crypto.randomUUID()}`;
    setActiveSaveProjectId(projectId);
    let land!: () => void;
    const gate = new Promise<void>(resolve => { land = resolve; });
    let commandsSeen = 0;
    const card = ['<article>', '  <!-- 2 -->', '  <!-- 3 -->', '  <!-- 4 -->', '  <h3 class="card-title">T</h3>', '</article>', ''].join('\n');
    const runtime = projectFsRuntime(projectId, { [COMPONENT]: card }, { beforeCommand: () => { commandsSeen++; return gate; } });
    const doc = new Y.Doc();
    doc.getMap('meta').set('projectId', projectId);
    try {
      const { result, unmount } = renderHook(() => useClassPersistenceQueue(projectId));
      // User is in the master view and edits a class there (accepted, deferred).
      act(() => { setLocalComponentViewFile(COMPONENT); });
      await act(async () => {
        await acceptProjectEdit(doc, { projectId, operationId: `class-edit:${crypto.randomUUID()}`, mutate: () => {},
          commands: classCommands(loc, 'card-title ttlRACE', 'card-title', undefined) });
      });
      await vi.waitFor(() => expect(result.current.dirtyKeys.size).toBe(1));

      const navigated: (string | null)[] = [];
      let settled!: Promise<void>;
      act(() => { settled = switchLocalComponentView(null, f => navigated.push(f)); });

      // The switch flushed the queue: the source command reached the runtime…
      await vi.waitFor(() => expect(commandsSeen).toBeGreaterThan(0));
      // …and the panels already know which surface we are on…
      expect(getLocalComponentViewFile()).toBeNull();
      // …but the frame has NOT been pointed at the page yet: it would fetch
      // pre-write bytes and paint the old master.
      await flushMicrotasks();
      expect(navigated).toEqual([]);

      land();
      await settled;
      expect(navigated).toEqual([null]);
      expect(runtime.read(COMPONENT)).toContain('class="card-title ttlRACE"');
      unmount();
    } finally {
      land(); await flushDurableSourceWrites(projectId).catch(() => {});
      runtime.close(); doc.destroy(); setActiveSaveProjectId(null);
    }
  });

  it('navigates without waiting when nothing is pending', async () => {
    renderHook(() => useClassPersistenceQueue(null));
    const navigated: (string | null)[] = [];

    await switchLocalComponentView(COMPONENT, f => navigated.push(f));

    expect(navigated).toEqual([COMPONENT]);
    expect(viteClassWriter.writeClassUpdate).not.toHaveBeenCalled();
  });
});

describe('switchLocalComponentView — the frame waits for the component view route (bug: Astro 404 on a just-materialized file)', () => {
  it('navigates only once the instance answers the route', async () => {
    desktop.on = true;
    desktop.probe.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    const navigated: (string | null)[] = [];
    await switchLocalComponentView(COMPONENT, f => navigated.push(f));
    expect(desktop.probe).toHaveBeenCalledTimes(3);
    expect(desktop.probe).toHaveBeenLastCalledWith(`/__sq/local/file?file=${encodeURIComponent(COMPONENT)}&probe=1`);
    expect(navigated).toEqual([COMPONENT]);
  });
  it('keeps asking while no instance is attached (boot, restart), then navigates', async () => {
    desktop.on = true;
    desktop.probe.mockRejectedValueOnce(new Error('no desktop owner')).mockRejectedValueOnce(new Error('no desktop owner')).mockResolvedValueOnce({ ok: true });
    const navigated: (string | null)[] = [];
    await expect(switchLocalComponentView(COMPONENT, f => navigated.push(f))).resolves.toBe(true);
    expect(desktop.probe).toHaveBeenCalledTimes(3);
    expect(navigated).toEqual([COMPONENT]);
  });
  it('navigates immediately without asking anything outside the desktop app', async () => {
    const navigated: (string | null)[] = [];
    await switchLocalComponentView(COMPONENT, f => navigated.push(f));
    expect(desktop.probe).not.toHaveBeenCalled();
    expect(navigated).toEqual([COMPONENT]);
  });
});

// HN report 2026-11-09: after the cap the switch navigated anyway — into Astro's
// 404, which loads no bridge and never heals. Navigate only to an answer.
describe('switchLocalComponentView — never navigates into a route that did not answer', () => {
  const OPEN = 'src/components/Open.astro';
  const failedEvents: unknown[] = [];
  const onFailed = (e: Event) => { failedEvents.push((e as CustomEvent).detail); };
  beforeEach(async () => {
    await import('@/services/desktopDriver'); // resolve the lazy import before fake timers
    failedEvents.length = 0;
    window.addEventListener(LOCAL_COMPONENT_VIEW_FAILED, onFailed);
    vi.mocked(toast.error).mockClear();
    desktop.on = true;
  });
  afterEach(() => { window.removeEventListener(LOCAL_COMPONENT_VIEW_FAILED, onFailed); vi.useRealTimers(); setSaveConflictToastUp(false); });

  it('route always 404: no navigation, the panels go back to what the canvas shows, one generic toast', async () => {
    vi.useFakeTimers();
    desktop.probe.mockResolvedValue({ ok: false });
    setLocalComponentViewFile(OPEN);
    const navigated: (string | null)[] = [];
    const done = switchLocalComponentView(COMPONENT, f => navigated.push(f));
    await vi.advanceTimersByTimeAsync(6000);
    await expect(done).resolves.toBe(false);
    expect(navigated).toEqual([]);
    expect(getLocalComponentViewFile()).toBe(OPEN);
    expect(failedEvents).toEqual([{ file: COMPONENT, previous: OPEN }]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith("Couldn't open Card. Try again.");
  });

  it('a lost instance that never comes back is a failure too, not a navigation', async () => {
    vi.useFakeTimers();
    const navigated: (string | null)[] = []; // beforeEach default: every ask rejects
    const done = switchLocalComponentView(COMPONENT, f => navigated.push(f));
    await vi.advanceTimersByTimeAsync(6000);
    await expect(done).resolves.toBe(false);
    expect(navigated).toEqual([]);
    expect(desktop.probe.mock.calls.length).toBeGreaterThan(1);
  });

  it('says nothing while the save-conflict toast already explains it', async () => {
    vi.useFakeTimers();
    setSaveConflictToastUp(true);
    desktop.probe.mockResolvedValue({ ok: false });
    const done = switchLocalComponentView(COMPONENT, () => {});
    await vi.advanceTimersByTimeAsync(6000);
    await expect(done).resolves.toBe(false);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('last click wins: a slow open A never navigates after a newer open B', async () => {
    const A = 'src/components/A.astro'; const B = 'src/components/B.astro';
    let answerA: ((r: { ok: boolean }) => void) | undefined;
    desktop.probe.mockImplementation(route => route.includes(encodeURIComponent(A))
      ? new Promise(resolve => { answerA = resolve; }) : Promise.resolve({ ok: true }));
    const navigated: (string | null)[] = [];
    const a = switchLocalComponentView(A, f => navigated.push(f));
    await vi.waitFor(() => expect(answerA).toBeDefined()); // A is waiting on a slow answer…
    const b = switchLocalComponentView(B, f => navigated.push(f)); // …when B is clicked
    await expect(b).resolves.toBe(true);
    answerA!({ ok: true });
    await expect(a).resolves.toBe(false);
    expect(navigated).toEqual([B]);
    expect(getLocalComponentViewFile()).toBe(B);
    expect(failedEvents).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });
});
