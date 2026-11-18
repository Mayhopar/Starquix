import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { markFilesTruth } from '@/utils/localMode';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { readAcceptedFolderManifest } from '@/services/durableEdits/featureAcceptance';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { generateCommandTools } from '../commandTools';
import { makeCtx, type ExecTool } from './testCtx';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';

const file = '.starquix/folders.json';
const original = '{"version":1,"roots":[],"folders":{}}';
let projectId: string; let doc: Y.Doc; let runtime: ReturnType<typeof projectFsRuntime>; let tool: ExecTool;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = crypto.randomUUID(); markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [file]: original });
  const library = ['Hero', 'Footer'].map(name => ({ name, path: `src/components/${name}.astro`, category: '', html: '<div/>' } as ScannedComponent));
  tool = generateCommandTools(makeCtx({ doc, componentLibrary: library })).set_component_category as ExecTool;
});
afterEach(() => { runtime.close(); doc.destroy(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('accepts concurrent tool folder moves against preceding accepted organization without source dispatch', async () => {
  const results = await Promise.all(['Hero', 'Footer'].map(componentPath => tool.execute({ componentPath, category: 'Marketing pages' })));
  expect(results.every(result => result.success)).toBe(true); expect(await db.durableEdits.count()).toBe(2);
  expect(runtime.read(file)).toBe(original);
  db.close(); await db.open();
  const manifest = await readAcceptedFolderManifest(projectId, `wc://${projectId}`);
  expect(Object.values(manifest.folders).find(folder => folder.name === 'Marketing pages')?.children).toEqual(['comp:src/components/Hero.astro', 'comp:src/components/Footer.astro']);
  await flushDurableSourceWrites(projectId); expect(runtime.read(file)).toContain('Marketing pages');
});
it('does not claim tool success or change source if acceptance storage refuses', async () => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  expect(await tool.execute({ componentPath: 'Hero', category: 'Marketing pages' })).toMatchObject({ success: false, message: expect.stringContaining('quota') });
  expect(runtime.read(file)).toBe(original); expect(await db.durableEdits.count()).toBe(0);
});
