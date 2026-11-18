/**
 * Group style edits (design ledger E1–E6, docs/plans/2026-11-16-multi-select-edit-design.md):
 * setClassesMany = ONE durable acceptance, ONE undo snapshot, N class-write
 * commands; all-or-nothing on a refusal; setClasses is a batch of one.
 * Harness copied from ClassStoreContext.firstEditWrite.test.tsx (real durable
 * acceptance + a project-fs runtime, so the bytes are real).
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { db } from '@/db';
import { listUnmaterialized } from '@/services/durableEdits/store';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { resetClassWriteBaselines } from '@/services/classWriteBaseline';
import { sourceVersion } from '@/services/durableEdits/sourceIdentity';

const F = 'src/pages/index.astro';
// Line 7 holds TWO spans: growing the first span's class moves the second span's column (ledger E6/E7).
const PAGE_SOURCE = ['---', '---', '<html>', '<body>', '<main>', '<section>',
  '  <p><span class="text-sm">A</span><span class="text-lg">B</span></p>',
  '  <h1 class="text-sm">Hi</h1>',
  '</section>', '</main>', '</body>', '</html>', ''].join('\n');
const A = `${F}:7:6`, B = `${F}:7:36`, H1 = `${F}:8:3`;
// A canvas click in the desktop app carries the scan's ownership (bridge utils.ts: sourceVersion in local
// mode), which is what lets acceptance re-project a later same-line write through the earlier one's
// identity map (services/durableEdits/prepareClassIdentity.ts). Without it the compat path defers
// preparation to materialization, per command, against the already-rewritten file.
const LOC = (key: string) => { const [, line, column] = key.split(':');
  return { file: F, line: +line, column: +column, sourceVersion: sourceVersion(PAGE_SOURCE), sourceRevision: 0 }; };

const h = vi.hoisted(() => ({ doc: null as unknown as import('yjs').Doc }));
const t = vi.hoisted(() => ({ refuseLine: 0 }));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => () => false,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
}));
const hoistedUndo = vi.hoisted(() => ({
  ctx: { takeSnapshot: vi.fn(), isUndoingRef: { current: false } },
}));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => hoistedUndo.ctx }));
vi.mock('@/services/ViteClassWriter', () => ({
  viteClassWriter: { isAvailable: () => true, writeClassUpdate: vi.fn(() => Promise.resolve(true)) },
}));
vi.mock('@/services/ViteImageWriter', () => ({
  viteImageWriter: { isAvailable: () => true, writeImageUpdate: vi.fn(() => Promise.resolve(true)) },
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/services/durableEdits/classCommands', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/durableEdits/classCommands')>();
  return { ...actual, classCommands: vi.fn((...args: Parameters<typeof actual.classCommands>) => {
    if (args[0]?.line === t.refuseLine) throw new Error('refused for test');
    return actual.classCommands(...args);
  }) };
});

import { ClassStoreProvider, useClassStore } from '../ClassStoreContext';

let api: ReturnType<typeof useClassStore>;
function Probe() { api = useClassStore(); return null; }

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;
let postMessageSpy: ReturnType<typeof vi.spyOn> | undefined;

async function mount() {
  await db.delete(); await db.open();
  resetClassWriteBaselines();
  projectId = `browser_set_many_${crypto.randomUUID()}`;
  runtime?.close();
  runtime = projectFsRuntime(projectId, { [F]: PAGE_SOURCE });
  setActiveSaveProjectId(projectId);
  h.doc = new Y.Doc();
  h.doc.getMap('meta').set('projectId', projectId);
  postMessageSpy?.mockRestore();
  postMessageSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  render(<ClassStoreProvider><Probe /></ClassStoreProvider>);
  act(() => { for (const [k, c] of [[A, 'text-sm'], [B, 'text-lg'], [H1, 'text-sm']] as const) api.registerElement(k, c, LOC(k)); });
}

beforeEach(() => {
  localStorage.clear();
  t.refuseLine = 0;
  vi.mocked(toast.error).mockClear();
  hoistedUndo.ctx.takeSnapshot.mockClear();
  // Only the timer functions: IndexedDB (fake-indexeddb) runs on setImmediate.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  cleanup();
  postMessageSpy?.mockRestore();
  vi.useRealTimers();
  runtime?.close(); runtime = undefined;
  setActiveSaveProjectId(null);
});

describe('setClassesMany (ledger E1–E6)', () => {
  it('two members on ONE line: one acceptance, two class writes, both land in the file (E1, E6)', async () => {
    await mount();
    hoistedUndo.ctx.takeSnapshot.mockClear();
    let ok = false;
    await act(async () => { ok = await api.setClassesMany([{ key: A, classes: 'text-sm text-red-500' }, { key: B, classes: 'text-lg text-red-500' }]); });
    expect(ok).toBe(true);
    const rows = await listUnmaterialized(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].commands.filter(c => c.kind === 'class-write')).toHaveLength(2);
    expect(hoistedUndo.ctx.takeSnapshot).toHaveBeenCalledTimes(1); // one ⌘Z for the group (E5)
    await flushDurableSourceWrites(projectId);
    expect(runtime!.read(F)).toContain('<p><span class="text-sm text-red-500">A</span><span class="text-lg text-red-500">B</span></p>');
  });

  it('all-or-nothing: one refused member stops the group, drafts revert, one toast naming it (E2, E3)', async () => {
    await mount();
    t.refuseLine = 8;
    let ok = true;
    await act(async () => { ok = await api.setClassesMany([{ key: A, classes: 'text-sm text-red-500' }, { key: H1, classes: 'text-sm text-red-500' }]); });
    t.refuseLine = 0;
    expect(ok).toBe(false);
    expect(await listUnmaterialized(projectId)).toHaveLength(0);
    expect(api.getClassesFromYjs(A)).toBe('text-sm');
    expect(api.getClassesFromYjs(H1)).toBe('text-sm');
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toMatch(/^Style not saved: refused for test — src\/pages\/index\.astro:8/);
  });

  it('undo gets ONE inverse per file when several members share it (E5 — live repro: "Undo source baseline changed")', async () => {
    // Live 2026-11-17 (Electron, 3 headings in one page): the group attached one inverse PER COMMAND
    // (S1→S0, S2→S1, S3→S2); undo checks each inverse's baseline against the file (S3) and refused.
    const attached: Array<Array<{ file: string; beforeSource: string; afterSource: string }>> = [];
    const ctx = hoistedUndo.ctx as Record<string, unknown>;
    ctx.claimSnapshot = () => ({ stage() {}, commit() {}, attachSourceReceipts() {},
      attachFiles(files: Array<{ file: string; beforeSource: string; afterSource: string }>) { attached.push(files); } });
    try {
      await mount();
      await act(async () => { await api.setClassesMany([
        { key: A, classes: 'text-sm text-red-500' }, { key: B, classes: 'text-lg text-red-500' }, { key: H1, classes: 'text-sm text-red-500' },
      ]); });
      expect(attached).toHaveLength(1);
      expect(attached[0].map(f => f.file)).toEqual([F]);
      expect(attached[0][0].beforeSource).toBe(PAGE_SOURCE);
      expect(attached[0][0].afterSource).toContain('<p><span class="text-sm text-red-500">A</span><span class="text-lg text-red-500">B</span></p>');
      expect(attached[0][0].afterSource).toContain('<h1 class="text-sm text-red-500">Hi</h1>');
    } finally { delete ctx.claimSnapshot; }
  });

  it('setClasses is a batch of one (unchanged contract)', async () => {
    await mount();
    await act(async () => { await api.setClasses(A, 'text-sm text-red-500'); });
    const rows = await listUnmaterialized(projectId);
    expect(rows).toHaveLength(1);
    expect(rows[0].commands.filter(c => c.kind === 'class-write')).toHaveLength(1);
  });

  it('a single edit keeps today\'s toast text (no element suffix)', async () => {
    await mount();
    t.refuseLine = 8;
    await act(async () => { await api.setClasses(H1, 'text-sm text-red-500'); });
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe('Style not saved: refused for test');
  });

  it('getStoredClasses: null when unknown, the draft while pending, the entry after', async () => {
    await mount();
    expect(api.getStoredClasses(`${F}:99:1`)).toBeNull();
    let pending!: Promise<boolean>;
    act(() => { pending = api.setClassesMany([{ key: A, classes: 'text-sm text-red-500' }]); });
    expect(api.getStoredClasses(A)).toBe('text-sm text-red-500');
    await act(async () => { await pending; });
    expect(api.getStoredClasses(A)).toBe('text-sm text-red-500');
  });
});
