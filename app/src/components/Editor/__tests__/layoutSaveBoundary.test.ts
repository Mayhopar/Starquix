import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { appendComponentToLayoutSource } from '@/services/durableEdits/layoutAppend';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
let runtime: ReturnType<typeof projectFsRuntime>;
let projectId: string;
const file = 'src/layouts/Host.astro';
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open(); projectId = crypto.randomUUID(); setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [file]: '<main>One</main>\n' }, { loseAcknowledgement: () => true });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('returns acceptance before source work and restores the exact append/import after a lost ACK', async () => {
  await appendComponentToLayoutSource('layouts/Host.astro', 'Card', 'library/Card.astro');
  expect(await db.durableEdits.count()).toBe(1); expect(runtime.read(file)).toBe('<main>One</main>\n');
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWrites(projectId);
  expect(runtime.read(file).match(/<Card/g)).toHaveLength(1); expect(runtime.read(file).match(/import Card/g)).toHaveLength(1);
});
it('rejects the owning gesture before publication when browser storage refuses', async () => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  await expect(appendComponentToLayoutSource('layouts/Host.astro', 'Card', 'library/Card.astro')).rejects.toThrow('quota');
  expect(await db.durableEdits.count()).toBe(0); expect(runtime.read(file)).toBe('<main>One</main>\n');
});
it('refuses a missing layout without accepting an append to an invented source', async () => {
  await expect(appendComponentToLayoutSource('layouts/Missing.astro', 'Card', 'library/Card.astro')).rejects.toThrow('does not exist');
  expect(await db.durableEdits.count()).toBe(0);
});
