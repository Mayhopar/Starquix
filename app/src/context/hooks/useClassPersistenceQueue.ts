/**
 * Deferred class-persistence queue — dirty-key tracking, idle-debounced
 * source-file writes, and the unmount flush. Extracted verbatim from
 * ClassStoreContext (godfile decomposition Phase C2).
 *
 * Owns persistClassToFile (Vite writer with VS Code extension fallback);
 * the provider's sourceClasses observer imports it for the undo-path
 * immediate persistence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { localFetch } from '@/utils/sqLocalBase';
import { liveQuery } from 'dexie';
import { listPendingRows } from '@/services/durableEdits/store';
import { startMaterializer } from '@/services/durableEdits/materializer';
import { flushDurableSourceWrites, registerSourceMaterializers } from '@/services/durableEdits/sourceMaterialization';
import toast from 'react-hot-toast';
import type { SourceLocation } from '@/store/types';
import { ViteWriteTimeoutError } from '@/services/BaseViteWriter';
import { viteClassWriter } from '@/services/ViteClassWriter';
import {
  getClassWriteBaseline,
  getObservedFileValue,
  setClassWriteBaseline,
  notifyFileWritten,
  clearPendingWrite,
} from '@/services/classWriteBaseline';
import {
  captureLocalWriteOrigin,
  isCrossFileAtOrigin,
  allowsCrossFileOverrideWrite,
  type LocalWriteOrigin,
} from '@/utils/localWriteScope';
import { getLocalExpectedRoute, getLocalPageFile } from '@/utils/localPageSync';
import { subscribeLocalComponentView, setLocalComponentViewFile, getLocalComponentViewFile, LOCAL_COMPONENT_VIEW_FAILED } from '@/services/localComponentView';
import { toastComponentOpenFailure } from '@/utils/sourceActionFeedback';
import { capturePreviewBaseline } from '@/components/Canvas/reloadPreview';
import { subscribeFlushBoundary } from '@/utils/pendingSourceWrites';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { listenFlushOnHide } from '@/utils/listenFlushOnHide';

type ElementKey = string;

/**
 * Class writes that have been dispatched but not yet acknowledged.
 *
 * Only {@link switchLocalComponentView} reads this, and only to keep the local
 * iframe from navigating over a write that has not reached disk yet.
 */
const inFlightWrites = new Set<Promise<unknown>>();
/** Join a write to {@link inFlightWrites} until it settles (never rejects the caller). */
function trackInFlight(write: Promise<unknown>): void {
  inFlightWrites.add(write);
  const forget = () => { inFlightWrites.delete(write); };
  write.then(forget, forget);
}

const NAVIGATION_WAIT_CAP_MS = 400;

/**
 * The local surface switch (master/component view ⇄ page) — the ONE place the
 * `sq:local-component-view` event is turned into "panels here, frame there".
 *
 * Order matters and is the whole point. Notifying the store synchronously
 * flushes this queue (see the subscription below), so the master write is on
 * the wire before we return; `navigate` then points the iframe at the new
 * surface. Doing both in one React commit — which is what Editor used to do —
 * made the frame request the route ~25 ms BEFORE the bytes landed (measured
 * 2026-08-06: dispatch → disk 17 ms, but disk landed 42-55 ms after the
 * navigation began), so it fetched and painted the PRE-write master. It never
 * self-heals: the HMR invalidation goes to the frame being destroyed, so the
 * stale paint is the settled canvas. Waiting also keeps the frame alive long
 * enough to receive the write's acknowledgement, which otherwise died with it
 * and surfaced as a bogus "Style not saved" toast 10 s later.
 *
 * ponytail: known ceiling — this removes paint 1 (wrong bytes) only. Paint 2,
 * the instance-override re-apply, hangs off ELEMENTS_SCANNED ~900 ms after
 * IFRAME_READY (viewportMessages/scanning.ts) and is independent of any write;
 * it needs the in-frame post-load block fixed, not this.
 */
export async function switchLocalComponentView(
  file: string | null,
  navigate: (file: string | null) => void,
): Promise<boolean> {
  // Last click wins: a slower earlier switch must never move the frame after a newer one.
  const mine = ++latestSwitch;
  const superseded = () => mine !== latestSwitch;
  const previous = getLocalComponentViewFile();
  setLocalComponentViewFile(file); // notifies panels AND flushes the queue
  if (inFlightWrites.size > 0) {
    // ponytail: hard cap so a wedged writer costs 400 ms, not the writer's own
    // 10 s timeout, on a gesture the user expects to be instant.
    await Promise.race([
      Promise.allSettled([...inFlightWrites]),
      new Promise(resolve => setTimeout(resolve, NAVIGATION_WAIT_CAP_MS)),
    ]);
  }
  if (file && !await waitForComponentView(file, superseded) && !superseded()) {
    // Never navigate into a route that did not answer: Astro's 404 loads no
    // bridge and never heals (HN report 2026-11-09). The canvas stays where it
    // is, so the panels, the pending select and the Assets row go back with it.
    console.error('[component view] the instance never served', file);
    setLocalComponentViewFile(previous);
    window.dispatchEvent(new CustomEvent('sq:pending-select', { detail: { elementId: null } }));
    window.dispatchEvent(new CustomEvent(LOCAL_COMPONENT_VIEW_FAILED, { detail: { file, previous } }));
    toastComponentOpenFailure(file.split('/').pop()!.replace(/\.astro$/, ''));
    return false;
  }
  if (superseded()) return false;
  navigate(file);
  return true;
}
let latestSwitch = 0;

const COMPONENT_VIEW_WAIT_CAP_MS = 5000;
/** The view route answers once the file is on disk (it lists the disk per request), so poll the
 *  cheap disk probe — never a render of the route the frame renders next. A rejected ask = no
 *  instance yet (boot, restart): keep asking. false = never within the cap, or superseded. */
async function waitForComponentView(file: string, superseded: () => boolean): Promise<boolean> {
  const { isDesktop } = await import('@/services/desktopDriver');
  if (!isDesktop()) return true; // no instance to ask (tests / plain-browser dev): the frame's own boot gate waits
  const deadline = Date.now() + COMPONENT_VIEW_WAIT_CAP_MS;
  while (!superseded()) {
    const ok = await localFetch(`/__sq/local/file?file=${encodeURIComponent(file)}&probe=1`)
      .then(r => r.ok && r.headers.get('x-sq-missing') !== '1', () => false);
    if (ok) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return false;
}

declare function acquireVsCodeApi(): {
  postMessage: (message: unknown) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare global {
  interface Window {
    __vscodeApiInstance?: ReturnType<typeof acquireVsCodeApi>;
  }
}

const getVsCodeApi = () => {
  if (window.__vscodeApiInstance) {
    return window.__vscodeApiInstance;
  }

  if (typeof acquireVsCodeApi !== 'undefined') {
    try {
      window.__vscodeApiInstance = acquireVsCodeApi();
    } catch {
      // API already acquired elsewhere
    }
  }

  return window.__vscodeApiInstance || null;
};

const postMessageToExtension = (message: unknown) => {
  const api = getVsCodeApi();
  if (api) {
    api.postMessage(message);
  }
};

/* ------------------------------------------------------------------------- *
 * Pagehide journal — the survivable half of the hide flush.
 *
 * The pagehide/hidden flush dispatches its writes over contentWindow.postMessage
 * into the preview iframe (BaseViteWriter.sendRequest). At pagehide that iframe
 * is being destroyed WITH the parent: the message task never runs, and even a
 * delivered one still needs the bridge's async forward to the astro dev server,
 * which navigation aborts. In WC mode nothing is lost (writes are off; the doc
 * overlay persists), but a LOCAL-mode edit dies silently and permanently — the
 * doc overlay it degrades to is a disposable session copy (task-132 law).
 *
 * So the hide flush first JOURNALS every local-mode dirty tuple to localStorage
 * (synchronous, survives unload), then dispatches as before. A write that still
 * settles — the hidden-tab case, where the page stays alive — clears its entry;
 * only a write the page died under leaves one. The next editor open REPLAYS the
 * journal, but never blindly: the entry carries what the file rendered when the
 * page died (the class-write baseline), and the replay waits for a scan to
 * vouch for what the file renders NOW (getObservedFileValue). File unchanged →
 * re-send; file already shows the edit → drop silently; file changed since →
 * drop with a toast, never splice into a file someone else moved.
 * ------------------------------------------------------------------------- */

export const CLASS_WRITE_JOURNAL_KEY = 'sq:class-write-journal:v1';
/** Entries older than this are dropped unreplayed — a day-old dangling edit is
 *  likelier to surprise than to help. */
const CLASS_WRITE_JOURNAL_TTL_MS = 24 * 60 * 60 * 1000;
const JOURNAL_REPLAY_POLL_MS = 1000;
const JOURNAL_REPLAY_WINDOW_MS = 30_000;

export interface ClassWriteJournalEntry {
  key: ElementKey;
  sourceLocation: SourceLocation;
  classes: string;
  origin: LocalWriteOrigin;
  /** What the FILE rendered when the page died (class-write baseline), or null
   *  if never observed — a null baseline can never be verified, so it drops. */
  baseline: string | null;
  /** Editor URL path — replay only inside the same project. */
  pathname: string;
  ts: number;
}

function readClassWriteJournal(): ClassWriteJournalEntry[] {
  try {
    const raw = localStorage.getItem(CLASS_WRITE_JOURNAL_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is ClassWriteJournalEntry =>
      !!e && typeof e === 'object'
      && typeof (e as ClassWriteJournalEntry).key === 'string'
      && typeof (e as ClassWriteJournalEntry).classes === 'string'
      && typeof (e as ClassWriteJournalEntry).pathname === 'string'
      && typeof (e as ClassWriteJournalEntry).sourceLocation?.file === 'string');
  } catch {
    return [];
  }
}

function writeClassWriteJournal(entries: ClassWriteJournalEntry[]): void {
  try {
    if (entries.length === 0) localStorage.removeItem(CLASS_WRITE_JOURNAL_KEY);
    else localStorage.setItem(CLASS_WRITE_JOURNAL_KEY, JSON.stringify(entries));
  } catch {
    // Quota / storage unavailable — the journal is best-effort recovery.
  }
}

/**
 * True once this session has put (or found) entries in the journal — the guard
 * that keeps every ordinary write settle from touching localStorage.
 */
let journalActive = false;

function removeClassWriteJournalEntry(key: ElementKey): void {
  if (!journalActive) return;
  const entries = readClassWriteJournal();
  const next = entries.filter(e => e.key !== key);
  if (next.length !== entries.length) writeClassWriteJournal(next);
}

/** Test-only: reset the module singletons. */
export function _resetClassWriteJournalForTests(): void {
  journalActive = false;
  replayedJournalKeys.clear();
}

/** Keys already re-sent this session (StrictMode double-mount guard). */
const replayedJournalKeys = new Set<ElementKey>();

/**
 * Replay journaled class writes from a session that died mid-flush. Call once
 * at editor mount; returns the cancel. Polls because the verification needs
 * two things that arrive on their own schedules: the writer armed (instance
 * running) and a scan having observed what the file renders for the key.
 */
export function replayClassWriteJournal(): () => void {
  if (typeof window === 'undefined') return () => {};
  const all = readClassWriteJournal();
  if (all.length === 0) return () => {};
  journalActive = true;
  const now = Date.now();
  const fresh = all.filter(e => now - e.ts <= CLASS_WRITE_JOURNAL_TTL_MS);
  if (fresh.length !== all.length) writeClassWriteJournal(fresh);
  const candidates = fresh.filter(
    e => e.pathname === window.location.pathname && !replayedJournalKeys.has(e.key),
  );
  if (candidates.length === 0) return () => {};

  const pendingKeys = new Set(candidates.map(e => e.key));
  const deadline = Date.now() + JOURNAL_REPLAY_WINDOW_MS;
  const tick = () => {
    if (viteClassWriter.isAvailable()) {
      for (const entry of candidates) {
        if (!pendingKeys.has(entry.key)) continue;
        const observed = getObservedFileValue('classes', entry.key);
        if (observed === undefined) continue; // no scan has vouched for this line yet
        pendingKeys.delete(entry.key);
        if (observed === entry.classes) {
          // The write landed before the page died — nothing to replay.
          removeClassWriteJournalEntry(entry.key);
        } else if (entry.baseline !== null && observed === entry.baseline) {
          // The file is exactly as the dying session saw it — safe to re-send.
          replayedJournalKeys.add(entry.key);
          removeClassWriteJournalEntry(entry.key);
          persistClassToFile(entry.sourceLocation, entry.classes, entry.key, entry.origin);
        } else {
          // The file moved since (external edit, or no baseline to compare) —
          // never blind-splice into changed files.
          removeClassWriteJournalEntry(entry.key);
          toast(
            `Unsaved style change to ${entry.sourceLocation.file.split('/').pop()} was discarded — the file changed since.`,
            { icon: '⚠️', id: `sq-class-journal-${entry.key}` },
          );
        }
      }
    }
    if (pendingKeys.size === 0 || Date.now() >= deadline) clearInterval(timer);
  };
  const timer = setInterval(tick, JOURNAL_REPLAY_POLL_MS);
  return () => clearInterval(timer);
}

/**
 * The local surface at this instant — expected route + page file. Captured at
 * write dispatch; if it CHANGED by the time a lost-ack write asks the preview
 * "are you serving what I wrote?", the preview is a different page and a
 * substring hit there proves nothing (a common class string like `flex gap-4`
 * matches any page). Skip the verification instead of mis-confirming.
 */
const localSurfaceStamp = () =>
  `${getLocalExpectedRoute() ?? ''}\u0000${getLocalPageFile() ?? ''}`;

/**
 * Per-key dispatch generation. A lost-ack timeout for a key whose counter has
 * MOVED since dispatch is superseded — a newer write (rapid edit, undo) owns
 * the file now, so probing for the OLD value finds it legitimately absent and
 * must not report a landed write as failed (2026-08-26: five false
 * "[ClassStore] Failed to write: Write request timeout" errors in one judged
 * session while every write was on disk).
 */
const writeDispatchGeneration = new Map<ElementKey, number>();

/**
 * Persist a class update to the source file via Vite or VS Code extension.
 *
 * `key` is the element key, used ONLY to look up (and, on success, refresh)
 * what the file renders for it — the writer needs that to keep a dynamic
 * expression's tokens out of the literal it edits (task-166,
 * services/classWriteBaseline.ts). Optional: a caller that has no key gets the
 * writer's honest refusal on the partial shapes instead of a corrupted write.
 */
export function persistClassToFile(
  sourceLocation: SourceLocation,
  classes: string,
  key?: string,
  origin?: LocalWriteOrigin,
): Promise<void> {
  // A component edited from a PAGE view is an INSTANCE edit (Figma model,
  // owner ruling 2026-09-10): it stays in the doc's sourceClasses tier —
  // persisted per project by hooks/useSourceOverridesPersistence, re-painted
  // by the scan re-apply, surfaced as `*` with Push / Reset in the DesignBar
  // (store/localMasterOverrides). The master file is written ONLY by Push.
  // Resolves: the key is done, nothing to retry.
  const writeOrigin = origin ?? captureLocalWriteOrigin();
  if (isCrossFileAtOrigin(writeOrigin, sourceLocation.file)
      && !allowsCrossFileOverrideWrite(writeOrigin, sourceLocation.file)) return Promise.resolve();
  if (viteClassWriter.isAvailable()) {
    const dispatchProject = getActiveSaveProjectId();
    // The surface the write is dispatched FROM — the lost-ack recovery below
    // must not verify against a different page's bytes (see localSurfaceStamp).
    const dispatchSurface = localSurfaceStamp();
    // This dispatch's place in the key's write order (see map above).
    const dispatchGeneration = key
      ? (writeDispatchGeneration.get(key) ?? 0) + 1
      : 0;
    if (key) writeDispatchGeneration.set(key, dispatchGeneration);
    const write = viteClassWriter.writeClassUpdate(
      sourceLocation, classes, false, key ? getClassWriteBaseline(key) : undefined, writeOrigin, true,
    );
    // Dispatched, not yet on disk. switchLocalComponentView waits on this.
    trackInFlight(write);
    if (key) {
      // Any settled outcome clears the pagehide journal entry: success and
      // verified-landed obviously, and a confirmed failure too — the user got
      // the honest toast, so there is nothing left for a replay to recover.
      // Only a write the page died under leaves its entry. No-op unless a
      // hide flush journaled this session (journalActive).
      const clearJournal = () => removeClassWriteJournalEntry(key);
      write.then(clearJournal, clearJournal);
    }
    const completion = write
      .then(wrote => {
        if (!wrote) throw new Error('Style write not dispatched. Wait for the project to start and retry saving.');
        if (wrote && key) {
          setClassWriteBaseline(key, classes);
          // The file moved and we know exactly what to. Tell the doc so every
          // placement's ↻ gate is correct immediately — no scan, no reload race.
          notifyFileWritten(key, classes);
        }
      })
      .catch(async err => {
        // Superseded: a NEWER write for this key was dispatched before this
        // rejection arrived (rapid edit, undo). The file has legitimately
        // moved past this value — the newer write owns the outcome, and
        // reporting THIS one as failed is the exact false-failure signal the
        // 2026-08-26 judged run logged five times. Say nothing, touch nothing
        // (the newer dispatch re-armed its own pending guard and baseline).
        if (key && writeDispatchGeneration.get(key) !== dispatchGeneration) return;
        // A rejection is NOT proof the write failed. Writing the file makes the
        // dev server HMR-reload the very frame that owes us the acknowledgement,
        // so a landed write routinely reports "Write request timeout" (measured
        // repeatedly 2026-08-05/06 on writes whose bytes were already on disk).
        // Toasting on that told the user their style was lost when it was saved
        // — the task-142 rule inverted, and just as damaging to trust.
        //
        // So ASK THE FILE before saying anything: if the instance is already
        // serving what we wrote, the write landed and there is nothing to warn
        // about. Only an absence is worth a toast.
        //
        // …but only when the preview still shows the surface the write was
        // dispatched from. After a page switch the probe fetches the NEW page,
        // and a short common class string (`flex gap-4`) matches almost any
        // page — a wrong-page substring hit would record a failed write as
        // landed (baseline poisoned, no toast). Surface changed → cannot
        // verify → treat as failed, honestly.
        if (err instanceof ViteWriteTimeoutError && key
            && getActiveSaveProjectId() === dispatchProject
            && localSurfaceStamp() === dispatchSurface
            && await servedTargetHasClasses(sourceLocation, classes)
            && getActiveSaveProjectId() === dispatchProject
            && localSurfaceStamp() === dispatchSurface
            && writeDispatchGeneration.get(key) === dispatchGeneration) {
          setClassWriteBaseline(key, classes);
          notifyFileWritten(key, classes);
          return;
        }
        // The read itself can outlive a newer edit/undo. Its outcome belongs
        // to that newer generation, just as when superseded before the read.
        if (key && writeDispatchGeneration.get(key) !== dispatchGeneration) return;
        // The write did NOT land — a server-side refusal is routine, not
        // hypothetical ("class:list has no editable leading literal", a partial
        // shape with no baseClasses). Disarm the frame-liveness guard the
        // dispatch armed: leaving it set wedges the scan out of ever recording
        // that line again and repaints the never-written value on every scan.
        if (key) clearPendingWrite('classes', key);
        console.error('[ClassStore] Failed to write:', err);
        toast(
          `Style not saved to ${sourceLocation.file.split('/').pop()}: ${err instanceof Error ? err.message : 'write failed'}`,
          { icon: '⚠️', id: `sq-class-write-${sourceLocation.file}` },
        );
        throw err;
      });
    void completion.catch(() => {});
    return completion;
  } else {
    if (getActiveSaveProjectId() && !getVsCodeApi()) {
      const failed = Promise.reject(new Error('Style writer unavailable. Wait for the project to start and retry saving.'));
      void failed.catch(() => {});
      return failed;
    }
    postMessageToExtension({
      type: 'UPDATE_CLASSES',
      payload: { sourceLocation, newClasses: classes }
    });
    return Promise.resolve();
  }
}


/**
 * Confirm the intended source address and exact class attribute in freshly
 * served HTML. Missing/duplicate addresses, empty values and unreadable bytes
 * cannot certify a timed-out write. The existing reader captures the selected
 * transport and bounds its read to the preview-baseline deadline.
 */
async function servedTargetHasClasses(source: SourceLocation, classes: string): Promise<boolean> {
  // An empty value proves nothing — every string contains '' — and deleting
  // every class off an element is a legitimate edit, so without this a genuinely
  // failed write on that edit would be silently swallowed. Same guard
  // requestVerifiedPreviewReload applies to its needles.
  if (classes.length === 0) return false;
  // No try/catch: fetchServedBytes resolves null on every throw path, abort
  // included.
  const html = await capturePreviewBaseline();
  if (html === null) return false;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const address = `${source.file}:${source.line}:${source.column}`;
  const targets = Array.from(document.querySelectorAll('[data-sq-source]'))
    .filter(element => element.getAttribute('data-sq-source') === address);
  // Multiple placements of one source address are ambiguous. Never let a
  // sibling, script text, or a substring of a larger class list vouch for it.
  return targets.length === 1 && targets[0].getAttribute('class') === classes;
}

export interface ClassPersistenceQueue {
  dirtyKeys: Set<ElementKey>;
  hasUnsavedChanges: boolean;
  saveAll: () => Promise<void>;
}

/** A projection of the durable journal, never an owner of pending class work. */
export function useClassPersistenceQueue(projectId: string | null): ClassPersistenceQueue {
  const [dirtyKeys, setDirtyKeys] = useState<Set<ElementKey>>(new Set());
  const dirtyRef = useRef(dirtyKeys);
  dirtyRef.current = dirtyKeys;
  const saveAll = useCallback(() => projectId ? flushDurableSourceWrites(projectId) : Promise.resolve(), [projectId]);

  useEffect(() => {
    if (!projectId) return;
    registerSourceMaterializers();
    const stop = startMaterializer(projectId);
    const subscription = liveQuery(() => listPendingRows(projectId)).subscribe(rows => {
      const keys = new Set<string>();
      for (const row of rows) for (const command of row.commands) if (command.kind === 'class-write') {
        const loc = command.payload.sourceLocation;
        keys.add(`${loc.file}:${loc.line}:${loc.column}`);
      }
      dirtyRef.current = keys; setDirtyKeys(keys);
    });
    // Tracked: the surface switch awaits inFlightWrites before navigating, or
    // the frame paints the pre-write bytes (the blink that wait exists to stop).
    const flush = () => trackInFlight(saveAll().catch(() => {}));
    const offBoundary = subscribeFlushBoundary(saveAll);
    const offSurface = subscribeLocalComponentView(flush);
    const offHide = listenFlushOnHide(flush);
    return () => {
      subscription.unsubscribe(); offBoundary(); offSurface(); offHide(); stop();
      // No unload durability work is needed: accepted edits already survived.
    };
  }, [projectId, saveAll]);
  return { dirtyKeys, hasUnsavedChanges: dirtyKeys.size > 0, saveAll };
}
