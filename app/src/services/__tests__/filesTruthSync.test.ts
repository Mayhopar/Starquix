import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/db';
import { putProjectFiles, readProjectFiles } from '@/db/projectFiles';
import { setLocalTransport, resetLocalTransportForTests } from '@/utils/sqLocalBase';
import { startFilesTruthSync, stopFilesTruthSync, syncChangedFiles, _filesTruthSyncState, getFilesTruthSyncStatus, subscribeFilesTruthSyncStatus } from '../filesTruthSync';

const enc = (s: string) => new TextEncoder().encode(s);

/** A fake instance: files map + journal, answering /changes and /file. */
function fakeInstance(files: Record<string, string>, journal: Array<{ seq: number; file: string; kind: 'change' | 'unlink' }>) {
  const calls: string[] = [];
  setLocalTransport({
    async fetch(p) {
      calls.push(p);
      if (p.startsWith('/__sq/local/changes?since=')) {
        const since = Number(p.split('=')[1]);
        return new Response(JSON.stringify({ seq: journal.length ? journal[journal.length - 1].seq : 0, entries: journal.filter((e) => e.seq > since) }));
      }
      if (p.startsWith('/__sq/local/file?file=')) {
        const f = new URLSearchParams(p.slice(p.indexOf('?') + 1)).get('file') ?? '';
        return f in files ? new Response(enc(files[f])) : new Response('nf', { status: 404 });
      }
      return new Response('?', { status: 500 });
    },
  });
  return calls;
}

beforeEach(async () => { await db.delete(); await db.open(); resetLocalTransportForTests(); });
afterEach(() => { vi.restoreAllMocks(); stopFilesTruthSync(); resetLocalTransportForTests(); });

describe('filesTruthSync (write-through, parent half)', () => {
  it('mirrors journal changes into Dexie: writes bytes, unlinks files and directory prefixes, advances seq', async () => {
    await putProjectFiles('p1', [
      { path: 'src/pages/old.astro', content: enc('old') },
      { path: 'src/content/posts/a.md', content: enc('a') },
      { path: 'src/content/posts/b.md', content: enc('b') },
      { path: 'src/pages/index.astro', content: enc('v1') },
    ]);
    fakeInstance(
      { 'src/pages/index.astro': 'v2', 'src/pages/new.astro': 'new' },
      [
        { seq: 1, file: 'src/pages/index.astro', kind: 'change' },
        { seq: 2, file: 'src/pages/new.astro', kind: 'change' },
        { seq: 3, file: 'src/pages/old.astro', kind: 'unlink' },
        { seq: 4, file: 'src/content/posts', kind: 'unlink' },
      ],
    );
    startFilesTruthSync('p1');
    await syncChangedFiles();
    expect(await readProjectFiles('p1')).toEqual({ 'src/pages/index.astro': 'v2', 'src/pages/new.astro': 'new' });
    expect(_filesTruthSyncState().lastSeq).toBe(4);
  });

  it('second pull only asks since the last seq; a 404 on read deletes the row', async () => {
    await putProjectFiles('p1', [{ path: 'gone.txt', content: enc('x') }]);
    const journal = [{ seq: 1, file: 'gone.txt', kind: 'change' as const }];
    const calls = fakeInstance({}, journal);
    startFilesTruthSync('p1');
    await syncChangedFiles();
    expect(await readProjectFiles('p1')).toEqual({});
    await syncChangedFiles();
    expect(calls.filter((c) => c.startsWith('/__sq/local/changes'))).toEqual(['/__sq/local/changes?since=0', '/__sq/local/changes?since=1']);
  });

  it('an SQ_FILE_CHANGED nudge from the preview iframe triggers a pull', async () => {
    const journal = [{ seq: 1, file: 'src/pages/index.astro', kind: 'change' as const }];
    fakeInstance({ 'src/pages/index.astro': 'nudged' }, journal);
    startFilesTruthSync('p1');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'SQ_FILE_CHANGED', payload: { file: 'src/pages/index.astro' } } }));
    await new Promise((r) => setTimeout(r, 30));
    await syncChangedFiles();
    expect(await readProjectFiles('p1')).toEqual({ 'src/pages/index.astro': 'nudged' });
  });

  it('no-op when no project is active', async () => {
    await syncChangedFiles();
    expect(_filesTruthSyncState()).toEqual({ projectId: null, lastSeq: 0 });
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('files-truth durability failures and sessions', () => {
  it('rejects a changed-file 500 and replays the uncommitted cursor into real Dexie', async () => {
    await putProjectFiles('p1', [{ path: 'index.astro', content: enc('old') }]);
    setLocalTransport({ fetch: async (p) => p.includes('/changes?')
      ? new Response(JSON.stringify({ seq: 1, entries: [{ seq: 1, file: 'index.astro', kind: 'change' }] }))
      : new Response('unavailable', { status: 500 }) });
    startFilesTruthSync('p1');
    await expect(syncChangedFiles()).rejects.toThrow('500');
    expect(_filesTruthSyncState().lastSeq).toBe(0);
    expect(await readProjectFiles('p1')).toEqual({ 'index.astro': 'old' });
    expect(getFilesTruthSyncStatus()).toMatchObject({ projectId: 'p1', status: 'error' });
    fakeInstance({ 'index.astro': 'new' }, [{ seq: 1, file: 'index.astro', kind: 'change' }]);
    await syncChangedFiles();
    expect(await readProjectFiles('p1')).toEqual({ 'index.astro': 'new' });
    expect(_filesTruthSyncState().lastSeq).toBe(1);
    expect(getFilesTruthSyncStatus()).toEqual({ projectId: 'p1', status: 'saved', error: null });
  });

  it('rejects journal HTTP failure and exposes stable subscribed snapshots through retry', async () => {
    startFilesTruthSync('p1');
    const statuses: string[] = [];
    const off = subscribeFilesTruthSyncStatus(() => statuses.push(getFilesTruthSyncStatus().status));
    const snapshot = getFilesTruthSyncStatus();
    expect(getFilesTruthSyncStatus()).toBe(snapshot);
    setLocalTransport({ fetch: async () => new Response('unavailable', { status: 503 }) });
    await expect(syncChangedFiles()).rejects.toThrow('503');
    expect(_filesTruthSyncState().lastSeq).toBe(0);
    fakeInstance({}, []);
    await syncChangedFiles();
    expect(statuses).toEqual(['saving', 'error', 'saving', 'saved']);
    off();
    stopFilesTruthSync();
    expect(getFilesTruthSyncStatus()).toEqual({ projectId: null, status: 'idle', error: null });
    expect(statuses).toHaveLength(4);
  });

  it('replays the entire batch after a Dexie write rejection', async () => {
    fakeInstance({ 'a.txt': 'a', 'b.txt': 'b' }, [
      { seq: 1, file: 'a.txt', kind: 'change' }, { seq: 2, file: 'b.txt', kind: 'change' },
    ]);
    startFilesTruthSync('p1');
    const bulkPut = db.projectFiles.bulkPut.bind(db.projectFiles);
    vi.spyOn(db.projectFiles, 'bulkPut')
      .mockImplementationOnce(bulkPut)
      .mockRejectedValueOnce(new Error('QuotaExceededError'));
    await expect(syncChangedFiles()).rejects.toThrow('QuotaExceededError');
    expect(_filesTruthSyncState().lastSeq).toBe(0);
    expect(await readProjectFiles('p1')).toEqual({ 'a.txt': 'a' });
    expect(getFilesTruthSyncStatus().status).toBe('error');
    await syncChangedFiles();
    expect(await readProjectFiles('p1')).toEqual({ 'a.txt': 'a', 'b.txt': 'b' });
    expect(_filesTruthSyncState().lastSeq).toBe(2);
  });

  it('overlapping callers wait for an ordered follow-up pull with the newest bytes', async () => {
    const firstRead = deferred<Response>();
    const reading = deferred<void>();
    let reads = 0;
    const cursors: string[] = [];
    setLocalTransport({ fetch: async (p) => {
      if (p.includes('/changes?')) {
        cursors.push(p);
        return new Response(JSON.stringify({ seq: cursors.length, entries: [{ seq: cursors.length, file: 'index.astro', kind: 'change' }] }));
      }
      reads++;
      if (reads === 1) { reading.resolve(); return firstRead.promise; }
      return new Response('new');
    } });
    startFilesTruthSync('p1');
    const first = syncChangedFiles();
    await reading.promise;
    const second = syncChangedFiles();
    firstRead.resolve(new Response('old'));
    await Promise.all([first, second]);
    expect(cursors).toEqual(['/__sq/local/changes?since=0', '/__sq/local/changes?since=1']);
    expect(await readProjectFiles('p1')).toEqual({ 'index.astro': 'new' });
    expect(getFilesTruthSyncStatus().status).toBe('saved');
  });

  it('a stopped suspended pull cannot use the next project transport or change its state', async () => {
    const oldJournal = deferred<Response>();
    const oldStarted = deferred<void>();
    setLocalTransport({ fetch: async () => { oldStarted.resolve(); return oldJournal.promise; } });
    startFilesTruthSync('old');
    const oldPull = syncChangedFiles().catch(() => undefined);
    await oldStarted.promise;
    stopFilesTruthSync();
    const newCalls = fakeInstance({ 'new.txt': 'new' }, [{ seq: 1, file: 'new.txt', kind: 'change' }]);
    startFilesTruthSync('new');
    const newPull = syncChangedFiles();
    oldJournal.resolve(new Response(JSON.stringify({ seq: 90, entries: [{ seq: 90, file: 'old.txt', kind: 'change' }] })));
    await Promise.all([oldPull, newPull]);
    expect(await readProjectFiles('old')).toEqual({});
    expect(await readProjectFiles('new')).toEqual({ 'new.txt': 'new' });
    expect(newCalls).not.toContain('/__sq/local/file?file=old.txt');
    expect(_filesTruthSyncState()).toEqual({ projectId: 'new', lastSeq: 1 });
    expect(getFilesTruthSyncStatus()).toEqual({ projectId: 'new', status: 'saved', error: null });
  });

  it('an event-triggered failure is caught while its error status remains visible', async () => {
    setLocalTransport({ fetch: async () => new Response('unavailable', { status: 500 }) });
    startFilesTruthSync('p1');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'SQ_FILE_CHANGED' } }));
    await vi.waitFor(() => expect(getFilesTruthSyncStatus().status).toBe('error'));
    expect(_filesTruthSyncState().lastSeq).toBe(0);
  });
});


it('a pull requested by the saved subscriber persists the next journal version before resolving', async () => {
  let version = 1;
  const cursors: number[] = [];
  setLocalTransport({ fetch: async (p) => {
    if (p.includes('/changes?')) {
      cursors.push(Number(p.split('=')[1]));
      return new Response(JSON.stringify({ seq: version, entries: [{ seq: version, file: 'index.astro', kind: 'change' }] }));
    }
    return new Response(String(version));
  } });
  startFilesTruthSync('p1');
  let overlapping: Promise<void> | undefined;
  const statuses: string[] = [];
  const off = subscribeFilesTruthSyncStatus(() => {
    const { status } = getFilesTruthSyncStatus();
    statuses.push(status);
    if (status === 'saved' && version === 1) {
      version = 2;
      overlapping = syncChangedFiles();
    }
  });
  try {
    await syncChangedFiles();
    expect(overlapping).toBeDefined();
    await overlapping;
    expect(await readProjectFiles('p1')).toEqual({ 'index.astro': '2' });
    expect(_filesTruthSyncState().lastSeq).toBe(2);
    expect(cursors).toEqual([0, 1]);
    expect(statuses).toEqual(['saving', 'saved', 'saving', 'saved']);
    expect(getFilesTruthSyncStatus().status).toBe('saved');
  } finally { off(); }
});
