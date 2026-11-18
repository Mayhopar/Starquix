/**
 * Our sq/ system components (Stack, Media) ship improvements: on project open
 * a stale copy (no current marker) is upgraded from the shipped template, the
 * old bytes kept as `.bak`. Runs on the desktop open: it reads the instance
 * and writes through the journaled whole-file write, so Dexie and disk agree.
 */
import { loadSnapshot } from './snapshotLoader';
import { getActiveSaveProjectGeneration } from './pendingProjectMutations';
import { readLocalFile, writeLocalFile } from '@/utils/localElementSource';
import { SQ_UPGRADE_MARKERS, staleSqUpgrades, systemComponentPath } from '@/utils/systemComponents';

export async function upgradeSqComponentsOnOpen(): Promise<string[]> {
  // Writes resolve the active project at write time: a switch mid-open must not land A's upgrade in B.
  const generation = getActiveSaveProjectGeneration();
  // Only copies missing their marker can be stale: a current project never loads the snapshot.
  const reads = await Promise.all(Object.entries(SQ_UPGRADE_MARKERS).map(async ([name, marker]) => {
    const path = systemComponentPath(name);
    const text = await readLocalFile(path).catch(() => null);
    return text !== null && !text.includes(marker) ? [path, text] as const : null;
  }));
  const current = Object.fromEntries(reads.filter(r => r !== null));
  if (!Object.keys(current).length) return [];
  const upgrades = staleSqUpgrades(current, await loadSnapshot());
  const written: string[] = [];
  for (const [path, text] of Object.entries(upgrades)) {
    if (getActiveSaveProjectGeneration() !== generation) break;
    await writeLocalFile(path, text);
    written.push(path);
  }
  return written;
}
