/**
 * The V2 writer probe (desktop/probe/v2probe.mjs, docs/plans/2026-11-17-instant-edit-gates/V2-writer-probe.md) names who writes
 * `sourceClasses[key].classes` on the live doc and which value the observer then posts to the canvas. It reads five marks of the editor:
 *   cls:set      the class a setClasses call asked for, with the operation tail the durable-edit transaction origin ends with
 *   v2:write     every class write the observer sees on the live doc: transaction origin, old and new value
 *   v2:csv + v2:sync   the value SYNC_CLASSES_TO_IFRAME carries, the branch of currentSourceClassValue that produced it, scan and owner versions
 *   v2:reg       registerElement's own writes (a new entry, an external overwrite)
 *   cls:accepted the class the live doc holds when the acceptance resolves
 * Marks are no-ops without the recorder hook; with it the app posts exactly what it posts without it.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import React from 'react';
import { useYjsValue } from '@/store/hooks';
import { selectProjectId } from '@/store/selectors';

vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: { isAvailable: () => false, writeClassUpdate: vi.fn(() => Promise.resolve(true)), setIframeRef: vi.fn() },
}));

import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { UndoProvider } from '../UndoContext';
import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

const KEY = 'src/pages/index.astro:20:5';
const LOC = { file: 'src/pages/index.astro', line: 20, column: 5 };
const PAGE = [...Array.from({ length: 19 }, (_, i) => (i === 0 ? '<section>' : `  <!-- ${i} -->`)), '    <img class="w-full rounded" alt="x" />', '</section>', ''].join('\n');

type Hook = (what: string, data?: Record<string, unknown>) => void;
const g = globalThis as unknown as { __sqProbeMark?: Hook };
type Mark = [string, Record<string, unknown> | undefined];
let marks: Mark[];
let posted: Array<{ type: string; payload: Record<string, unknown> }>;
let docRef: Y.Doc;
let storeApi: ReturnType<typeof useClassStore>;
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;

function ProjectSeed({ children }: { children: React.ReactNode }) {
  const doc = useEditorDoc();
  React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', projectId); }, [doc]);
  return <>{children}</>;
}
function Harness() {
  docRef = useEditorDoc();
  storeApi = useClassStore();
  return useYjsValue(selectProjectId) === projectId ? <span data-testid="ready" /> : null;
}
async function mount() {
  await db.delete(); await db.open();
  resetClassWriteBaselines(); _resetLocalPageSyncForTests();
  projectId = `browser_probe_marks_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { [LOC.file]: PAGE });
  setActiveSaveProjectId(projectId);
  posted = [];
  render(<EditorProvider><ProjectSeed><UndoProvider><ClassStoreProvider><Harness /></ClassStoreProvider></UndoProvider></ProjectSeed></EditorProvider>);
  await screen.findByTestId('ready');
}
const setClasses = async (classes: string) => { let ok = false; await act(async () => { ok = await storeApi.setClasses(KEY, classes); }); expect(ok).toBe(true); };
const of = (name: string) => marks.filter(([k]) => k === name).map(([, d]) => d as Record<string, unknown>);
// Only what pushes the canvas: the call-time draft is the paint; the observer's `painted` message is bookkeeping.
const syncs = () => posted.filter(m => m.type === 'SYNC_CLASSES_TO_IFRAME' && !m.payload.painted).map(m => m.payload);

beforeEach(() => {
  marks = [];
  vi.spyOn(window, 'postMessage').mockImplementation((msg: unknown) => {
    const m = msg as { type?: string; payload: Record<string, unknown> };
    if (m && typeof m.type === 'string') posted.push(m as { type: string; payload: Record<string, unknown> });
  });
});
afterEach(() => { delete g.__sqProbeMark; vi.restoreAllMocks(); runtime?.close(); runtime = undefined; setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); });

describe('ClassStore probe marks (V2 writer probe)', () => {
  it('marks each class edit end to end: asked class and op, live-doc writes with their origin, the SYNC value with its branch, the accepted doc value', async () => {
    await mount();
    g.__sqProbeMark = (what, data) => { marks.push([what, data]); };
    act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
    await setClasses('w-[3px] rounded');
    await setClasses('w-[30px] rounded');

    expect(of('v2:reg')).toEqual([{ b: 'new', key: KEY.slice(-14), now: 'w-full rounded' }]);
    const sets = of('cls:set');
    expect(sets.map(d => d.cls)).toEqual(['w-[3px] rounded', 'w-[30px] rounded']);
    expect(sets[0].op).toMatch(/^[0-9a-f]{6}$/);

    const writes = of('v2:write').flatMap(d => (d.w as Array<Record<string, unknown>>).map(w => ({ origin: d.origin as string, ...w })));
    expect(writes).toContainEqual(expect.objectContaining({ origin: 'sync', key: KEY, act: 'entry-add', now: 'w-full rounded' }));
    const durable = writes.filter(w => w.origin.startsWith('durable-edit:') && w.act === 'update');
    expect(durable.map(w => [w.old, w.now])).toEqual([['w-full rounded', 'w-[3px] rounded'], ['w-[3px] rounded', 'w-[30px] rounded']]);
    expect(durable.map(w => w.origin)).toEqual(sets.map(d => `durable-edit:class-edit:…${d.op}`));

    const out = of('v2:sync');
    expect(out.map(d => d.v)).toEqual(['w-[3px] rounded', 'w-[30px] rounded']);
    expect(out[0]).toMatchObject({ key: KEY.slice(-14), e: 'w-[3px] rounded', op: sets[0].op });
    expect(out.map(d => d.op)).toEqual(sets.map(d => d.op));
    // the branch mark comes right before the SYNC mark it explains; no scan exists here, so the entry itself is the value
    marks.forEach(([k], i) => { if (k === 'v2:sync') expect(marks[i - 1]).toEqual(['v2:csv', { b: 'entry' }]); });
    expect(of('cls:accepted')).toEqual([{ key: KEY.slice(-14), typed: 'w-[3px] rounded', doc: 'w-[3px] rounded' }, { key: KEY.slice(-14), typed: 'w-[30px] rounded', doc: 'w-[30px] rounded' }]);
  });

  it('marks registerElement overwriting an existing entry with an external value (the sync-origin write a scan can cause)', async () => {
    await mount();
    act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
    g.__sqProbeMark = (what, data) => { marks.push([what, data]); };
    act(() => { storeApi.registerElement(KEY, 'w-1/2 rounded', LOC); });
    expect(of('v2:reg')).toEqual([{ b: 'external', key: KEY.slice(-14), old: 'w-full rounded', now: 'w-1/2 rounded' }]);
    const writes = of('v2:write').flatMap(d => (d.w as Array<Record<string, unknown>>).map(w => ({ origin: d.origin, ...w })));
    expect(writes).toEqual([{ origin: 'sync', key: KEY, act: 'update', old: 'w-full rounded', now: 'w-1/2 rounded' }]);
  });

  it('posts exactly the same canvas messages and ends in the same doc state with the hook as without it', async () => {
    const run = async () => {
      await mount();
      act(() => { storeApi.registerElement(KEY, 'w-full rounded', LOC); });
      await setClasses('w-[3px] rounded'); await setClasses('w-[30px] rounded');
      // The call-order seq keeps counting across the two runs; everything else must be identical.
      return { sync: syncs().map(p => ({ ...p, intent: p.intent && { hold: (p.intent as { hold?: boolean }).hold } })), doc: docRef.getMap<Y.Map<unknown>>('sourceClasses').get(KEY)?.get('classes') };
    };
    const without = await run();
    cleanup();
    g.__sqProbeMark = (what, data) => { marks.push([what, data]); };
    const withHook = await run();
    expect(marks.length).toBeGreaterThan(0);
    expect(withHook).toEqual(without);
    expect(without.sync.map(p => p.classes)).toEqual(['w-[3px] rounded', 'w-[30px] rounded']);
  });

  it('a throwing recorder hook never fails an edit', async () => {
    await mount();
    g.__sqProbeMark = () => { throw new Error('recorder broke'); };
    await setClasses('w-[3px] rounded');
    expect(docRef.getMap<Y.Map<unknown>>('sourceClasses').get(KEY)?.get('classes')).toBe('w-[3px] rounded');
  });
});
