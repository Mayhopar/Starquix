/** The project whose runtime currently owns source writes. Writers compare
 * against it so a gesture cannot land in a project the user has left.
 * Persistence itself is the durable journal (services/durableEdits); nothing
 * here tracks pending work or defines a saved/unsaved state. */
import { getFilesTruthSyncStatus } from './filesTruthSync';

let activeProjectId: string | null = null;
let activeProjectGeneration = 0;
export function getActiveSaveProjectId(): string | null { return activeProjectId; }
export function getActiveSaveProjectGeneration(): number { return activeProjectGeneration; }
export function setActiveSaveProjectId(projectId: string | null): void {
  if (projectId !== activeProjectId) activeProjectGeneration++;
  activeProjectId = projectId;
}
/** A new route can mount while the old driver finishes teardown: the old
 * transport keeps write ownership until its journal session is stopped. */
export function setActiveProjectForSave(projectId: string | null): void {
  const owner = getFilesTruthSyncStatus().projectId;
  if (projectId !== null && owner !== null && owner !== projectId) return;
  setActiveSaveProjectId(projectId);
}
