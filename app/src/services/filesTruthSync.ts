/**
 * Files-truth write-through (Phase 2 Task 2.4) — the parent half.
 *
 * Law: every file write inside the instance reaches Dexie `projectFiles`
 * before the write is reported successful. The instance keeps a deterministic
 * change journal (sq-project-fs-routes.js): project-fs routes record what
 * they touched before answering, performWrite records before its result event.
 * This module pulls `GET /__sq/local/changes?since=` and mirrors each entry —
 * bytes via `GET /__sq/local/file?file=`, unlinks (file OR directory prefix)
 * via row deletes.
 *
 * Triggers (both awaited by their caller):
 *  - localTransport: after every non-GET response (project-fs mutations);
 *  - SQ_FILE_CHANGED postMessage from the preview iframe (bridge writes).
 *
 * ponytail: for bridge writes the sync starts on the nudge that precedes the
 * write's result event — a same-tick race, not a persistence hole (the
 * journal is replayed from the last seq on the next pull anyway).
 */
import { writeProjectFile, deleteProjectFile, listProjectFilePaths } from '@/db/projectFiles';
import { localFetch } from '@/utils/sqLocalBase';
import { getSyncConfig } from '@/store/persistence/SyncClient';
import { pushProjectFiles } from '@/store/persistence/projectFilesSync';

interface JournalEntry { seq: number; file: string; kind: 'change' | 'unlink' }

interface SyncSession {
  projectId: string;
  lastSeq: number;
  /** The instance journal lastSeq counts in (a restart starts a new one at 0). */
  epoch?: string;
  inFlight: Promise<void> | null;
  rerun: boolean;
  retryDelay?: number;
}
interface FilesTruthSyncStatus {
  projectId: string | null;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error: string | null;
}

let currentSession: SyncSession | null = null;
let listener: ((e: MessageEvent) => void) | null = null;
let snapshot: FilesTruthSyncStatus = { projectId: null, status: 'idle', error: null };
const statusListeners = new Set<() => void>();

export function getFilesTruthSyncStatus(): FilesTruthSyncStatus { return snapshot; }
export function subscribeFilesTruthSyncStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

function setStatus(projectId: string | null, status: FilesTruthSyncStatus['status'], error: string | null = null): void {
  if (snapshot.projectId === projectId && snapshot.status === status && snapshot.error === error) return;
  snapshot = { projectId, status, error };
  for (const notify of statusListeners) notify();
}

export function startFilesTruthSync(projectId: string): void {
  stopFilesTruthSync();
  currentSession = { projectId, lastSeq: 0, inFlight: null, rerun: false };
  setStatus(projectId, 'idle');
  listener = (e: MessageEvent): void => {
    const d = e.data as { type?: string } | null;
    if (d?.type === 'SQ_FILE_CHANGED') void syncChangedFiles().catch(() => { /* status retains the failure */ });
  };
  window.addEventListener('message', listener);
}

export function stopFilesTruthSync(): void {
  if (listener) window.removeEventListener('message', listener);
  listener = null;
  currentSession = null;
  setStatus(null, 'idle');
}

function assertCurrent(session: SyncSession): void {
  if (currentSession !== session) throw new Error(`Files save cancelled: session for ${session.projectId} stopped`);
}

/** Coalesces overlapping calls; all callers await the requested follow-up pull. */
export function syncChangedFiles(): Promise<void> {
  const session = currentSession;
  if (!session) return Promise.resolve();
  if (session.inFlight) { session.rerun = true; return session.inFlight; }
  session.inFlight = Promise.resolve().then(async () => {
    try {
      do {
        assertCurrent(session);
        session.rerun = false;
        await pullOnce(session);
      } while (session.rerun);
      assertCurrent(session);
    } catch (cause: unknown) {
      const error = new Error(`Failed to save project files: ${cause instanceof Error ? cause.message : String(cause)}`);
      session.inFlight = null;
      if (currentSession === session) {
        setStatus(session.projectId, 'error', error.message);
        // The cursor is untouched, so the next pull replays this batch. Retry
        // on our own with backoff; no user action is needed or offered.
        session.retryDelay = Math.min((session.retryDelay ?? 500) * 2, 30_000);
        setTimeout(() => { if (currentSession === session && !session.inFlight) void syncChangedFiles().catch(() => {}); }, session.retryDelay);
      }
      throw error;
    }
    // A status subscriber can synchronously request the next version. Stop
    // accepting joins before notifying it; no later finalizer owns this slot.
    session.inFlight = null;
    session.retryDelay = undefined;
    setStatus(session.projectId, 'saved');
  });
  setStatus(session.projectId, 'saving');
  return session.inFlight;
}

async function pullOnce(session: SyncSession): Promise<void> {
  const { projectId } = session;
  const r = await localFetch(`/__sq/local/changes?since=${session.lastSeq}`);
  assertCurrent(session);
  if (!r.ok) throw new Error(`Change journal request failed (HTTP ${r.status})`);
  const { epoch, seq, entries } = (await r.json()) as { epoch?: string; seq: number; entries: JournalEntry[] };
  assertCurrent(session);
  // An in-process Astro restart re-creates the journal at seq 0: this cursor
  // counts in the old one. Replay the new journal from its start.
  if (session.lastSeq && (epoch !== session.epoch || seq < session.lastSeq)) {
    session.epoch = epoch; session.lastSeq = 0; session.rerun = true;
    return;
  }
  session.epoch = epoch;
  // Collapse to the last state per file.
  const last = new Map<string, JournalEntry>();
  for (const e of entries) last.set(e.file, e);
  for (const e of last.values()) {
    assertCurrent(session);
    if (e.kind === 'unlink') {
      const prefix = `${e.file}/`;
      const paths = await listProjectFilePaths(projectId);
      assertCurrent(session);
      for (const p of paths) {
        assertCurrent(session);
        if (p === e.file || p.startsWith(prefix)) await deleteProjectFile(projectId, p);
      }
      continue;
    }
    const f = await localFetch(`/__sq/local/file?file=${encodeURIComponent(e.file)}&probe=1`);
    assertCurrent(session);
    if (f.status === 404 || f.headers.get('x-sq-missing') === '1') { await deleteProjectFile(projectId, e.file); continue; }
    if (!f.ok) throw new Error(`Reading changed file ${e.file} failed (HTTP ${f.status})`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    assertCurrent(session);
    await writeProjectFile(projectId, e.file, bytes);
  }
  // A failed batch leaves its cursor untouched; the next pull replays it.
  assertCurrent(session);
  session.lastSeq = Math.max(session.lastSeq, seq);
  const cfg = getSyncConfig(projectId);
  if (cfg && entries.length) void pushProjectFiles(projectId, cfg).catch(() => { /* stays pending */ });
}

/** Test hook. */
export function _filesTruthSyncState(): { projectId: string | null; lastSeq: number } {
  return { projectId: currentSession?.projectId ?? null, lastSeq: currentSession?.lastSeq ?? 0 };
}
