import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { persistLocalVariablesCss, flushLocalVariablesCss, resumeLocalVariablesCss } from '../localVariablesCss';
import { viteStructuralWriter } from '../ViteStructuralWriter';
let runtime: ReturnType<typeof projectFsRuntime>;
let path: string;
let writes: number;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = crypto.randomUUID(); path = `wc://${projectId}`; setActiveSaveProjectId(projectId); writes = 0;
  runtime = projectFsRuntime(projectId, { 'src/layouts/Layout.astro': '<main>One</main>\n' }, {
    beforeCommand: async () => { writes++; }, loseAcknowledgement: () => true,
  });
  viteStructuralWriter.setIframeRef(null); viteStructuralWriter.setLocalInstanceState(null);
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });
it('accepts and materializes variables without an iframe or preview startup', async () => {
  await persistLocalVariablesCss(path, ':root{}'); expect(await db.durableEdits.count()).toBe(1);
  await flushLocalVariablesCss(path); expect(writes).toBe(1);
  expect(runtime.read('src/layouts/Layout.astro')).toContain('sq-variables.css');
});
it('readiness edges and reload reconcile the same lost acknowledgement without duplicate imports', async () => {
  await persistLocalVariablesCss(path, ':root{}'); await flushLocalVariablesCss(path);
  await resumeLocalVariablesCss(path, () => true); await resumeLocalVariablesCss(path, () => false);
  runtime.restart(); db.close(); await db.open(); await flushLocalVariablesCss(path);
  expect(writes).toBe(1); expect(runtime.read('src/layouts/Layout.astro').match(/sq-variables.css/g)).toHaveLength(1);
});
