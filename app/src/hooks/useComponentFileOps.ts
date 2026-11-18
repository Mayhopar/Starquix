/**
 * Component FILE operations for the CURRENT runtime — create / rename / delete.
 *
 * The same seam as useFolderManifest: the runtime picks the URL and nothing
 * else, so the Assets panel calls one API and both runtimes get the same UX.
 * Before this existed the panel called app-rooted endpoints directly and simply
 * REFUSED for a local project (`source === 'user-project'`), which is what made
 * the two runtimes look and behave differently.
 *
 * Every call here writes the user's filesystem. Callers pair them with an undo
 * entry; delete returns the previous bytes so that undo can restore the file.
 */
import { useCallback, useMemo } from 'react';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { layoutAstroSource } from '@/utils/astroAssetPaths';
import { localFetch } from '../utils/sqLocalBase';
import { acceptLayoutFileChange, acceptLayoutFileRestore, type LayoutFileSnapshot } from '@/services/durableEdits/layoutFileAcceptance';
import { invertIdentityMaps } from '@/services/durableEdits/sourceIdentity';
import { settleSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { projectIdFromPath } from '@/utils/localMode';
import type { MutationSnapshot } from '@/store/documentMutation';

/**
 * Outcome of a promote/un-promote. A refusal carries the honest reason when
 * one is known (the Assets panel shows it verbatim); `reason` is absent only
 * when the endpoint failed with nothing to report, and the caller falls back
 * to its generic copy. A success can carry a `warning` the panel shows.
 */
export type PromoteResult =
  | { ok: true; path: string; warning?: string }
  | { ok: false; reason?: string };

export interface ComponentFileOps {
  /** Create `<name>.astro`. Returns the new scanned path, or null on failure. */
  create: (name: string, astroContent: string) => Promise<string | null>;
  /** Rename in place. Returns the NEW scanned path (the folder manifest is
   *  keyed by path and must be repointed), or null on failure. */
  rename: (componentPath: string, newName: string) => Promise<string | null>;
  /** Delete. Returns the previous file contents for undo, or null on failure. */
  remove: (componentPath: string) => Promise<string | null>;
  /**
   * task-207 Task 12: move a component into the sq/ folder (promote) or back
   * out. Returns `{ok:true, path}` with the NEW scanned path, or `{ok:false}`
   * with the refusal reason — the name is one of OURS (D2c), something
   * already sits at the destination, or a write failed (in which case the
   * half-landed copy is rolled back so the move is all-or-nothing).
   *
   * Moves the file inside the project's `src/components/sq/`. With no project
   * path there is nothing to move into — refused.
   */
  promote: (componentPath: string, promote: boolean) => Promise<PromoteResult>;
  /**
   * Create `<name>.astro` in the runtime's LAYOUTS root. Returns the scanned
   * path (the shape useLayoutLibrary lists), or null on failure.
   *
   * Files-truth projects accept exact file changes in their project journal;
   * the built-in library outside those projects retains its host writer.
   */
  createLayout: (name: string, astroContent: string, snapshot?: MutationSnapshot) => Promise<string | null>;
  /** Delete by NAME (both endpoints derive `<name>.astro`). Returns the previous
   *  file contents so undo can re-create it, or null on failure. */
  deleteLayout: (name: string, snapshot?: MutationSnapshot) => Promise<string | null>;
  /**
   * task-209 — the user gesture: delete a layout the project's own files
   * import, inlining its whole document into every direct importer so each one
   * keeps rendering on its own, as one accepted project file change.
   * `deleteLayout` above stays the reverse-of-create, where no importer can
   * exist yet.
   *
   * Returns every file's PREVIOUS bytes (the layout included) so one undo can
   * put the whole set back, or `null` on refusal/failure — in which case
   * nothing on disk changed.
   */
  inlineDeleteLayout: (name: string, snapshot?: MutationSnapshot) => Promise<LayoutFileSnapshot[] | null>;
  /** Accept a grouped restore, retaining inverse source identities and refusing
   * if a returned deletion snapshot no longer matches the accepted source. */
  restoreFiles: (files: LayoutFileSnapshot[], snapshot?: MutationSnapshot) => Promise<boolean>;
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    // /__sq/local/* rides the local transport (localFetch); the
    // built-in-library routes stay on the app host.
    const resp = url.startsWith('/__sq/local/') ? await localFetch(url, init) : await fetch(url, init);
    if (!resp.ok) return null;
    return (await resp.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function useComponentFileOps(): ComponentFileOps {
  const localPath = useLocalProjectPath();

  const create = useCallback(async (name: string, astroContent: string) => {
    const r = localPath
      ? await postJson('/__sq/local/component-create', { path: localPath, name, astroContent })
      : await postJson('/__sq/save-component', { name, astroContent, targetDir: 'built-in' });
    if (!r) return null;
    const path = typeof r.path === 'string' ? r.path : `library/${name}.astro`;
    return path;
  }, [localPath]);

  const rename = useCallback(async (componentPath: string, newName: string) => {
    if (localPath) await settleSourceWrites(projectIdFromPath(localPath));
    const r = localPath
      ? await postJson('/__sq/local/component-rename', { path: localPath, componentPath, newName })
      : await postJson('/__sq/rename-component', { componentPath, newName });
    if (!r) return null;
    const nextPath = typeof r.path === 'string' ? r.path : null;
    return nextPath;
  }, [localPath]);

  const remove = useCallback(async (componentPath: string) => {
    if (localPath) await settleSourceWrites(projectIdFromPath(localPath));
    const r = localPath
      ? await postJson('/__sq/local/component-delete', { path: localPath, componentPath })
      : await postJson('/__sq/delete-component', { componentPath });
    if (!r) return null;
    return typeof r.content === 'string' ? r.content : '';
  }, [localPath]);

  const promote = useCallback(async (componentPath: string, promoteIn: boolean): Promise<PromoteResult> => {
    if (!localPath) return { ok: false };
    await settleSourceWrites(projectIdFromPath(localPath));
    const r = await postJson('/__sq/local/component-promote', {
      path: localPath, componentPath, promote: promoteIn,
    });
    // The local endpoint owns its own refusal semantics (409 etc.); no reason
    // text reaches us through postJson, so the caller's generic copy applies.
    return r && typeof r.path === 'string' ? { ok: true, path: r.path } : { ok: false };
  }, [localPath]);

  const createLayout = useCallback(async (name: string, astroContent: string, snapshot?: MutationSnapshot) => {
    if (localPath) {
      try {
        await acceptLayoutFileChange(localPath, { action: 'create', name, astroContent }, snapshot);
        return `src/layouts/${name}.astro`;
      } catch { return null; }
    }
    const r = await postJson('/__sq/save-layout', { name, astroContent });
    if (!r) return null;
    return layoutAstroSource(name);
  }, [localPath]);

  const deleteLayout = useCallback(async (name: string, snapshot?: MutationSnapshot) => {
    if (localPath) {
      try {
        const accepted = await acceptLayoutFileChange(localPath, { action: 'delete', name }, snapshot);
        return accepted.files?.find(file => file.file === `src/layouts/${name}.astro`)?.beforeSource ?? null;
      } catch { return null; }
    }
    const r = await postJson('/__sq/delete-layout', { name });
    if (!r) return null;
    return typeof r.content === 'string' ? r.content : '';
  }, [localPath]);

  const inlineDeleteLayout = useCallback(async (name: string, snapshot?: MutationSnapshot) => {
    if (!localPath) return null;
    try {
      const accepted = await acceptLayoutFileChange(localPath, { action: 'inline-delete', name }, snapshot);
      return (accepted.files ?? []).flatMap(file => file.beforeSource === null ? [] : [{ file: file.file, content: file.beforeSource,
        expectedSource: file.afterSource, ...(file.identityMaps?.length ? { identityMaps: invertIdentityMaps(file.identityMaps) } : {}) }]);
    } catch { return null; }
  }, [localPath]);

  const restoreFiles = useCallback(async (files: LayoutFileSnapshot[], snapshot?: MutationSnapshot) => {
    if (!localPath || files.length === 0) return false;
    try { await acceptLayoutFileRestore(localPath, files, snapshot); return true; }
    catch { return false; }
  }, [localPath]);

  return useMemo(
    () => ({ create, rename, remove, promote, createLayout, deleteLayout, inlineDeleteLayout, restoreFiles }),
    [create, rename, remove, promote, createLayout, deleteLayout, inlineDeleteLayout, restoreFiles],
  );
}
