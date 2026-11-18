import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '../pendingProjectMutations';
import { persistLocalVariablesCss, flushLocalVariablesCss, variablesImportSpecifier, VARIABLES_CSS_FILE } from '../localVariablesCss';
let runtime: ReturnType<typeof projectFsRuntime>;
let path: string;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  const projectId = crypto.randomUUID(); path = `wc://${projectId}`; setActiveSaveProjectId(projectId);
  runtime = projectFsRuntime(projectId, { 'src/layouts/Layout.astro': '<main>One</main>\n', 'src/layouts/Post.astro': '<article>Post</article>\n' });
});
afterEach(() => { runtime.close(); setActiveSaveProjectId(null); vi.unstubAllGlobals(); });
it('computes layout, nested page and sibling stylesheet import paths', () => {
  expect(variablesImportSpecifier('src/layouts/Layout.astro')).toBe('../styles/sq-variables.css');
  expect(variablesImportSpecifier('src/pages/blog/index.astro')).toBe('../../styles/sq-variables.css');
  expect(variablesImportSpecifier('src/styles/other.css')).toBe('./sq-variables.css');
});
it('records every rapid CSS revision immediately and imports each layout exactly once', async () => {
  await Promise.all([persistLocalVariablesCss(path, ':root{--a:1}'), persistLocalVariablesCss(path, ':root{--a:2}')]);
  expect(await db.durableEdits.count()).toBe(2);
  await flushLocalVariablesCss(path);
  expect(runtime.read(VARIABLES_CSS_FILE)).toBe(':root{--a:2}');
  for (const file of ['src/layouts/Layout.astro', 'src/layouts/Post.astro']) expect(runtime.read(file).match(/sq-variables.css/g)).toHaveLength(1);
  await persistLocalVariablesCss(path, ':root{--a:3}'); await flushLocalVariablesCss(path);
  expect(runtime.read(VARIABLES_CSS_FILE)).toBe(':root{--a:3}');
  expect(runtime.read('src/layouts/Post.astro').match(/sq-variables.css/g)).toHaveLength(1);
});
