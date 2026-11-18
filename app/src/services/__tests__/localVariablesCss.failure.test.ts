import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { persistLocalVariablesCss, flushLocalVariablesCss, hasUnsavedLocalVariablesCss, observeLocalVariablesSetup } from '../localVariablesCss';
let runtime: ReturnType<typeof projectFsRuntime>;
let path: string;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = crypto.randomUUID(); path = `wc://${projectId}`; setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main>One</main>\n' });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('refuses storage without accepting CSS or publishing a setup/save error', async () => {
  const events: unknown[] = []; observeLocalVariablesSetup(path, event => events.push(event))();
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  await expect(persistLocalVariablesCss(path, 'rejected')).rejects.toThrow('quota');
  expect(await db.durableEdits.count()).toBe(0); expect(await db.durableCommandReceipts.count()).toBe(0);
  expect(runtime.read('src/pages/index.astro')).toBe('<main>One</main>\n');
  expect(hasUnsavedLocalVariablesCss()).toBe(false); expect(events).toEqual([{ type: 'settled' }]);
});
it('restores accepted CSS and the home-page import after database and runtime reopen', async () => {
  await persistLocalVariablesCss(path, ':root{--color:red}');
  db.close(); await db.open(); runtime.restart(); await flushLocalVariablesCss(path);
  expect(runtime.read('src/styles/sq-variables.css')).toBe(':root{--color:red}');
  expect(runtime.read('src/pages/index.astro')).toContain("import '../styles/sq-variables.css'");
});
