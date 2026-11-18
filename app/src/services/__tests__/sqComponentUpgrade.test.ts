// The Stack/Media upgrade on the desktop open: stale copies are upgraded
// through the journaled write, a marked (user-owned) copy is never touched.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = vi.hoisted(() => ({ disk: {} as Record<string, string>, writes: [] as Array<[string, string]>, generation: 0 }));
vi.mock('../pendingProjectMutations', () => ({ getActiveSaveProjectGeneration: () => files.generation }));
vi.mock('@/utils/localElementSource', () => ({
  readLocalFile: vi.fn(async (p: string) => { if (p in files.disk) return files.disk[p]; throw new Error('404'); }),
  writeLocalFile: vi.fn(async (p: string, t: string) => { files.writes.push([p, t]); }),
}));
vi.mock('../snapshotLoader', () => ({
  loadSnapshot: vi.fn(async () => ({ 'src/components/Media.astro': '<!-- sq-media-v2 --> new media', 'src/components/Stack.astro': '<!-- sq-stack-v5 --> new stack' })),
}));

import { upgradeSqComponentsOnOpen } from '../sqComponentUpgrade';
import { loadSnapshot } from '../snapshotLoader';
import { systemComponentPath } from '@/utils/systemComponents';

beforeEach(() => { files.disk = {}; files.writes = []; files.generation = 0; vi.mocked(loadSnapshot).mockClear(); });

describe('upgradeSqComponentsOnOpen', () => {
  it('upgrades a stale copy (keeping a .bak) and leaves a current one alone', async () => {
    files.disk[systemComponentPath('Media')] = 'old media';
    files.disk[systemComponentPath('Stack')] = '<!-- sq-stack-v5 --> my edited stack';
    expect(await upgradeSqComponentsOnOpen()).toEqual([`${systemComponentPath('Media')}.bak`, systemComponentPath('Media')]);
    expect(files.writes).toEqual([[`${systemComponentPath('Media')}.bak`, 'old media'], [systemComponentPath('Media'), '<!-- sq-media-v2 --> new media']]);
  });

  it('a project switch during the open writes nothing (never into the next project)', async () => {
    files.disk[systemComponentPath('Media')] = 'old media';
    vi.mocked(loadSnapshot).mockImplementationOnce(async () => { files.generation++; return { 'src/components/Media.astro': '<!-- sq-media-v2 --> new media' }; });
    expect(await upgradeSqComponentsOnOpen()).toEqual([]);
    expect(files.writes).toEqual([]);
  });

  it('current copies never load the snapshot', async () => {
    files.disk[systemComponentPath('Media')] = '<!-- sq-media-v2 --> mine';
    expect(await upgradeSqComponentsOnOpen()).toEqual([]);
    expect(loadSnapshot).not.toHaveBeenCalled();
  });

  it('a project without our components writes nothing', async () => {
    expect(await upgradeSqComponentsOnOpen()).toEqual([]);
    expect(files.writes).toEqual([]);
  });
});
