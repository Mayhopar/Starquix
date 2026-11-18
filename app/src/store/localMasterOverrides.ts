/**
 * Local mode: the instance ⇄ master lifecycle for elements a COMPONENT renders
 * onto a page (task-149, owner ruling 2026-08-03 — "local must work exactly
 * like the normal version").
 *
 * In local mode a page renders its components inline, so an element inside
 * `<Header />` carries `src/components/Header.astro` as its sourceLocation.file
 * while the surface is `src/pages/about.astro`. Editing it is an INSTANCE edit:
 * the write-scope law (utils/localWriteScope.ts) refuses the file write and the
 * value stays in the shared Yjs source tiers — exactly what WC does with the
 * same gesture.
 *
 * That leaves the two lifecycle actions WC's ⋮ menu offers, which this module
 * implements for local mode:
 *
 *   Push   write every override belonging to that component file into the REAL
 *          .astro file (the ONE sanctioned masterWrite), then drop the
 *          overrides — the master now renders what you see.
 *   Reset  drop the overrides without writing. The master file is untouched, so
 *          a reload of the preview renders it bare again.
 *
 * `*` = this component file has at least one override on this page.
 *
 * Scope is the FILE, not one element: Push/Reset act on the whole instance
 * (same contract as WC's InstanceMenu — a half-pushed instance is a state no
 * badge can describe honestly).
 */
import * as Y from 'yjs';
import type { DurableFileChange } from '@/services/durableEdits/types';
import { settleOverrides } from '@/utils/propOverrides';
import { registeredSourceLocation, ownSourceLocation, currentScannedSourceLocation } from '@/utils/sourceLocationKey';
import { parseKey, type SourceLocation } from '@/store/types';
import { sameTokenSet } from '@/core/classes';
import { viteClassWriter } from '@/services/ViteClassWriter';
import { getClassWriteBaseline, setClassWriteBaseline, getObservedFileValue, getFileValue, setFileValue } from '@/services/classWriteBaseline';
import { viteTextWriter } from '@/services/ViteTextWriter';
import { viteImageWriter } from '@/services/ViteImageWriter';
import {
  forEachEditedSourceClassEntry,
  forEachSourceImageAttrsEntry,
  sourceBaseValue,
  sourceFileValue,
  IMAGE_BASE_FIELD,
} from './sourceOverrideEntries';
import { forEachSourceTextEntry } from './sourceTextEntries';
import { readProjectedSourceState, withProjectedSource } from '@/services/durableEdits/projectedSource';
import { inspectAcceptedProject } from '@/services/durableEdits/acceptance';

/** Source half of the Push undo snapshot, shared by its before/after captures. */
export function readLocalPushFiles(projectId: string | null, files: string[]): Promise<(string | null | undefined)[]> {
  if (!projectId) return Promise.resolve(files.map(() => undefined));
  return inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision,
    () => Promise.all(files.map(file => readProjectedSourceState(projectId, file).catch(() => undefined)))));
}

export type LocalOverrideKind = 'classes' | 'text' | 'image';

export interface LocalMasterOverride {
  kind: LocalOverrideKind;
  /** Yjs key — `file:line:col`, possibly with an instance suffix. */
  key: string;
  sourceLocation: SourceLocation;
  /** classes / textContent, or the image attribute map. */
  value: string | Record<string, string>;
}

/** The Yjs map each kind lives in. */
export const MAP_NAME: Record<LocalOverrideKind, string> = {
  classes: 'sourceClasses',
  text: 'sourceText',
  image: 'sourceImageAttributes',
};

/**
 * The ↻ anchor field each kind stamps on its entry — "what the file rendered
 * before this element was ever overridden" (task-184). Per-map names, not one
 * shared one: `baseClasses` already exists in every persisted
 * `sq:source-classes:*` payload and renaming it would orphan those anchors.
 * `image`'s name is owned by sourceOverrideEntries (it is a sibling of real
 * attributes there, so that module's iterators have to skip it).
 */
export const BASE_FIELD: Record<LocalOverrideKind, string> = {
  classes: 'baseClasses',
  text: 'baseText',
  image: IMAGE_BASE_FIELD,
};

/**
 * Every override currently sitting on elements that belong to `file` AND to
 * `placement` — the specific component INVOCATION the user has selected
 * (task-149).
 *
 * Scoping by file alone was correct only while every render of `Header.astro`
 * shared one key. With placement identity, `<Header/>` on `/` and `<Header/>`
 * on `/about` are separate overrides, and a file-wide Push would silently ship
 * an edit made on a page the user is not looking at.
 *
 * `placement` is `undefined` for an element that carries no placement segment
 * (a page file's own element, or any WC-shaped doc) — matched by strict
 * equality, so undefined selects exactly the unscoped keys.
 *
 * `sourceLocation` is placement-free by construction: parseKey strips the
 * segment, so what reaches the writers is a real, writable `file:line:col`.
 *
 * Registered-but-unedited class entries are skipped by
 * forEachEditedSourceClassEntry — selecting an element must never count as
 * divergence.
 */
export function localOverridesForPlacement(
  doc: Y.Doc,
  file: string | null,
  placement: string | undefined,
): LocalMasterOverride[] {
  if (!file) return [];
  const out: LocalMasterOverride[] = [];
  const matches = (key: string, f: string) => {
    if (f !== file) return false;
    const p = parseKey(key) as { type?: string; placement?: string } | null;
    return p?.type === 'source' && p.placement === placement;
  };

  // A coordinate key is only an index. A text/image override's own registered
  // identity wins; without one, the current admitted scan names the element it
  // is painted on — the class registration on the same key may belong to an
  // element that sat there earlier (2026-10-04 desktop wrong-element write).
  // The borrowed registration stays only as the no-scan fallback.
  const projectId = doc.getMap('meta').get('projectId') as string | undefined;
  const overrideIdentity = (map: string, key: string) => ownSourceLocation(doc, key, map)
    ?? currentScannedSourceLocation(projectId, key) ?? registeredSourceLocation(doc, key, map);

  forEachEditedSourceClassEntry(doc, ({ key, file: f, line, col, classes }) => {
    if (!matches(key, f)) return;
    out.push({ kind: 'classes', key, sourceLocation: registeredSourceLocation(doc, key) ?? { file: f, line, column: col }, value: classes });
  });
  forEachSourceTextEntry(doc, ({ key, file: f, line, col, textContent }) => {
    if (!matches(key, f)) return;
    out.push({ kind: 'text', key, sourceLocation: overrideIdentity('sourceText', key) ?? { file: f, line, column: col }, value: textContent });
  });
  forEachSourceImageAttrsEntry(doc, ({ key, file: f, line, col, attributes }) => {
    if (!matches(key, f)) return;
    out.push({ kind: 'image', key, sourceLocation: overrideIdentity('sourceImageAttributes', key) ?? { file: f, line, column: col }, value: attributes });
  });
  return out;
}

/**
 * ↻ — the master file moved PAST this placement's edit, and the placement is
 * not receiving it (task-184).
 *
 * The same axis WC/server's ↻ rides (`markupOutdated && hasLocalOverrides` in
 * DesignBar, `isMasterMarkupOutdated` in store/masters.ts): a value stamped on
 * the override at write time, compared against the master's value now. Local
 * has no instance element to carry `masterBaseRev`, so the two halves are:
 *
 *   base — `BASE_FIELD[kind]` on the override entry, what the file rendered
 *          before the first edit, persisted with the override.
 *   now  — `getObservedFileValue(kind, key)`, what the file renders now, refreshed by
 *          the scan whenever the DOM disagrees with the override we painted
 *          (Canvas/viewportMessages/scanning.ts).
 *
 * They differ exactly when HMR delivered a new master value and the scan
 * re-apply repainted the stored override over it — the state the user cannot
 * otherwise see. Either half unknown ⇒ false: a missing ↻ is a small loss, a
 * false one sends the user to discard their own work.
 *
 * KIND-AGNOSTIC by construction (task-184 unit B). It used to early-return on
 * `kind !== 'classes'`, so a text-only edit could never light ↻ however far the
 * master moved — measured live on rig `local_63cmon`, two <Card/> placements on
 * one route: the overridden one kept rendering the pre-edit copy while its
 * sibling took the master's new one, `verdict=false kinds=["text:…"]`.
 *
 * `image` needed no branch either (task-186 FIX-2): it was dark only because
 * nothing recorded a file value for it — the bridge scan reported `hasSrc`, a
 * boolean, and no attribute VALUES. Once the scan carried the `<img>` src the
 * same two halves lit it, one row in Canvas/viewportMessages/scanning.ts.
 * KNOWN CEILING: `now` is the src alone, so a master change that touches ONLY
 * `alt` (or `loading`) still leaves ↻ dark. Widening it = report those
 * attributes from the scan too and join them here; the payload cost is per-img
 * on every scan, which is why src alone ships.
 */
export function localMasterOutdated(
  doc: Y.Doc,
  file: string | null,
  placement: string | undefined,
): boolean {
  return localOverridesForPlacement(doc, file, placement).some((e) => {
    const base = sourceBaseValue(doc, MAP_NAME[e.kind], BASE_FIELD[e.kind], e.key);
    // OBSERVED, not merely known: ClassStoreContext seeds a restored overlay
    // key from the OVERRIDE value at boot, so `getFileValue` would answer "the
    // file renders your edit" for every reloaded override and light ↻ on a
    // master that never moved (owner-reported 2026-08-05). Same proof bar
    // isEditedSourceClassEntry already demands — a false ↻ sends the user to
    // discard their own work, so it must never fire on a guess.
    // PERSISTED on the entry first, in-memory observation second. The
    // singleton is destroyed by every iframe reload — and one master write
    // produced FIVE bridge reloads — so the badge used to go dark until some
    // later scan re-derived it (measured: several trips to Assets for one
    // edit). The persisted half makes it durable; the in-memory half still
    // answers for a session that observed the file before this field existed.
    const now = sourceFileValue(doc, MAP_NAME[e.kind], e.key)
      ?? getObservedFileValue(e.kind, e.key);
    if (base === undefined || now === undefined) return false;
    // Token SET for classes: a reorder is not a master move, and this module's
    // own contract is that a false badge sends the user to discard their work.
    // isEditedSourceClassEntry already guards the same comparison this way.
    return e.kind === 'classes'
      ? !sameTokenSet(now.split(/\s+/).filter(Boolean), base)
      : now !== base;
  });
}

/** `*` — does this placement of the component carry any unpushed instance edit? */
export function hasLocalMasterOverrides(
  doc: Y.Doc,
  file: string | null,
  placement: string | undefined,
): boolean {
  return localOverridesForPlacement(doc, file, placement).length > 0;
}

/**
 * Drop the given overrides from the doc. Default 'sync' origin (Push: no undo
 * step). Reset passes 'user' so its transaction commits the snapshot it
 * requested — a 'sync' transaction never commits one (UndoContext), which made
 * Reset un-undoable.
 */
export function clearLocalOverrides(doc: Y.Doc, entries: LocalMasterOverride[], origin: 'sync' | 'user' = 'sync'): void {
  if (entries.length === 0) return;
  doc.transact(() => {
    for (const e of entries) doc.getMap(MAP_NAME[e.kind]).delete(e.key);
  }, origin);
}

/**
 * The override also lives in files as a page prop (utils/propOverrides.ts):
 * Push and Reset drop it there, awaited, so the canvas reload after them shows
 * the files' final state and the caller's undo step can carry the bytes.
 * Never throws — a drop that fails leaves the prop, which the next scan
 * re-seeds as an override (visible, Reset-able), never a silent divergence.
 */
async function dropFileOverrides(entries: LocalMasterOverride[]): Promise<DurableFileChange[]> {
  if (!entries.length) return [];
  settleOverrides(entries);
  try {
    const { dropPropOverrides } = await import('@/services/durableEdits/propOverrideCommands');
    return await dropPropOverrides(entries);
  } catch (error) {
    settleOverrides(entries, false); // the prop stayed: the next scan re-seeds it, visible and Reset-able
    console.error('[overrides] page prop not dropped', error);
    return [];
  }
}

/** Reset: the page stops passing the props, then the editor entries go —
 *  one undo step (`claim`, the caller's claimed snapshot) carrying the files. */
export async function resetLocalOverrides(doc: Y.Doc, entries: LocalMasterOverride[],
  claim?: { attachFiles?(files: DurableFileChange[]): void; commit(): void }): Promise<void> {
  const files = await dropFileOverrides(entries);
  clearLocalOverrides(doc, entries, 'user');
  if (!claim) return;
  if (files.length) claim.attachFiles?.(files);
  claim.commit();
}

/** One override → one real file write. Resolves false on any writer refusal. */
async function writeOverride(entry: LocalMasterOverride, fileValue?: string): Promise<boolean> {
  if (entry.kind === 'classes') {
    // baseClasses = what the file renders for this element (task-166). Without
    // it the writer cannot tell the tokens a leading literal owns from the ones
    // a dynamic expression contributes, and it refuses rather than bake one
    // over the other — the refusal reason is threaded back to the toast below.
    const ok = await viteClassWriter.writeClassUpdate(
      // The persisted master render first: a page passing an override prop RENDERS
      // the override, so the scan-fed baseline would describe the page, not the file.
      entry.sourceLocation, entry.value as string, true, fileValue ?? getClassWriteBaseline(entry.key),
    );
    if (ok) setClassWriteBaseline(entry.key, entry.value as string);
    return ok;
  }
  if (entry.kind === 'text') {
    return viteTextWriter.writeTextUpdate(entry.sourceLocation, entry.value as string, true);
  }
  const attrs = entry.value as Record<string, string>;
  for (const [attribute, newValue] of Object.entries(attrs)) {
    const ok = await viteImageWriter.writeImageUpdate(
      entry.sourceLocation,
      attribute as 'src' | 'alt' | 'loading' | 'data-sq-media',
      newValue,
      true,
    );
    if (!ok) return false;
  }
  return true;
}

export interface LocalPushResult {
  pushed: number;
  failed: number;
  /**
   * Why the failures failed, de-duplicated, in first-seen order.
   *
   * Verified live before this existed: the component-view route toasted the
   * writer's real message ("class:list has no editable leading literal — edit
   * it in the source file") while PUSH — the route users actually hit — said
   * only "MapBar: 1 change could not be pushed". No cause, no remedy, and
   * indistinguishable from a writer timeout. The rejection was caught here and
   * counted; the message was dropped on the floor.
   */
  reasons: string[];
  /**
   * The values that actually LANDED on disk — one per class/text override, one
   * per image attribute. `Canvas/reloadPreview.ts` uses them as the needles it
   * waits for in the served HTML, which is why they are the landed set and not
   * the attempted one: a failed write's value never reaches the page, and
   * waiting for it would burn the whole verification cap.
   */
  values: string[];
  /** Keys of the overrides that landed (Push's undo re-points their file values). */
  landedKeys: string[];
  /** The page files whose override props Push dropped — Push's undo carries them. */
  droppedFiles: DurableFileChange[];
}

/**
 * Undo/redo hooks for what the FILE renders after a Push. Push's writers stamp
 * the pushed value as the observed file value; undo's file batch puts the old
 * bytes back but nothing re-observes them (the canvas shows the restored
 * override, so no scan disagreement fires). A stale "file = pushed value" made
 * the restored override look identical to the file — no `*`. Capture BEFORE
 * the push; `landed` = the overrides the push cleared.
 */
export function pushFileValueUndo(doc: Y.Doc, entries: LocalMasterOverride[]) {
  const values = new Map<string, { kind: LocalOverrideKind; before?: string; after: string }>();
  for (const e of entries) {
    if (typeof e.value !== 'string') continue;
    // What the file renders now — the same order localMasterOutdated reads
    // (persisted on the entry first), then the ↻ anchor.
    const before = sourceFileValue(doc, MAP_NAME[e.kind], e.key) ?? getFileValue(e.kind, e.key)
      ?? sourceBaseValue(doc, MAP_NAME[e.kind], BASE_FIELD[e.kind], e.key);
    values.set(e.key, { kind: e.kind, before, after: e.value });
  }
  const landed = new Set<string>();
  const apply = (pick: 'before' | 'after') => {
    for (const key of landed) {
      const v = values.get(key);
      if (v?.[pick] !== undefined) setFileValue(v.kind, key, v[pick]!);
    }
  };
  return {
    setLanded: (keys: string[]) => { for (const k of keys) landed.add(k); },
    reverse: () => apply('before'),
    forward: () => apply('after'),
  };
}

/** The string(s) a single override puts in the file. */
function overrideValues(entry: LocalMasterOverride): string[] {
  return typeof entry.value === 'string' ? [entry.value] : Object.values(entry.value);
}

/**
 * Push feedback copy is NOT local's own: `store/pushNotice.ts` builds it for
 * every runtime, so the report the user reads after a Push cannot drift between
 * local and WC/server. `LocalPushResult` is structurally its `PushResult`.
 */

/**
 * Push every override on `file` into the real component file.
 *
 * Writes are SEQUENTIAL: two writes into the same .astro file are
 * read-modify-write against the same bytes, and concurrent ones lose an edit.
 *
 * Only the overrides that actually landed are cleared — a failed write must
 * keep its override, or the canvas would keep showing a change that exists
 * nowhere (the task-142 rule: never let the canvas lie about what is saved).
 */
export async function pushLocalOverridesToMaster(
  doc: Y.Doc,
  file: string,
  placement?: string,
): Promise<LocalPushResult> {
  const entries = localOverridesForPlacement(doc, file, placement);
  const done: LocalMasterOverride[] = [];
  const reasons: string[] = [];
  let failed = 0;
  for (const entry of entries) {
    let ok = false;
    try {
      ok = await writeOverride(entry, entry.kind === 'classes' ? sourceFileValue(doc, 'sourceClasses', entry.key) : undefined);
      // A plain `false` is BaseViteWriter refusing to send at all (no writer,
      // wrong file scope) — there is no message to relay, and inventing one
      // would be worse than the count.
      if (!ok) noteReason(reasons, 'the editor could not write to this file');
    } catch (err) {
      ok = false; // writer rejects on timeout / server error / an honest refusal
      noteReason(reasons, err instanceof Error ? err.message : String(err));
    }
    if (ok) done.push(entry);
    else failed += 1;
  }
  const droppedFiles = await dropFileOverrides(done);
  clearLocalOverrides(doc, [...done, ...supersededMasterOverrides(doc, file, placement, done)]);
  return { pushed: done.length, failed, values: done.flatMap(overrideValues), reasons, landedKeys: done.map(e => e.key), droppedFiles };
}

/**
 * The master's OWN overrides on `file` — bare keys, no placement — once a Push
 * has rewritten that file (task-185, measured on the owner's project).
 *
 * Clicking an element in the master/component view registers it under the BARE
 * key `file:line:col`, and editing it there makes that entry an override. It is
 * not part of any placement, so `localOverridesForPlacement(doc, file, A)`
 * — placement matched by strict equality — never returns it and the Push never
 * cleared it. The result: the file, the `__sq_component_view` endpoint and the
 * page route all served the pushed value while the master editor kept painting
 * the PRE-push one, and the post-push rescan then anchored `baseClasses` to the
 * POST-push value, so `base === now` and ↻ was structurally unable to offer a
 * way out. No UI route existed to clear it.
 *
 * ⚠️ This DELETES a stored override, against the repo's usual "never purge"
 * rule. Deliberate and narrow: only the one file the Push just wrote, only when
 * a write actually landed (`done.length > 0` — a failed Push moved nothing, so
 * the master's own edit is still the only copy of that work), and only the bare
 * keys, which by construction describe the file state the write superseded.
 * Other placements of the same component keep their overrides — they are edits
 * the user made elsewhere, not a stale view of what was just written. NO
 * KEY_SCHEME change.
 *
 * Reuses the existing gather: same function, same filters, CLEAR scope only —
 * the WRITE stays placement-scoped (task-149: Push must not ship an edit made
 * on a page the user is not looking at).
 */
function supersededMasterOverrides(
  doc: Y.Doc,
  file: string,
  placement: string | undefined,
  done: LocalMasterOverride[],
): LocalMasterOverride[] {
  // placement === undefined ⇒ `done` already IS the bare-key set; re-gathering
  // would hand clearLocalOverrides the same keys twice.
  if (placement === undefined || done.length === 0) return [];
  return localOverridesForPlacement(doc, file, undefined);
}

/** First-seen order, no duplicates: three elements of one component refusing
 *  for the same reason must read as one sentence, not three. */
function noteReason(into: string[], reason: string): void {
  const text = reason.trim();
  if (text && !into.includes(text)) into.push(text);
}
