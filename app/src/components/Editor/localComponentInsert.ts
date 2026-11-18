import { fileBase, libraryTags, themedComponentFile } from '@/utils/libraryThemes';
import { sourceActionFailure } from '@/utils/sourceActionFeedback';
/**
 * task-133 Task 5: ⌘K user-component insert for the local (files-truth)
 * runtime. Writes the REAL source file through viteStructuralWriter — no doc
 * dispatch, no takeSnapshot, no elementId flow (the doc is a disposable
 * session copy; task-133 Task 8 wires undo through inverse structural writes).
 *
 * SEQUENCING RULE (Task 3 review, binding): both writes hit the SAME file, so
 * the import write is awaited before the insert is issued — a second write
 * computed against pre-HMR line numbers corrupts the file.
 */
import toast from 'react-hot-toast';
import type { ScannedElement } from '@/context/SelectionContext';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import type { ThemeComponentTemplate } from '@/components/ComponentPickerModal';
import type { SourceLocation } from '@/bridge/types';
import { parseKey } from '@/store/types';
import { resolveLocalUsageTarget, type UsageTargetNode } from '@/utils/localUsageTarget';
import {
  resolveInsertTarget,
  resolvePageFileAnchor,
  buildLocalComponentInsert,
  type InsertTargetResult,
  type LocalStructuralResult,
} from '@/utils/localStructural';
import { viteStructuralWriter, type StructuralRemoveResult } from '@/services/ViteStructuralWriter';
import { setLocalPendingSelection, getSelectionEpoch } from '@/utils/localPendingSelection';
import {
  acquireStructuralWrite,
  releaseStructuralWrite,
  classifyStructuralTarget,
} from './localStructuralOps';
import { afterLocalPageArrives, isLocalPageInSync, LOCAL_PAGE_NOT_LOADED_REASON } from '@/utils/localPageSync';
import { prepareSourceGesture } from '@/services/durableEdits/sourceGesture';
import { acceptFileChanges, finishAcceptedFiles, projectIdForFolder } from '@/services/durableEdits/fileAcceptance';
import { projectedSourceFiles } from '@/services/durableEdits/projectedSource';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import type { StructuralUndoRecord } from '@/store/structuralUndo';
import type { DurableFileChange } from '@/services/durableEdits/types';
import { notifyLocalCrossFileWrite, localCrossFileReason, captureLocalWriteOrigin, type LocalWriteOrigin } from '@/utils/localWriteScope';
import { insertRegionInverseOp, type PushStructuralUndo } from '@/store/structuralUndo';
import { localFetch } from '../../utils/sqLocalBase';
import { loadSnapshot } from '@/services/snapshotLoader';
import { createLibraryAssets, planLibraryAssets, readProjectAssetSources, reconcileProjectComponentAssets, type AssetSource } from './libraryComponentAssets';
import { projectIdFromPath } from '@/utils/localMode';

export interface LocalInsertArgs {
  component: ScannedComponent | ThemeComponentTemplate;
  /** The selected scanned element, if any (Editor resolves selectedKeyRef → scan). */
  selection: ScannedElement | null;
  scannedElements: ScannedElement[];
  /** Project-relative file backing the current page (resolveLocalPageFile). */
  pageFile: string | null;
  /** task-133 Task 8: UndoContext's pushStructuralUndo — pushed ONLY on full success. */
  pushUndo?: PushStructuralUndo;
  /**
   * Gaps 11/36: the local project's ABSOLUTE folder. When set,
   * built-in/theme components are MATERIALIZED into the project's
   * src/components/ (copy the real bytes + relative .astro deps, reuse a
   * same-named user file, never overwrite) and then inserted through the
   * normal path. Absent = the old own-project-only refusal (AI tool path
   * keeps its own honest refusal until it threads the path too).
   */
  localProjectPath?: string | null;
  /**
   * Gap 7 (DragGutter Replace): scanned key of the element the insert
   * replaces. The insert is anchored AFTER it (inserting inside an element we
   * then remove would delete the new component with it) and, on success, the
   * element is removed in the same guarded sequence. Un-removable targets
   * (cross-file with no usage tag, loop copies, non-source keys) keep the
   * insert and toast honestly.
   */
  replaceKey?: string | null;
  /** Scan tree for the replace flow's usage re-target (task-148 semantics). */
  scannedByKey?: ReadonlyMap<string, UsageTargetNode>;
}

const NOT_READY = "Page isn't ready yet — click an element first";

/** A failed insert the user can act on: toast the real cause, return the
 *  reason the AI tool relays (unchanged per site). */
function failInsert(cause: unknown, reason: string): { ok: false; reason: string } {
  toast.error(sourceActionFailure('insert', cause));
  return { ok: false, reason };
}
const notSavedReason = (error: unknown) => error instanceof Error ? error.message : 'Component insertion was not saved';

/** Result contract (task-133 Task 9): {ok:true} ONLY on a resolved write —
 *  the AI tool relays `reason`; UI callers ignore the return (toasts inside). */
export async function insertLocalComponent(args: LocalInsertArgs): Promise<LocalStructuralResult> {
  // Wrong-file-write guard: the scan (and the iframe) may still describe the
  // page the user just left — resolving a target from it writes the WRONG real
  // file. Owner 2026-11-10 ("it must just SWITCH"): never a refusal — the
  // insert lands on the switched-to page, against its own scan, once that
  // lands; a selection/replace target made on the outgoing page is moot there.
  // Checked before the in-flight guard: waiting never holds it.
  if (!isLocalPageInSync()) {
    return afterLocalPageArrives((page) => insertLocalComponent({
      ...args, selection: null, replaceKey: null, scannedElements: page.scanned,
      scannedByKey: new Map(page.scanned.map((e) => [e.key, e])), pageFile: page.pageFile,
    }), { ok: false, reason: LOCAL_PAGE_NOT_LOADED_REASON });
  }
  // The page this gesture belongs to, captured before it waits its write turn.
  const origin = captureLocalWriteOrigin();
  const selectionEpoch = getSelectionEpoch();
  await acquireStructuralWrite();
  const prepared: { files: DurableFileChange[]; accepted?: () => void; materialized?: () => void } = { files: [] };
  let result: LocalStructuralResult | undefined;
  try {
    const projectId = projectIdFromPath(args.localProjectPath) ?? getActiveSaveProjectId();
    if (!projectId) throw new Error('Project storage is not ready');
    const accepted = await acceptFileChanges(`wc://${projectId}`, async () => {
      result = await prepareLocalComponentInsert(args, prepared, origin, selectionEpoch);
      if (!result.ok) throw new Error(result.reason);
      return prepared.files;
    });
    try { prepared.accepted?.(); } catch (error) { console.error('[insert accepted inverse]', error); }
    void finishAcceptedFiles(accepted).then(result => {
      if (result.status === 'materialized') prepared.materialized?.();
    }).catch(error => console.error('[insert projection observer]', error));
    return result!;
  } catch (error) {
    if (result && !result.ok) return result;
    console.error('Component insertion preparation failed:', error);
    return failInsert(error, notSavedReason(error));
  } finally { releaseStructuralWrite(); }
}

async function prepareLocalComponentInsert({
  component,
  selection,
  scannedElements,
  pageFile,
  pushUndo,
  localProjectPath,
  replaceKey,
  scannedByKey,
}: LocalInsertArgs, prepared: { files: DurableFileChange[]; accepted?: () => void; materialized?: () => void }, origin: LocalWriteOrigin, selectionEpoch: number): Promise<LocalStructuralResult> {
  // Built-ins/theme templates don't exist in the user's project. With a
  // project path they are MATERIALIZED below (gaps 11/36); without one the
  // old honest refusal stands (e.g. the AI tool path).
  const needsMaterialize = !('source' in component) || component.source !== 'user-project';
  if (needsMaterialize && !localProjectPath) {
    toast('Only components from your own project can be inserted in local mode');
    return { ok: false, reason: 'only components from your own project can be inserted in local mode' };
  }
  // task-149: a component whose .astro file has NO template renders nothing —
  // the insert "works", the canvas is unchanged, and the only feedback is a
  // green "Added X". (Live: Header.astro/Back.astro were left frontmatter-only
  // by the 2026-08-02 cross-file delete incident; the user dropped Header SEVEN
  // times chasing the silence.) `html` is the raw template body from the local
  // scan — refuse on an explicitly empty one, before any write. Undefined means
  // "the scan didn't say", which is never treated as empty. (Materialized
  // components are checked against their REAL bytes inside materialize.)
  if (!needsMaterialize && typeof component.html === 'string' && component.html.trim() === '') {
    const detail = `${component.name} has no markup — it renders nothing until you add some`;
    toast(detail);
    return { ok: false, reason: detail };
  }
  if (!pageFile) {
    // Doc-only page / boot — "click an element" would be wrong advice here.
    toast('This page has no source file yet — structural edits need a real page file');
    return { ok: false, reason: 'this page has no source file yet — structural edits need a real page file' };
  }

  // From here the gesture is bound to the page it was made on: its scan and
  // pageFile are one consistent snapshot, and every resolution below uses them
  // explicitly. A page switch from now on never cancels it — the insert
  // finishes on that page in the background (owner 2026-11-10).

  // Task 7 review follow-up + adversarial review (stale-span splice): the ONE
  // shared structural guard is acquired BEFORE materialize and held through
  // insert + replace. Materialize never writes the page file, but its
  // multi-roundtrip awaits used to run with the guard FREE — a foreign
  // structural write (⌘Z replay, Delete, an AI tool) landing in that window
  // shifts lines under the gesture-time scan coordinates, and the Replace
  // step's writeRemove(allowRootRemoval) would then splice a stale span:
  // silent wrong-element deletion from the user's real file. Holding the
  // guard across the whole gesture serializes it against every other writer.
  try {
    const projectId = projectIdFromPath(localProjectPath) ?? getActiveSaveProjectId();
    if (!projectId) throw new Error('Project storage is not ready');
    const gesture = prepareSourceGesture(projectId, [], origin);
    const records: StructuralUndoRecord[] = [];
    const dependencies: DurableFileChange[] = [];
    // Gaps 11/36: materialize a built-in/theme component into the user's own
    // src/components/ and insert THAT — the rest of the flow is byte-identical
    // to a user-project insert.
    let insertable: { name: string; path: string } = component as { name: string; path: string };
    let mat: (MaterializeResult & { ok: true }) | null = null;
    let repairedAssets: string[] = [];
    if (!needsMaterialize && localProjectPath) {
      try { repairedAssets = await reconcileProjectComponentAssets(localProjectPath, insertable.path, dependencies); }
      catch (error) {
        const reason = error instanceof Error ? error.message : 'could not copy component assets';
        // No toast: a read/visibility miss (projection lag) is nothing the
        // user can act on (componentProjection.test pins this).
        console.error('Component assets could not be prepared:', error);
        return { ok: false, reason };
      }
    }
    if (needsMaterialize) {
      const m = await materializeLibraryComponent(component, localProjectPath!, dependencies);
      if (!m.ok) {
        console.error('Component could not be prepared:', m.reason);
        return failInsert(m.reason, m.reason);
      }
      if (m.body.trim() === '') {
        const detail = `${component.name} has no markup — it renders nothing until you add some`;
        toast(detail);
        return { ok: false, reason: detail };
      }
      mat = m;
      // Import under the file's own name: a themed section may land as `<Name><Theme>.astro`,
      // and must not collide with the other theme's `<Name>` already on the page.
      insertable = { name: fileBase(m.path), path: m.path };
    }

    // Honest-toast note (adversarial review): what materialize actually did —
    // the same-name reuse substitution and the files copied into the user's
    // repo were both silent before. Created paths are NOT in the undo record:
    // the structural undo machinery has no component-file-delete op (page
    // delete is the only file-level op and it mirrors into the doc), so ⌘Z
    // leaves the copies — the toast names them so cleanup is deliberate.
    const assetNote = repairedAssets.length ? ` — copied ${repairedAssets.length} missing bundled asset${repairedAssets.length === 1 ? '' : 's'} into public/assets/` : '';
    const matNote = !mat
      ? assetNote
      : mat.reused
        ? ` — using your existing ${baseName(mat.path)} (a component with this name is already in your project)${mat.created.length ? ` — copied ${mat.created.length} missing bundled asset${mat.created.length === 1 ? '' : 's'}` : ''}`
        : mat.created.length > 1
          ? ` — copied ${baseName(mat.path)} (+${mat.created.length - 1} ${mat.created.length === 2 ? 'dependency' : 'dependencies'}) into your project`
          : ` — copied ${baseName(mat.path)} into src/components/`;

    // Gap 7 (Replace): resolve the replaced element BEFORE the insert so the
    // insert can be anchored AFTER it — inserting inside-end of an element we
    // then remove would delete the new component with it. Un-removable targets
    // degrade to a plain insert with an honest toast (never a silent "Added").
    let replaceTarget: SourceLocation | null = null;
    let replaceDegraded: string | null = null;
    if (replaceKey) {
      const suffixed = /#\d+$/.test(replaceKey);
      // task-148 usage re-target: a component's rendered root is cross-file, but
      // the `<Component />` tag that placed it is this page's own markup.
      const usage = resolveLocalUsageTarget(replaceKey, scannedByKey, pageFile);
      if (usage) {
        replaceTarget = usage;
      } else if (suffixed) {
        replaceDegraded = "loop copies can't be replaced individually";
      } else {
        const parsed = parseKey(replaceKey);
        if (parsed?.type !== 'source') {
          replaceDegraded = 'this element cannot be replaced here';
        } else if (classifyStructuralTarget(parsed.file, pageFile) === 'cross-file') {
          replaceDegraded = 'the replaced element is part of a shared component';
        } else {
          replaceTarget = scannedByKey?.get(replaceKey)?.sourceLocation ?? { file: parsed.file, line: parsed.line, column: parsed.col };
        }
      }
    }

    // task-149: the selection usually points INTO a rendered component — anchor
    // the insert at its nearest page-file ancestor (or the page body) instead of
    // handing the write-scope guard a cross-file target it can only refuse.
    // A resolved replace target overrides the anchor: insert lands AFTER it.
    const targetOrError: InsertTargetResult = replaceTarget
      ? { loc: replaceTarget, position: 'after' }
      : resolveInsertTarget(
          resolvePageFileAnchor(selection, scannedElements, pageFile),
          scannedElements,
          pageFile,
        );
    if ('error' in targetOrError) {
      toast(
        targetOrError.error === 'component-instance'
          ? "Loop copies / component internals can't take inserts — select a page element"
          : NOT_READY
      );
      return {
        ok: false,
        reason: targetOrError.error === 'component-instance'
          ? "loop copies / component internals can't take inserts — target a page element"
          : "the page isn't scanned yet — wait for the preview to load",
      };
    }
    const target = targetOrError;
    if (!('pageBody' in target)) {
      target.loc = await gesture.resolve(target.loc);
      if (replaceTarget) replaceTarget = target.loc;
    }

    // The import must live in the file the tag lands in. A cross-file selection
    // (element inside a user component rendered on the page) is a valid target —
    // resolveInsertTarget allows it — so key everything off target.loc.file,
    // not pageFile (they're equal in the common case). Fix 1 (task-148): the
    // page-BODY anchor has no loc at all — it always targets the page file.
    const pageBody = 'pageBody' in target;
    const targetFile = pageBody ? pageFile : target.loc.file;

    // THE write-scope law (utils/localWriteScope.ts): from a page view the insert
    // must land in the PAGE file. A selection inside a rendered component resolves
    // to that component's file — inserting there would add the element to every
    // page using it, an instance-scope gesture rewriting the master. Refused
    // BEFORE the import write, or a refused insert would leave a stray import in
    // a file we were not allowed to touch. In the component view the component IS
    // the surface, so its own inserts are same-file and proceed.
    if (classifyStructuralTarget(targetFile, pageFile) === 'cross-file') {
      notifyLocalCrossFileWrite(targetFile);
      return { ok: false, reason: localCrossFileReason(targetFile) };
    }

    let build: ReturnType<typeof buildLocalComponentInsert>;
    try {
      build = buildLocalComponentInsert(insertable, targetFile);
    } catch {
      const reason = `can't derive a component identifier from "${component.name}"`;
      return failInsert(reason, reason);
    }

    let imp: Awaited<ReturnType<typeof viteStructuralWriter.writeImport>>;
    try {
      imp = await gesture.apply({ kind: 'import', pageFile: targetFile, name: build.importName, importPath: build.importPath, remove: false });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'could not add the import';
      console.error('Component insertion failed:', err);
      return failInsert(detail, detail);
    }
    if (!imp || !imp.success) {
      console.error('Component import was not confirmed:', imp);
      return failInsert('could not add the import', 'could not add the import');
    }

    // Import shifts are another identity transform. Resolve its exact version
    // and coordinate together, rather than changing the line alone.
    const insertLoc = pageBody
      ? { file: targetFile, line: 0, column: 0 }
      : await gesture.resolve(target.loc);

    let res: Awaited<ReturnType<typeof viteStructuralWriter.writeInsert>>;
    try {
      res = pageBody
        ? await gesture.apply({ kind: 'append-page', pageFile: targetFile, markup: build.tagMarkup }) as unknown as Exclude<typeof res, false>
        : await gesture.apply({ kind: 'insert', loc: insertLoc, markup: build.tagMarkup, position: target.position }) as unknown as Exclude<typeof res, false>;
    } catch (err) {
      // A stray unused import is harmless — log it instead of unwinding.
      console.warn('[task-133] insert failed after import write (stray import left behind)', {
        targetFile, importName: build.importName, err,
      });
      console.error('Component insertion failed:', err);
      return failInsert(err, sourceActionFailure('insert', err));
    }
    if (!res || !res.success) {
      console.warn('[task-133] insert not applied (stray import left behind)', {
        targetFile, importName: build.importName,
      });
      return failInsert(undefined, sourceActionFailure('insert'));
    }
    // task-133 Task 8 + live-smoke Critical: inverse = ONE byte-exact region
    // restore of the splice (a mid-line splice splits the target's inline
    // closing tag onto its own line; remove-at-insertedLine never rejoined
    // it — silent wrong-element deletion on the next undo), THEN strip the
    // import — but ONLY if this gesture added it (added:false = pre-existing;
    // undo must not strip the user's own import). The region restore runs
    // first so its lines are still valid (the import strip shifts the body).
    records.push({
      structuralOp: {
        forward: [
          ...(imp.added
            ? [{ kind: 'import' as const, pageFile: targetFile, name: build.importName, importPath: build.importPath, remove: false }]
            : []),
          // ADJUSTED loc: redo replays import-add first, so post-import
          // coordinates are the correct replay target. (The page-body append
          // needs no coordinates — the plugin re-resolves the anchor.)
          'pageBody' in target
            ? { kind: 'append-page' as const, pageFile: targetFile, markup: build.tagMarkup }
            : { kind: 'insert' as const, loc: insertLoc, markup: build.tagMarkup, position: target.position },
        ],
        inverse: [
          insertRegionInverseOp(res)
            // allowRootRemoval: an inverse remove undoes OUR OWN insert.
            ?? { kind: 'remove', loc: { file: res.file, line: res.insertedLine, column: 1 }, allowRootRemoval: true },
          ...(imp.added
            ? [{
                kind: 'import' as const,
                pageFile: targetFile,
                name: build.importName,
                importPath: build.importPath,
                remove: true,
                // lineDelta 3 = the add CREATED the frontmatter — undo must
                // collapse the then-empty fence pair or the restore is not
                // byte-exact (+2 stale lines for every deeper entry).
                ...(imp.lineDelta === 3 ? { removeFences: true } : {}),
              }]
            : []),
        ],
      },
    });

    // Gap 7 (Replace): remove the replaced element inside the SAME guard hold
    // (task-133 law — writes strictly sequential, one gesture one guard).
    // Resolve through both accepted import and insertion maps for removal.
    // Undo lands as TWO records (remove first, then insert) — each is
    // byte-exact against the state its coordinates were computed in; a single
    // combined record would replay regions against shifted lines. The success
    // toast names the two-step ⌘Z contract (adversarial review: one ⌘Z shows
    // BOTH elements, which read as "undo is broken" with no explanation).
    if (replaceTarget) {
      const removeLoc = await gesture.resolve(replaceTarget);
      let rem: Awaited<ReturnType<typeof viteStructuralWriter.writeRemove>> = false;
      try {
        // allowRootRemoval: the target is same-file by construction (the
        // cross-file case degraded above) — same opt-in as deleteLocalElement.
        rem = await gesture.apply({ kind: 'remove', loc: removeLoc, allowRootRemoval: true }) as unknown as StructuralRemoveResult;
      } catch {
        rem = false;
      }
      if (rem && rem.success) {
        // The new component was inserted AFTER this span. Removing the old
        // span shifts its final scan key upward, including multiline targets.
        if (rem.file === res.file && rem.removedLine <= res.insertedLine) {
          res = { ...res, insertedLine: res.insertedLine - (rem.removedSource.match(/\n/g)?.length ?? 0) };
        }
        records.push({
          structuralOp: {
            forward: [{ kind: 'remove', loc: removeLoc, allowRootRemoval: true }],
            inverse: [{
              kind: 'restore',
              loc: { file: rem.file, line: rem.removedLine, column: rem.removedColumn ?? 1 },
              text: rem.removedSource,
            }],
          },
        });
        // The note only applies when the two records actually landed on an
        // undo stack — without pushUndo there is nothing to ⌘Z at all.
        // Source/undo publication happens only after the whole batch commits.
      } else {
        throw new Error('Replacement could not be prepared');
      }
    }
    prepared.files = [...dependencies, ...gesture.files.values()];
    const finalResult = res;
    prepared.accepted = () => {
      setLocalPendingSelection(finalResult.file, finalResult.insertedLine, selectionEpoch);
      pushUndo?.({ origin, structuralOp: { sourceFiles: prepared.files, forward: records.flatMap(record => record.structuralOp.forward),
        inverse: [...records].reverse().flatMap(record => record.structuralOp.inverse) } });
    };
    prepared.materialized = () => {
      if (replaceDegraded) toast(`Added ${component.name} — ${replaceDegraded}${matNote}`);
    };
    return { ok: true, file: res.file, insertedLine: res.insertedLine };
  } catch (error) {
    console.error('Component insertion preparation failed:', error);
    return failInsert(error, notSavedReason(error));
  }
}

// ── Gaps 11/36: materialize a library component into the user's project ─────
//
// Production source and public asset bytes come from the validated snapshot;
// development source uses the raw text route. Relative Astro deps are copied
// flattened with import specifiers rewritten. Existing project source wins,
// and its actual references determine missing bundled assets. Asset creates
// preserve original URLs and never replace an existing file. All mutations
// use localFetch so the proxy owns durable sync and uncertain-write barriers.

const MATERIALIZE_READ_FAIL = "could not read your project's components";

const baseName = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

/** Strip frontmatter to the template body (same rule scan-components uses). */
const templateBody = (raw: string): string => raw.replace(/^---[\s\S]*?---\s*/, '').trim();

/** Resolve `./x` / `../x` against the directory of `fromPath` (posix). */
function resolveRelativePath(fromPath: string, spec: string): string | null {
  const parts = fromPath.split('/').slice(0, -1);
  for (const seg of spec.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

/** EVERY import specifier in an .astro frontmatter (default, named, and
 *  side-effect forms). Applied to the frontmatter slice only — template text
 *  must never be rewritten. Matching ALL specs (not just relative ones) is
 *  the guard's teeth: a bare npm specifier that sailed through the copy would
 *  break the user's own dev server with zero starquix messaging (the
 *  task-109 lucide-static class). */
const IMPORT_SPEC_RE = /import\s+[^'"]*?['"]([^'"]+)['"]/g;

export type MaterializeResult =
  | {
      ok: true;
      path: string;
      body: string;
      reused: boolean;
      /** Project-relative paths of files THIS call created (deps first, root
       *  last; reuse can still create missing assets). Surfaced in the insert toast — the structural
       *  undo machinery has no file-delete op, so ⌘Z cannot remove them. */
      created: string[];
    }
  | { ok: false; reason: string };

export async function materializeLibraryComponent(
  component: ScannedComponent | ThemeComponentTemplate,
  projectPath: string,
  collect?: DurableFileChange[],
): Promise<MaterializeResult> {
  const files: DurableFileChange[] = [];
  let result!: MaterializeResult;
  if (collect) {
    result = await planLibraryComponent(component, projectPath, files);
    if (result.ok) collect.push(...files);
  } else {
    try {
      const accepted = await acceptFileChanges(projectPath, async () => {
        result = await planLibraryComponent(component, projectPath, files);
        if (!result.ok) throw new Error(result.reason);
        return files;
      });
      // Resolves at durable acceptance, never on the source ACK (componentProjection
      // law). The component VIEW waits for its route instead: switchLocalComponentView
      // polls /__sq_component_view/<file> through the proxy before moving the iframe.
      void finishAcceptedFiles(accepted);
    }
    catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'Component was not saved' }; }
  }
  return result;
}

async function planLibraryComponent(component: ScannedComponent | ThemeComponentTemplate,
  projectPath: string, collect: DurableFileChange[]): Promise<MaterializeResult> {
  // What the project already has, by basename — collisions reuse these files.
  let existingByBase: Map<string, { path: string; html: string; theme?: string | null; section?: string | null }>;
  try {
    const r = await localFetch(`/__sq/local/scan-components?path=${encodeURIComponent(projectPath)}`);
    if (!r.ok) return { ok: false, reason: `${MATERIALIZE_READ_FAIL} (${r.status})` };
    const list = (await r.json()) as Array<{ path: string; html?: string; theme?: string | null; section?: string | null }>;
    // The runtime scan can lag accepted creates, edits, moves and deletes.
    // Merge by full path before basename collision/reuse resolution, using the
    // same accepted prefix that supplies the eventual file batch's CAS.
    const components = new Map(list.map(c => [c.path, { path: c.path, html: c.html ?? '', theme: c.theme ?? null, section: c.section ?? null }]));
    for (const file of projectedSourceFiles(projectIdForFolder(projectPath))) {
      if (file.encoding || !file.file.startsWith('src/components/') || !file.file.endsWith('.astro')) continue;
      if (file.afterSource === null) components.delete(file.file);
      else components.set(file.file, { path: file.file, html: templateBody(file.afterSource), ...libraryTags(file.afterSource) });
    }
    existingByBase = new Map([...components.values()].map(c => [baseName(c.path), c]));
  } catch {
    return { ok: false, reason: MATERIALIZE_READ_FAIL };
  }

  /** Files created by THIS call, in creation order (deps first). */
  const created: string[] = [];
  const create = async (name: string, astroContent: string): Promise<boolean> => {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return false;
    const file = `src/components/${name}.astro`;
    collect.push({ file, beforeSource: null, afterSource: astroContent });
    created.push(file);
    return true;
  };

  // Theme template: no source file exists anywhere — its markup IS the source.
  if (!('source' in component)) {
    const body = (component.html ?? '').trim();
    if (!body) return { ok: false, reason: `${component.name} has no markup to copy into your project` };
    let name = component.name
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join('')
      .replace(/^[0-9]+/, '');
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
      return { ok: false, reason: `can't derive a component file name from "${component.name}"` };
    }
    const reused = existingByBase.get(`${name}.astro`);
    if (reused) return { ok: true, path: reused.path, body: reused.html, reused: true, created: [] };
    if (!(await create(name, `${body}\n`))) {
      return { ok: false, reason: `could not write ${name}.astro into your project` };
    }
    return { ok: true, path: `src/components/${name}.astro`, body, reused: false, created };
  }

  // Built-in: root reuse preserves the actual user source and reconciles its assets.
  // A themed section reuses only its own copy (same section + theme); another file of
  // that name sends it to `<Name><Theme>.astro` (utils/libraryThemes.ts).
  const rootStem = component.theme
    ? themedComponentFile(component.section ?? fileBase(component.path), component.theme, existingByBase)
    : fileBase(component.path);
  const rootFile = `${rootStem}.astro`;
  const rootReused = existingByBase.get(rootFile);
  if (rootReused) {
    try {
      const assetsCreated = await reconcileProjectComponentAssets(projectPath, rootReused.path, collect);
      return { ok: true, path: rootReused.path, body: rootReused.html, reused: true, created: assetsCreated };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'could not copy component assets' };
    }
  }

  const fetchRaw = async (libPath: string): Promise<string | null> => {
    const pathParts = libPath.split('/');
    if (
      pathParts[0] !== 'library'
      || pathParts.some((part) => part === '' || part === '.' || part === '..')
      || !libPath.endsWith('.astro')
    ) {
      return null;
    }

    if (import.meta.env.PROD) {
      try {
        const snapshot = await loadSnapshot();
        const raw = snapshot[`src/components/${libPath}`];
        return typeof raw === 'string' && raw.length > 0 && !raw.includes('\0') ? raw : null;
      } catch {
        return null;
      }
    }

    try {
      const r = await fetch(`/__sq/component-html?path=${encodeURIComponent(libPath)}&raw=1`);
      if (!r.ok || r.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'text/plain') {
        return null;
      }
      const raw = await r.text();
      return raw.length > 0 && !raw.includes('\0') ? raw : null;
    } catch {
      return null;
    }
  };

  /** Rewrites the frontmatter's relative imports and returns the dep list, or
   *  a refusal when a dependency can't be copied: bare npm specifiers (the
   *  user's project would fail to resolve the package), non-.astro relative
   *  files, and files outside the built-in library (e.g. a page template's
   *  ../../layouts/Layout.astro). `astro`/`astro:*` are allowed — every Astro
   *  project resolves them. */
  const rewriteImports = (
    libPath: string,
    raw: string,
  ): { content: string; deps: string[] } | { reason: string } => {
    const fmMatch = raw.match(/^---[\s\S]*?---/);
    if (!fmMatch) return { content: raw, deps: [] };
    let fm = fmMatch[0];
    const deps: string[] = [];
    for (const m of [...fm.matchAll(IMPORT_SPEC_RE)]) {
      const spec = m[1];
      if (!spec.startsWith('.')) {
        // astro core + its virtual modules ship with every Astro project.
        if (spec === 'astro' || spec.startsWith('astro:')) continue;
        return {
          reason: spec.startsWith('/')
            ? `${component.name} depends on ${spec}, which can't be copied into your project`
            : `${component.name} depends on the npm package "${spec}" — install it in your project first`,
        };
      }
      if (!spec.endsWith('.astro')) {
        return { reason: `${component.name} depends on ${spec}, which can't be copied into your project` };
      }
      const resolved = resolveRelativePath(libPath, spec);
      if (!resolved || !resolved.startsWith('library/')) {
        return { reason: `${component.name} depends on ${spec}, which lives outside the component library` };
      }
      deps.push(resolved);
      const depBase = baseName(resolved);
      // The user's own same-named file (possibly foldered) wins for deps too.
      const depTarget = existingByBase.get(depBase)?.path ?? `src/components/${depBase}`;
      const depSpec = `./${depTarget.replace(/^src\/components\//, '')}`;
      fm = fm.split(`'${spec}'`).join(`'${depSpec}'`).split(`"${spec}"`).join(`"${depSpec}"`);
    }
    return { content: fm + raw.slice(fmMatch[0].length), deps };
  };

  const assetSources: AssetSource[] = [];
  const plannedComponents: Array<{ name: string; content: string }> = [];
  const visited = new Set<string>([component.path]);
  const copyDep = async (libPath: string): Promise<{ ok: true } | { ok: false; reason: string }> => {
    if (visited.has(libPath)) return { ok: true };
    visited.add(libPath);
    const file = baseName(libPath);
    const reused = existingByBase.get(file);
    if (reused) {
      try { assetSources.push(...await readProjectAssetSources(projectPath, reused.path)); }
      catch (error) { return { ok: false, reason: error instanceof Error ? error.message : MATERIALIZE_READ_FAIL }; }
      return { ok: true };
    }
    const raw = await fetchRaw(libPath);
    if (raw === null) return { ok: false, reason: `could not read the built-in source for ${file}` };
    const rewritten = rewriteImports(libPath, raw);
    if ('reason' in rewritten) return { ok: false, reason: rewritten.reason };
    for (const dep of rewritten.deps) {
      const r = await copyDep(dep);
      if (!r.ok) return r;
    }
    assetSources.push({ content: raw, bundled: true });
    plannedComponents.push({ name: file.replace(/\.astro$/, ''), content: rewritten.content });
    return { ok: true };
  };

  const rootRaw = await fetchRaw(component.path);
  if (rootRaw === null) {
    return { ok: false, reason: `could not read the built-in source for ${component.name}` };
  }
  const body = templateBody(rootRaw);
  // Refuse an empty template BEFORE any file lands in the user's project.
  if (body === '') {
    return { ok: false, reason: `${component.name} has no markup — it renders nothing until you add some` };
  }
  const rewrittenRoot = rewriteImports(component.path, rootRaw);
  if ('reason' in rewrittenRoot) return { ok: false, reason: rewrittenRoot.reason };
  for (const dep of rewrittenRoot.deps) {
    const r = await copyDep(dep);
    if (!r.ok) return { ok: false, reason: r.reason };
  }
  assetSources.push({ content: rootRaw, bundled: true });
  try {
    const assets = await planLibraryAssets(assetSources);
    created.push(...await createLibraryAssets(projectPath, assets, collect));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'could not copy component assets' };
  }
  for (const dependency of plannedComponents) {
    if (!(await create(dependency.name, dependency.content))) {
      return { ok: false, reason: `could not write ${dependency.name}.astro into your project` };
    }
  }
  if (!(await create(rootStem, rewrittenRoot.content))) {
    return { ok: false, reason: `could not write ${rootFile} into your project` };
  }
  return { ok: true, path: `src/components/${rootFile}`, body, reused: false, created };
}
