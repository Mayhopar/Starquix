/**
 * THE local-mode write-scope law (data-loss incident 2026-08-02).
 *
 * In normal (WC) Starquix, editing an INSTANCE never mutates the master
 * component: instance-scope edits live as doc overlays (classOverrides /
 * childOverrides, task-070/077/118) and the component's own file changes only
 * when the MASTER is edited (component editor) or an explicit push happens.
 *
 * Local mode is files-truth — there are no overlays — and a page renders its
 * components INLINE, so every scanned element inside `<Header />` carries
 * `src/components/Header.astro` as its `sourceLocation.file`. Before this
 * module, every local write path resolved its target from that location and
 * edited the component file directly. Real consequence: the owner selected the
 * rendered header on a page and pressed Delete; `Header.astro` lost its whole
 * template body and `Back.astro` went to 0 bytes — the component destroyed for
 * every page, from an instance-level gesture, with no git to recover from.
 *
 * THE LAW: **from a page view, a write must never target a file other than the
 * current page file.** The "current surface file" is Editor's `currentPageFile`
 * (utils/localPageSync `setLocalPageFile`), which already resolves to the
 * COMPONENT's own file while the task-136/137 component view
 * (`/__sq_component_view/…`) is open — so master edits made there are
 * same-file and proceed unchanged. That component view is the sanctioned
 * escape hatch, and the refusal toast points at it.
 *
 * This module is the ONE place the rule is expressed. It is enforced at the
 * ONE choke point every local file write passes through
 * (`BaseViteWriter.sendRequest`, backstop for class/text/image/tag-swap/
 * structural alike) and re-checked early by the structural entry points purely
 * so their refusal copy can be specific.
 */

import { getLocalExpectedRoute, getLocalPageFile, getLocalScreenPageFile } from './localPageSync';

export type LocalWriteScope = 'same-file' | 'cross-file';

/**
 * The scope inputs as they stood WHEN A GESTURE WAS MADE — for the writes that
 * do not happen immediately (task-181).
 *
 * The class queue defers its file write by 5 s
 * (context/hooks/useClassPersistenceQueue.ts), and {@link isLocalCrossFileWrite}
 * reads the CURRENT surface. So a write judged cross-file at the moment the user
 * changed the colour is re-judged against wherever they happen to be 5 s later —
 * and the component view makes the component file the surface. Measured live
 * 2026-08-05: change an instance's background on a page, open the master within
 * 5 s, and the deferred write lands in the master `.astro`, no Push, no consent
 * (`src/components/DynCard.astro` rewritten from `class={'…bg-slate-100'}` to
 * `class="…bg-red-950"`). That is the owner report "when I change instance bg
 * and go to master, background also changes without pushing to the master".
 *
 * THE RULE: **a deferred write carries the scope decision of the surface it was
 * made on.** Capture at gesture time, re-classify at flush time. `armed` is the
 * same local-mode signal {@link isLocalCrossFileWrite} gates on, captured too:
 * Editor drops `expectedRoute` on unmount, so a flush racing teardown would
 * otherwise find the guard disarmed and write the master on the way out.
 *
 * This does NOT replace the choke-point check in `BaseViteWriter.sendRequest`;
 * it is an additional, strictly narrowing gate in front of it.
 */
export interface LocalWriteOrigin {
  /** Was local mode armed when the gesture happened? */
  armed: boolean;
  /** The surface file at gesture time (Editor's currentPageFile). */
  pageFile: string | null;
}

/** Snapshot the scope inputs. Call at gesture time, never at flush time. */
export function captureLocalWriteOrigin(): LocalWriteOrigin {
  return { armed: getLocalExpectedRoute() !== null, pageFile: getLocalPageFile() };
}

/** An edit of an element on screen: its page is the page whose elements are
 *  shown (the one being left while a switch is pending). */
export function captureLocalElementOrigin(): LocalWriteOrigin {
  return { armed: getLocalExpectedRoute() !== null, pageFile: getLocalScreenPageFile() };
}

/**
 * Would this write have been cross-file WHERE IT WAS MADE? A missing origin
 * (a caller that never captured one) reports `false` — inert, so every
 * immediate write path keeps its current behavior unchanged.
 */
export function isCrossFileAtOrigin(
  origin: LocalWriteOrigin | undefined,
  file: string | null | undefined,
): boolean {
  if (!origin?.armed) return false; // not local mode at gesture time → disarmed
  return classifyLocalWriteTarget(file, origin.pageFile) === 'cross-file';
}

/**
 * THE scope rule. `pageFile` defaults to the Editor-armed surface file; the
 * insert/draw paths already carry their own and pass it explicitly.
 *
 * An unknown surface file (boot, doc-only page, non-local runtime) classifies
 * as 'cross-file' — default-deny; never assume same-file. Callers that must
 * stay inert on non-local runtimes use {@link isLocalCrossFileWrite}, which
 * consults the local-mode arming signal first.
 */
export function classifyLocalWriteTarget(
  file: string | null | undefined,
  pageFile: string | null = getLocalPageFile(),
): LocalWriteScope {
  return pageFile !== null && !!file && file === pageFile ? 'same-file' : 'cross-file';
}

/**
 * Armed form of the rule, for the shared write choke point.
 *
 * `expectedRoute` is armed by Editor ONLY in local mode (it is derived from
 * currentPagePath, which is null off the local runtime), so WC / server
 * writes are byte-identical: the guard reports `false` and never
 * inspects anything else. Inside local mode an unknown surface file still
 * default-denies.
 */
export function isLocalCrossFileWrite(file: string | null | undefined): boolean {
  if (getLocalExpectedRoute() === null) return false; // not local mode → disarmed
  return classifyLocalWriteTarget(file) === 'cross-file';
}

/**
 * Is this surface a MASTER view? The component view arms the component/layout
 * file itself as the surface (`src/layouts/…` / `src/components/…`); a page
 * view arms a `src/pages/…` file. ponytail: prefix test — a local project
 * with a custom srcDir pages root would misclassify; revisit if one exists.
 */
export function isLocalMasterSurface(pageFile: string | null | undefined): boolean {
  return !!pageFile && !pageFile.startsWith('src/pages/');
}

/**
 * May an OVERRIDE-TIER write (classes / text / image attrs) cross into another
 * component's own file? Yes — exactly when the gesture was made on a MASTER
 * surface: styling a nested instance inside an open layout/component master is
 * a deliberate master edit, and the usage tag cannot carry it (Astro drops
 * `class` on a component tag unless the component spreads it — verified
 * 2026-08-27, the "made Back fixed in the layout master, nothing propagated"
 * report: the value died in the session doc, which local pages never read).
 * Structural ops are NOT relaxed: their meaning on a placement root is the
 * USAGE tag (task-148), and relaxing them would gut definitions from a Delete
 * (the 2026-08-02 incident class). Page surfaces stay strict for everything.
 *
 * With an origin (deferred write), judged at gesture time; without one
 * (immediate writers), judged on the current surface.
 */
export function allowsCrossFileOverrideWrite(origin?: LocalWriteOrigin, targetFile?: string): boolean {
  const pageFile = origin ? (origin.armed ? origin.pageFile : null) : getLocalPageFile();
  // Both ends must be masters: a page file is never written from a master
  // surface (the rule is symmetric — BaseViteWriter.crossFileScope.test.ts).
  return isLocalMasterSurface(pageFile) && (targetFile === undefined || isLocalMasterSurface(targetFile));
}

/** `src/components/Header.astro` → `Header.astro` (user-facing copy only). */
export function localFileLabel(file: string): string {
  return file.split('/').pop() || file;
}

/**
 * Refusal copy. Three jobs: name the file (so the user knows WHAT was
 * protected), say plainly that nothing was written (a class/text edit has
 * already repainted the canvas optimistically — the task-142 rule is never to
 * let the canvas silently show an unsaved change), and give the route out (the
 * component view), because the intent was "change this here" and a bare "not
 * allowed" is a dead end.
 */
export function localCrossFileRefusal(file: string): string {
  return `${localFileLabel(file)} is a component — this change wasn't saved. Open it to edit for every page.`;
}

/** Same sentence as a tool-result reason (AI paths have no toast surface). */
export function localCrossFileReason(file: string): string {
  return `${file} is a shared component, not the page being edited — open it in the component view to change it for every page`;
}

/**
 * Emitted on every refusal. The toast itself carries an "Open" action, so it
 * has to be rendered in the UI layer (Editor's useLocalCrossFileToast); this
 * module stays pure/React-free so the services layer can import it without a
 * layering inversion.
 */
export const LOCAL_CROSS_FILE_WRITE_EVENT = 'sq:local-cross-file-write';

export interface LocalCrossFileWriteDetail {
  file: string;
}

export function notifyLocalCrossFileWrite(file: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<LocalCrossFileWriteDetail>(LOCAL_CROSS_FILE_WRITE_EVENT, { detail: { file } }),
  );
}
