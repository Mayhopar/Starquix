/** Shared folder state is a projection of accepted edits. The journal owns
 * retries and source acknowledgements independently of this mounted panel. */
import { useEffect, useSyncExternalStore } from 'react';
import { useLocalProjectPath } from '@/hooks/useLocalProjectPath';
import { EMPTY_MANIFEST, folderManifestUrls, decodeFolderManifest, type FolderManifest } from '@/store/folderManifest';
import { readJsonResponse } from '@/utils/readJsonResponse';
import type { OperationIssue } from '@/utils/operationIssue';
import { getActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { acceptFolderManifest, readAcceptedFolderManifest } from '@/services/durableEdits/featureAcceptance';
import { getDurableEditStatus, subscribeDurableEditStatus } from '@/services/durableEdits/status';
import { getMaterializationStatus, startMaterializer, subscribeMaterializationStatus } from '@/services/durableEdits/materializer';
import { flushDurableSourceWrites, registerSourceMaterializers } from '@/services/durableEdits/sourceMaterialization';
import { commitMutationSnapshot, type MutationSnapshot } from '@/store/documentMutation';
import { projectIdFromPath } from '@/utils/localMode';

interface Snapshot { manifest: FolderManifest; loaded: boolean; issue: OperationIssue | null; hasPending: boolean; isSaving: boolean }
const failure = () => new Error('Folder changes could not be stored.');
// These owners share accepted display state only. No command or retry payload
// survives here: mounting a fresh owner reconstructs it from durable storage.
const owners = new Map<string, ReturnType<typeof createOwner>>();
function createOwner(localPath: string | null, projectId: string | null) {
  const urls = folderManifestUrls(localPath);
  const listeners = new Set<() => void>();
  let snapshot: Snapshot = { manifest: EMPTY_MANIFEST, loaded: false, issue: null, hasPending: false, isSaving: false };
  let mounts = 0; let accepting = 0; let readEpisode = 0; let issueEpisode = 0; let gesture = 0;
  let stop: (() => void) | undefined;
  // Every accepted edit reloads and every materialization step emits: publish only a real
  // change, or each keystroke anywhere re-renders every subscriber (perf ledger, post-type).
  const emit = (patch: Partial<Snapshot>) => {
    const source = projectId ? getMaterializationStatus(projectId) : null;
    const next = { ...snapshot, ...patch, hasPending: accepting > 0 || !!source && source.acceptedRevision > source.materializedRevision, isSaving: accepting > 0 };
    if (next.manifest !== snapshot.manifest && JSON.stringify(next.manifest) === JSON.stringify(snapshot.manifest)) next.manifest = snapshot.manifest;
    if ((Object.keys(next) as (keyof Snapshot)[]).every(k => next[k] === snapshot[k])) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const issue = (read: boolean): OperationIssue => ({
    code: read ? 'read-unavailable' : 'save-incomplete', operation: 'folder-save', outcome: read ? 'not-applicable' : 'no-write',
    owner: { projectId, entityKey: 'folders', visit: 0 }, episode: ++issueEpisode,
    recover: read ? 'read-again' : 'none', fallbackUsable: snapshot.loaded,
  });
  const reload = () => {
    const episode = ++readEpisode;
    const reading = projectId ? readAcceptedFolderManifest(projectId, localPath)
      : urls.fetch(urls.get).then(response => readJsonResponse(response, decodeFolderManifest));
    void reading.then(manifest => {
      if (episode !== readEpisode) return;
      emit({ manifest: decodeFolderManifest(manifest), loaded: true, issue: null });
    }, () => {
      if (episode !== readEpisode) return;
      emit({ issue: issue(true) });
    });
  };
  const owner = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    mount: () => {
      if (++mounts === 1) {
        if (projectId) {
          let observed = getDurableEditStatus(projectId).acceptedRevision;
          const unsubscribe = subscribeDurableEditStatus(() => {
            const status = getDurableEditStatus(projectId);
            if (status.phase === 'accepted' && status.acceptedRevision > observed) {
              observed = status.acceptedRevision;
              if (!status.layoutNeutral) reload(); // a layout-neutral edit cannot change the manifest
            }
          });
          const unsubscribeSource = subscribeMaterializationStatus(() => emit({}));
          registerSourceMaterializers();
          const stopMaterializer = startMaterializer(projectId);
          stop = () => { unsubscribe(); unsubscribeSource(); stopMaterializer(); };
        }
        reload();
      }
      return () => {
        if (--mounts === 0) {
          stop?.(); stop = undefined; readEpisode++;
          for (const [key, candidate] of owners) if (candidate === owner) owners.delete(key);
        }
      };
    },
    reload,
    retry: async () => { if (projectId) await flushDurableSourceWrites(projectId); reload(); },
    save: async (next: FolderManifest, undoSnapshot?: MutationSnapshot): Promise<void> => {
      const manifest = decodeFolderManifest(structuredClone(next));
      const currentGesture = ++gesture;
      ++accepting; ++readEpisode; emit({});
      try {
        if (projectId) {
          if (getActiveSaveProjectId() !== projectId) throw failure();
          await acceptFolderManifest(projectId, localPath, manifest, undefined, undoSnapshot);
        } else {
          // The built-in library outside an editor has no project journal.
          const response = await urls.fetch(urls.post, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(urls.body(manifest)) });
          if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('application/json')
            || (await response.json()).success !== true) throw failure();
          commitMutationSnapshot(undoSnapshot);
        }
        ++readEpisode;
        emit({ manifest, loaded: true, ...(currentGesture === gesture ? { issue: null } : {}) });
      } catch (error) {
        if (currentGesture === gesture) emit({ issue: issue(false) });
        throw error;
      } finally { --accepting; emit({}); }
    },
  };
  return owner;
}

export function useFolderManifest() {
  const localPath = useLocalProjectPath();
  const projectId = projectIdFromPath(localPath) ?? getActiveSaveProjectId();
  const key = JSON.stringify([projectId, localPath]);
  let owner = owners.get(key);
  if (!owner) { owner = createOwner(localPath, projectId); owners.set(key, owner); }
  const snapshot = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  useEffect(() => owner.mount(), [owner]);
  return { ...snapshot, save: owner.save, reload: owner.reload, retry: owner.retry };
}
