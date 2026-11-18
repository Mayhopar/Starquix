import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setServerWriteMode } from '@/services/serverWriteMode';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { ensureVariablesImport, _resetLocalVariablesCss } from '@/services/localVariablesCss';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalPageFile, setLocalScannedRoute } from '@/utils/localPageSync';
import { getDurableProjectState } from '../store';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { acceptStructuralOperations } from '../structuralAcceptance';

const file = 'src/layouts/Layout.astro';
const original = '<html><body><slot /></body></html>\n';
let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, frame: HTMLIFrameElement;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `variables-master-${crypto.randomUUID()}`; setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { [file]: original, 'src/pages/index.astro': '<main />\n' });
  setLocalExpectedRoute('/'); setLocalPageFile('src/pages/index.astro'); setLocalScannedRoute('/');
  frame = document.createElement('iframe'); document.body.append(frame);
  setServerWriteMode(true); viteStructuralWriter.setLocalInstanceState({ status: 'running', url: 'https://instance.test' }); viteStructuralWriter.setIframeRef(frame);
});
afterEach(async () => {
  await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  runtime.close(); frame.remove(); setServerWriteMode(false); viteStructuralWriter.setIframeRef(null); viteStructuralWriter.setLocalInstanceState(null);
  setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); _resetLocalVariablesCss(); vi.unstubAllGlobals();
});

it('lets project-wide variables link their discovered layout through the real scoped writer', async () => {
  await expect(ensureVariablesImport(`wc://${projectId}`)).resolves.toEqual([file]);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1 });
  await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe("---\nimport '../styles/sq-variables.css';\n---\n<html><body><slot /></body></html>\n");
});

it('keeps ordinary cross-file imports denied', async () => {
  await expect(viteStructuralWriter.writeImport(file, '', '../styles/sq-variables.css')).rejects.toThrow(/another surface/);
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(original);
});

it('does not let the explicit import authorization grant a cross-file element edit', async () => {
  await expect(acceptStructuralOperations([{ kind: 'remove', loc: { file, line: 1, column: 1 }, allowRootRemoval: true }], { masterWrite: true })).rejects.toThrow(/another surface/);
  expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read(file)).toBe(original);
});
