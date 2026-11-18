/**
 * task-148: page delete/restore as STRUCTURAL UNDO ops.
 *
 * A local page is a real file AND a doc row, so its undo op is the only one
 * that touches both: it drives the host /__sq/local/* endpoints (not
 * viteStructuralWriter) and mirrors the result into Yjs through the normal
 * commands, so ⌘Z brings the file back byte-identical AND the page row
 * returns with the id seeding would produce.
 */
//
// Migrated 2026-09-23: fdd2d12f made every page file op a durable file
// acceptance planned by `/__sq/local/page-plan` (the direct page-restore /
// page-delete / page-move POSTs are gone). The ops now run against the real
// route table + a temp disk (projectFsRuntime) + fake-indexeddb, so refusals
// are the planner's real refusals and the file effect is asserted on disk.
import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { flushDurableSourceWritesThrough } from '@/services/durableEdits/sourceMaterialization';
import * as storage from '@/services/durableEdits/store';
import { replayStructuralOps, mergeStructuralRecords, type StructuralOp, type StructuralReplayWriter } from '../structuralUndo';
import { applyCommand } from '../commands';
import { localPageId } from '@/utils/localMode';

// The page ops must never reach the file writer — they speak to the instance.
const writer = {} as StructuralReplayWriter;

const HOME = '---\n---\n<html><body><main>home</main></body></html>\n';
const CONTENT = '---\n---\n<html><body><main>hi</main></body></html>\n';
let projectId: string;
let FOLDER: string;
let runtime: ReturnType<typeof projectFsRuntime> | undefined;

const deleteOp = (): StructuralOp => ({
  kind: 'page-delete', folder: FOLDER, pageId: 'about', route: '/about', file: 'src/pages/about.astro',
});
const restoreOp = (): StructuralOp => ({
  kind: 'page-restore', folder: FOLDER, pageId: 'about', route: '/about', file: 'src/pages/about.astro', content: CONTENT,
});

const newDoc = (): Y.Doc => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  return doc;
};
const seed = (): Y.Doc => {
  const doc = newDoc();
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'about', name: '/about', rootElementIds: [], children: [] } });
  return doc;
};
const start = (files: Record<string, string>) => { runtime = projectFsRuntime(projectId, files); return runtime; };
const settle = async () => {
  const { acceptedRevision } = await storage.getDurableProjectState(projectId);
  if (acceptedRevision) await flushDurableSourceWritesThrough(projectId, acceptedRevision);
};

let events: Array<{ type: string; detail: unknown }>;
const record = (e: Event): void => { events.push({ type: e.type, detail: (e as CustomEvent).detail }); };

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_page_ops_${webcrypto.randomUUID()}`;
  FOLDER = `wc://${projectId}`;
  setActiveSaveProjectId(projectId);
  events = [];
  window.addEventListener('sq:local-page-created', record);
  window.addEventListener('sq:local-page-deleted', record);
});
afterEach(async () => {
  window.removeEventListener('sq:local-page-created', record);
  window.removeEventListener('sq:local-page-deleted', record);
  await settle();
  runtime?.close(); runtime = undefined;
  setActiveSaveProjectId(null);
  vi.unstubAllGlobals();
});

describe('page-restore op (⌘Z of a page delete)', () => {
  it('writes the bytes back, re-adds the doc page with the seeding id, announces it', async () => {
    const rt = start({ 'src/pages/index.astro': HOME });
    const doc = newDoc();
    applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', rootElementIds: [], children: [] } });

    expect(await replayStructuralOps([restoreOp()], writer, { doc })).toBe('ok');

    // id + name must match what /__sq/local/pages seeding would produce
    const id = localPageId('/about');
    const page = doc.getMap('pages').get(id) as Y.Map<unknown>;
    expect(page).toBeDefined();
    expect(page.get('name')).toBe('/about');
    expect(doc.getArray<string>('rootPages').toArray()).toContain(id);
    expect(events).toEqual([
      { type: 'sq:local-page-created', detail: { route: '/about', file: 'src/pages/about.astro', editable: true } },
    ]);
    // Byte-identical file back on disk.
    await settle();
    expect(rt.read('src/pages/about.astro')).toBe(CONTENT);
  });

  it('endpoint refusal (file reappeared) → failed, doc untouched, nothing announced', async () => {
    const rt = start({ 'src/pages/index.astro': HOME, 'src/pages/about.astro': 'REAPPEARED' });
    const doc = newDoc();
    expect(await replayStructuralOps([restoreOp()], writer, { doc })).toBe('failed');
    expect(doc.getMap('pages').size).toBe(0);
    expect(events).toEqual([]);
    expect(await db.durableEdits.count()).toBe(0);
    expect(rt.read('src/pages/about.astro')).toBe('REAPPEARED');
  });

  it('no doc in the replay deps → failed BEFORE any write', async () => {
    const rt = start({ 'src/pages/index.astro': HOME });
    expect(await replayStructuralOps([restoreOp()], writer)).toBe('failed');
    expect(await db.durableEdits.count()).toBe(0);
    expect(existsSync(join(rt.root, 'src/pages/about.astro'))).toBe(false);
  });
});

describe('page-delete op (⇧⌘Z of a restored page)', () => {
  it('deletes the file again, drops the doc page, announces it', async () => {
    const rt = start({ 'src/pages/index.astro': HOME, 'src/pages/about.astro': CONTENT });
    const doc = seed();

    expect(await replayStructuralOps([deleteOp()], writer, { doc })).toBe('ok');

    expect(doc.getMap('pages').has('about')).toBe(false);
    expect(doc.getMap('pages').has('index')).toBe(true);
    expect(events).toEqual([
      { type: 'sq:local-page-deleted', detail: { route: '/about', file: 'src/pages/about.astro' } },
    ]);
    await settle();
    expect(existsSync(join(rt.root, 'src/pages/about.astro'))).toBe(false);
  });

  it('endpoint refusal → failed, page row survives', async () => {
    // Nothing on disk to delete: the planner refuses.
    start({ 'src/pages/index.astro': HOME, 'src/pages/other.astro': HOME });
    const doc = seed();
    expect(await replayStructuralOps([deleteOp()], writer, { doc })).toBe('failed');
    expect(doc.getMap('pages').has('about')).toBe(true);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('transport throw → failed (never a half-applied doc)', async () => {
    start({ 'src/pages/index.astro': HOME, 'src/pages/about.astro': CONTENT });
    // The instance is unreachable: every /__sq/local/* call rejects.
    setLocalTransport({ projectPath: FOLDER, fetch: () => Promise.reject(new Error('offline')) });
    const doc = seed();
    expect(await replayStructuralOps([deleteOp()], writer, { doc })).toBe('failed');
    expect(doc.getMap('pages').has('about')).toBe(true);
  });
});

// task-240 Phase 3: the numbered-pagination route move is an undo op of its
// own — a whole-file rename inside src/pages, no doc row involved (the route
// is unchanged, only its file moves), announced so the session pages list
// re-maps the route to the new file.
describe('page-move op (pagination route move)', () => {
  it('moves the file and re-announces the route with its new file; no doc needed', async () => {
    const rt = start({ 'src/pages/index.astro': HOME, 'src/pages/blog.astro': CONTENT });
    const op: StructuralOp = { kind: 'page-move', folder: FOLDER, from: 'src/pages/blog.astro', to: 'src/pages/blog/[...page].astro' };
    expect(await replayStructuralOps([op], writer)).toBe('ok');
    expect(events.map((e) => e.type)).toEqual(['sq:local-page-deleted', 'sq:local-page-created']);
    expect(events[1].detail).toEqual({ route: '/blog', file: 'src/pages/blog/[...page].astro', editable: true });
    await settle();
    expect(existsSync(join(rt.root, 'src/pages/blog.astro'))).toBe(false);
    expect(rt.read('src/pages/blog/[...page].astro')).toBe(CONTENT);
  });

  it('a refused move fails the replay', async () => {
    start({ 'src/pages/index.astro': HOME, 'src/pages/a.astro': CONTENT, 'src/pages/b.astro': CONTENT });
    const op: StructuralOp = { kind: 'page-move', folder: FOLDER, from: 'src/pages/a.astro', to: 'src/pages/b.astro' };
    expect(await replayStructuralOps([op], writer)).toBe('failed');
    expect(await db.durableEdits.count()).toBe(0);
  });
});

describe('mergeStructuralRecords (task-240: insert + bind = one ⌘Z)', () => {
  it('concatenates forward ops in order and inverse ops in reverse order', () => {
    const a: StructuralOp = { kind: 'append-page', pageFile: 'src/pages/blog.astro', markup: '<BlogSlot />' };
    const aInv: StructuralOp = { kind: 'restore-region', loc: { file: 'src/pages/blog.astro', line: 7, column: 1 }, lineCount: 1, segment: '' };
    const b: StructuralOp = { kind: 'restore-region', loc: { file: 'src/pages/blog.astro', line: 1, column: 1 }, lineCount: 9, segment: 'after' };
    const bInv: StructuralOp = { kind: 'restore-region', loc: { file: 'src/pages/blog.astro', line: 1, column: 1 }, lineCount: 18, segment: 'before' };
    expect(mergeStructuralRecords([{ structuralOp: { forward: [a], inverse: [aInv] } }, { structuralOp: { forward: [b], inverse: [bInv] } }]))
      .toEqual({ structuralOp: { forward: [a, b], inverse: [bInv, aInv] } });
  });
});

