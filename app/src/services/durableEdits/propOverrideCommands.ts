import type * as Y from 'yjs';
import type { SourceLocation } from '@/store/types';
import { isCrossFileAtOrigin, allowsCrossFileOverrideWrite, captureLocalWriteOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { overrideChain, sharedChain, planOverride, latestScan, type OverrideHop, type OverrideKind, type PropFileChange } from '@/utils/propOverrides';
import { parseSourceLocationFromKey } from '@/utils/sourceLocationKey';
import { forEachEditedSourceClassEntry, editedSourceClassValue, sourceClassBaseValue, FILE_FIELD } from '@/store/sourceOverrideEntries';
import { forEachSourceTextEntry } from '@/store/sourceTextEntries';
import { getObservedFileValue } from '@/services/classWriteBaseline';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { readProjectedSourceState, withProjectedSource } from './projectedSource';
import type { MaterializationCommand } from './types';

export interface PropOverrideTarget { hops: OverrideHop[]; element: SourceLocation; tagName: string; kind: OverrideKind }
type Item = { target: PropOverrideTarget; value: string | null; key?: string };

/**
 * An instance edit on a PAGE surface (the write-scope law keeps the component
 * file itself untouched) — captured at the gesture: the usage chain from the
 * scan the user is looking at. Null = not an instance, a chain the scan cannot
 * prove, or one usage tag rendering several copies (the edit then stays an
 * editor overlay, as before files carried overrides).
 */
export function capturePropOverride(key: string, sourceLocation: SourceLocation | undefined, origin: LocalWriteOrigin,
  kind: OverrideKind = 'class'): PropOverrideTarget | null {
  if (!sourceLocation || !origin.armed || !origin.pageFile) return null;
  if (!isCrossFileAtOrigin(origin, sourceLocation.file) || allowsCrossFileOverrideWrite(origin, sourceLocation.file)) return null;
  const scan = latestScan();
  const el = scan.find(e => e.key === key);
  const hops = el ? overrideChain(scan, key, origin.pageFile) : null;
  if (!el || !hops) return null;
  if (sharedChain(scan, key, origin.pageFile, hops)) {
    console.warn('[overrides] one usage renders several copies — kept in the editor only', key);
    return null;
  }
  return { hops, element: el.sourceLocation ?? sourceLocation, tagName: el.tagName, kind };
}

const captureForKey = (key: string, kind: OverrideKind, origin: LocalWriteOrigin) =>
  capturePropOverride(key, parseSourceLocationFromKey(key) ?? undefined, origin, kind);

/**
 * Plan several overrides as ONE set of file changes — two edits on one page
 * file must chain, not race from the same `beforeSource`. A shape a prop cannot
 * express (text with expressions, a dynamic img src, a moved tag) keeps that
 * edit editor-only rather than refusing it (`ok: false`).
 */
async function planAll(projectId: string, items: readonly Item[]): Promise<{ files: PropFileChange[]; ok: boolean }> {
  const files = new Map<string, PropFileChange>();
  const fetched = new Map<string, Promise<string | null>>();
  const fetch = (file: string) => fetched.get(file) ?? fetched.set(file, readProjectedSourceState(projectId, file)).get(file)!;
  const read = async (file: string) => files.get(file)?.afterSource ?? fetch(file);
  const base = async (file: string) => files.get(file)?.beforeSource ?? fetch(file);
  let ok = true;
  for (const { target, value } of items) {
    let changes: PropFileChange[];
    try { changes = await planOverride(read, target.hops, target.element, target.tagName, target.kind, value, base); }
    catch (error) {
      console.warn('[overrides] not written to files — kept in the editor only:', error instanceof Error ? error.message : error, target);
      ok = false; continue;
    }
    for (const change of changes) {
      const prior = files.get(change.file);
      files.set(change.file, { ...change, beforeSource: prior?.beforeSource ?? change.beforeSource,
        identityMaps: [...prior?.identityMaps ?? [], ...change.identityMaps ?? []] });
    }
  }
  return { files: [...files.values()].filter(f => f.afterSource !== f.beforeSource), ok };
}

/** One journaled file write of whatever `plan` decides. */
async function acceptPlanned(projectId: string, plan: () => Promise<PropFileChange[]>): Promise<PropFileChange[]> {
  const { acceptFileChanges, finishAcceptedFiles } = await import('./fileAcceptance');
  let changed: PropFileChange[] = [];
  const accepted = await acceptFileChanges(`wc://${projectId}`, async () => (changed = await plan()));
  if (changed.length) await finishAcceptedFiles(accepted);
  return changed;
}

// What the files carry, per project + kind + element — a later scan's
// migration does not re-plan it. Bounded by the number of override entries.
const written = new Map<string, string | null>();
const writtenKey = (projectId: string, kind: OverrideKind, key: string) => `${projectId}|${kind}|${key}`;
const noteWritten = (projectId: string, items: readonly Item[]) => {
  for (const i of items) if (i.key) written.set(writtenKey(projectId, i.target.kind, i.key), i.value);
};

/** The file batch writing overrides as props (value null = drop the page prop). */
export async function preparePropOverrides(projectId: string, revision: number, items: readonly Item[]): Promise<MaterializationCommand | null> {
  if (!items.length) return null;
  const { files } = await withProjectedSource(projectId, revision, () => planAll(projectId, items));
  noteWritten(projectId, items);
  return files.length ? { kind: 'file-batch', payload: { files } } : null;
}

/** One instance edit written straight to files (the <img> sync path). False =
 *  not expressible as a prop — the caller keeps its editor-only behaviour. */
export async function acceptPropOverride(projectId: string, key: string, location: SourceLocation, kind: OverrideKind,
  value: string, origin: LocalWriteOrigin): Promise<boolean> {
  const target = capturePropOverride(key, location, origin, kind);
  if (!target) return false;
  let ok = true;
  await acceptPlanned(projectId, async () => { const r = await planAll(projectId, [{ target, value }]); ok = r.ok; return r.files; });
  if (ok) noteWritten(projectId, [{ target, value, key }]);
  return ok;
}

/**
 * Push and Reset end an override: the page stops passing the prop (the
 * plumbing stays — it is inert without a value). One journaled write; the
 * changed files are returned so the caller's undo step carries them.
 */
export async function dropPropOverrides(entries: readonly { key: string; kind: 'classes' | 'text' | 'image' }[]): Promise<PropFileChange[]> {
  const projectId = getActiveSaveProjectId();
  const origin = captureLocalWriteOrigin();
  const kinds = { classes: ['class'], text: ['text'], image: ['src', 'alt'] } as const;
  const items: Item[] = entries.flatMap(({ key, kind }) => kinds[kind].flatMap(k => {
    const target = captureForKey(key, k, origin);
    return target ? [{ target, value: null, key }] : [];
  }));
  if (!projectId || !items.length) return [];
  const changed = await acceptPlanned(projectId, async () => (await planAll(projectId, items)).files);
  noteWritten(projectId, items);
  return changed;
}

/**
 * Overrides made before files carried them (or by a path that could not write
 * then) exist only in the editor store — they would not survive export →
 * import or deploy. After each admitted scan, write the ones on this page into
 * files. Values the files already carry are skipped without any read; the rest
 * are re-checked inside the acceptance lane, so a racing Push/Reset wins.
 */
/** Values already moved into files, per project, ACROSS sessions (owner
 * 2026-10-11): the editor cache outlives the files — after a Versions restore
 * or a restored copy, replaying an old cached edit undid the restore. One
 * migration per value, ever; a new edit is a new value (written at edit time).
 * ponytail: localStorage, per-machine — the cache it guards is per-machine too. */
const MIGRATED_KEY = (projectId: string) => `sq:override-migrated:${projectId}`;
function migratedRecord(projectId: string): Map<string, string> {
  try { return new Map(Object.entries(JSON.parse(localStorage.getItem(MIGRATED_KEY(projectId)) ?? '{}') as Record<string, string>)); }
  catch { return new Map(); }
}
function saveMigratedRecord(projectId: string, record: Map<string, string>): void {
  try { localStorage.setItem(MIGRATED_KEY(projectId), JSON.stringify(Object.fromEntries(record))); } catch { /* best-effort: the in-memory set still guards this session */ }
}

export async function migrateEditorOverrides(doc: Y.Doc, scannedKeys: ReadonlySet<string>): Promise<void> {
  const projectId = getActiveSaveProjectId();
  if (!projectId) return;
  const fresh: { key: string; kind: OverrideKind; value: string }[] = [];
  const done = migratedRecord(projectId);
  const consider = (key: string, kind: OverrideKind, value: string) => {
    if (scannedKeys.has(key) && written.get(writtenKey(projectId, kind, key)) !== value && done.get(`${kind}|${key}`) !== value) fresh.push({ key, kind, value });
  };
  forEachEditedSourceClassEntry(doc, ({ key, classes }) => consider(key, 'class', classes));
  forEachSourceTextEntry(doc, ({ key, textContent }) => consider(key, 'text', textContent));
  if (!fresh.length) return;
  const origin = captureLocalWriteOrigin();
  for (const i of fresh) done.set(`${i.kind}|${i.key}`, i.value);
  saveMigratedRecord(projectId, done);
  const planned = fresh.flatMap(i => {
    written.set(writtenKey(projectId, i.kind, i.key), i.value); // once per value, whatever the outcome
    const target = captureForKey(i.key, i.kind, origin);
    return target ? [{ ...i, target }] : [];
  });
  if (!planned.length) return;
  const current = (key: string, kind: OverrideKind) => kind === 'class' ? editedSourceClassValue(doc, key)
    : (doc.getMap('sourceText').get(key) as Y.Map<unknown> | undefined)?.get('textContent');
  const live = () => planned.filter(i => current(i.key, i.kind) === i.value);
  const { inspectAcceptedProject } = await import('./acceptance');
  // Dry run first: a page that already carries the value must not cost a journal entry.
  const needed = await inspectAcceptedProject(projectId, revision => withProjectedSource(projectId, revision, () => planAll(projectId, live())));
  if (needed.files.length) await acceptPlanned(projectId, async () => (await planAll(projectId, live())).files);
}

/**
 * At the edit: remember on the entry what the MASTER renders (the observed
 * file value before the page passed anything). A page that passes the prop
 * renders the override, so for a fallback the tagger cannot report (a
 * class:list, an expression) this is the only record of the master — reopen
 * would otherwise take the override for the file and retire it.
 */
export function stampMasterFileValue(staged: Y.Doc, key: string): void {
  const entry = staged.getMap<Y.Map<unknown>>('sourceClasses').get(key);
  if (!entry || entry.has(FILE_FIELD.sourceClasses)) return;
  const master = getObservedFileValue('classes', key) ?? sourceClassBaseValue(staged, key);
  if (master !== undefined) entry.set(FILE_FIELD.sourceClasses, master);
}
