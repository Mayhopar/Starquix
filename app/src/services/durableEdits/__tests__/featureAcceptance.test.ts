import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth } from '@/utils/localMode';
import { dispatchDurableAction } from '@/store/durableDispatch';
import { acceptPostWrite, readAcceptedPost, acceptVariablesCss, acceptFolderManifest, readAcceptedFolderManifest } from '../featureAcceptance';
import { captureLocalWriteOrigin } from '@/utils/localWriteScope';
import { acceptFileChanges } from '../fileAcceptance';
import { setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';
import { flushDurableSourceWrites } from '../sourceMaterialization';
import { acceptProjectEdit } from '../acceptance';
import { resolveProjectedSourceLocation, sourceVersion } from '../sourceIdentity';
const file = 'src/content/posts/hello.md';
const original = '---\r\ntitle: Old # retain\r\ncustom: untouched\r\n---\r\nOld\r\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let doc: Y.Doc;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_feature_accept_${crypto.randomUUID()}`; setActiveSaveProjectId(projectId); markFilesTruth(projectId);
  runtime = projectFsRuntime(projectId, { [file]: original, 'src/layouts/Base.astro': '<main>One</main>\n' });
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
});
afterEach(() => { runtime.close(); doc.destroy(); setActiveSaveProjectId(null); setLocalExpectedRoute(null); setLocalPageFile(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('accepts successive post edits against projected bytes and restores them before the source writer runs', async () => {
  await acceptPostWrite(projectId, 'posts', 'hello', { title: 'New', custom: 'untouched' }, 'Old\r\n', { baseline: { frontmatter: { title: 'Old', custom: 'untouched' }, body: 'Old\r\n' } });
  await acceptPostWrite(projectId, 'posts', 'hello', { title: 'New', custom: 'untouched' }, 'New body\r\n', { baseline: { frontmatter: { title: 'New', custom: 'untouched' }, body: 'Old\r\n' } });
  expect(await db.durableEdits.count()).toBe(2); expect(runtime.read(file)).toBe(original);
  db.close(); await db.open();
  expect(await readAcceptedPost(projectId, 'posts', 'hello')).toMatchObject({ body: 'New body\r\n', frontmatter: { title: 'New' } });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('---\r\ntitle: "New" # retain\r\ncustom: untouched\r\n---\r\nNew body\r\n');
});
it('commits variables CSS and import intent in the same revision as the document gesture', async () => {
  await dispatchDurableAction(doc, { type: 'ADD_VARIABLE_COLLECTION', collection: { id: 'colors', name: 'Colors', modes: [], variables: [] } });
  const rows = await db.durableEdits.toArray();
  expect(rows).toHaveLength(1);
  expect(rows[0].commands).toEqual([expect.objectContaining({ kind: 'variables-css' })]);
  expect(runtime.read('src/layouts/Base.astro')).toBe('<main>One</main>\n');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/layouts/Base.astro')).toContain("import '../styles/sq-variables.css'");
});
it('does not publish variables or commands if the storage transaction refuses', async () => {
  vi.spyOn(db.durableEditCheckpoints, 'add').mockRejectedValue(new Error('quota'));
  await expect(dispatchDurableAction(doc, { type: 'ADD_VARIABLE_COLLECTION', collection: { id: 'colors', name: 'Colors', modes: [], variables: [] } })).rejects.toThrow('quota');
  expect(doc.getMap('variableCollections').size).toBe(0); expect(await db.durableEdits.count()).toBe(0);
  expect(runtime.read('src/layouts/Base.astro')).toBe('<main>One</main>\n');
});
it('freezes layout import and append identities before source dispatch', async () => {
  await acceptProjectEdit(doc, { projectId, operationId: 'append', mutate: () => {}, commands: [{ kind: 'layout-append', payload: {
    pageFile: 'src/layouts/Base.astro', markup: '  <Card />', importName: 'Card', importPath: '../components/Card.astro',
  } }] });
  const location = await resolveProjectedSourceLocation(projectId, { file: 'src/layouts/Base.astro', line: 1, column: 1, sourceVersion: sourceVersion('<main>One</main>\n') });
  expect(location.line).toBe(4);
  expect(await db.durableCommandReceipts.count()).toBe(0);
  const row = (await db.durableEdits.toArray())[0];
  expect(row.commands[0].payload).toHaveProperty('preparedFiles');
});

it('composes class, layout append, and variables imports in the same gesture and identity chain', async () => {
  const source = '<main>One</main>\n';
  await acceptProjectEdit(doc, { projectId, operationId: 'mixed', mutate: staged => {
    staged.getMap('variableCollections').set('colors', new Y.Map());
  }, commands: [
    { kind: 'class-write', payload: { sourceLocation: { file: 'src/layouts/Base.astro', line: 1, column: 1, sourceVersion: sourceVersion(source) }, newClasses: 'block', baseClasses: null, origin: null } },
    { kind: 'layout-append', payload: { pageFile: 'src/layouts/Base.astro', markup: '<Card />' } },
  ] });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/layouts/Base.astro')).toContain('<main class="block">One</main>');
  expect(runtime.read('src/layouts/Base.astro')).toContain('<Card />');
  expect(runtime.read('src/layouts/Base.astro')).toContain("import '../styles/sq-variables.css'");
});

it('rejects a captured cross-surface layout append before acceptance', async () => {
  setLocalExpectedRoute('/'); setLocalPageFile('src/pages/index.astro');
  await expect(acceptProjectEdit(doc, { projectId, operationId: 'cross-surface', mutate: () => {}, commands: [
    { kind: 'layout-append', payload: { pageFile: 'src/layouts/Base.astro', markup: '<Card />', origin: captureLocalWriteOrigin() } },
  ] })).rejects.toThrow('surface');
  expect(await db.durableEdits.count()).toBe(0);
});

it('rejects variables and folder intents with a mismatched captured project', async () => {
  await expect(acceptVariablesCss(projectId, 'wc://another-project', 'new')).rejects.toThrow('project');
  await expect(acceptFolderManifest(projectId, 'wc://another-project', { version: 1, roots: [], folders: {} })).rejects.toThrow('project');
  expect(await db.durableEdits.count()).toBe(0);
});

it('preserves layout element correspondence across CRLF import and append splices', async () => {
  const source = '<body>\r\n  <h1>Title</h1>\r\n  <p>Tail</p>\r\n</body>\r\n<footer>Outside body</footer>\r\n';
  runtime.close(); runtime = projectFsRuntime(projectId, { 'src/layouts/Base.astro': source });
  await acceptProjectEdit(doc, { projectId, operationId: 'crlf-layout', mutate: () => {}, commands: [
    { kind: 'layout-append', payload: { pageFile: 'src/layouts/Base.astro', markup: '<Card />', importName: 'Card', importPath: '../components/Card.astro' } },
  ] });
  const location = await resolveProjectedSourceLocation(projectId, { file: 'src/layouts/Base.astro', line: 3, column: 3, sourceVersion: sourceVersion(source) });
  expect(location).toMatchObject({ line: 6, column: 3 });
  const footer = await resolveProjectedSourceLocation(projectId, { file: 'src/layouts/Base.astro', line: 5, column: 1, sourceVersion: sourceVersion(source) });
  expect(footer).toMatchObject({ line: 9, column: 1 });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/layouts/Base.astro').replace(/\r\n/g, '')).not.toContain('\n');
});
// Agent multiplayer (owner 2026-11-08, ledger B3/B8/C3): bytes an outside writer
// put on disk after the edit was accepted are newer — on reopen the accepted
// post and folders show them, and the queue moves on instead of blocking.
it('reopens the accepted post and folders as a newer outside rewrite left them, and the queue moves on', async () => {
  const manifest = { version: 1 as const, roots: ['f_one'], folders: { f_one: { name: 'One', children: [] } } };
  const empty = '{"version":1,"roots":[],"folders":{}}';
  await acceptPostWrite(projectId, 'posts', 'hello', { title: 'Accepted', custom: 'untouched' }, 'Accepted body');
  await acceptFolderManifest(projectId, `wc://${projectId}`, manifest);
  runtime.close(); runtime = projectFsRuntime(projectId, { [file]: 'External post', '.starquix/folders.json': empty });
  db.close(); await db.open();
  expect((await readAcceptedPost(projectId, 'posts', 'hello')).body).toBe('External post');
  expect(await readAcceptedFolderManifest(projectId, `wc://${projectId}`)).toEqual(JSON.parse(empty));
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('External post');
  expect(runtime.read('.starquix/folders.json')).toBe(empty);
});
it.each(['{"version":2,"roots":[],"folders":{}}', '{"version":1,"roots":[],"folders":{"f_one":{"name":"One"}}}'])('does not turn malformed stored folder structure into an editable empty manifest: %s', async malformed => {
  runtime.close(); runtime = projectFsRuntime(projectId, { '.starquix/folders.json': malformed });
  await expect(readAcceptedFolderManifest(projectId, `wc://${projectId}`)).rejects.toThrow('manifest');
  expect(await db.durableEdits.count()).toBe(0);
});
it('imports variables into an accepted new home page before that page exists in source', async () => {
  runtime.close(); runtime = projectFsRuntime(projectId, {});
  await acceptFileChanges(`wc://${projectId}`, [{ file: 'src/pages/index.astro', beforeSource: null, afterSource: '<main>Home</main>\n' }]);
  await acceptVariablesCss(projectId, `wc://${projectId}`, ':root {}');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/pages/index.astro')).toContain("import '../styles/sq-variables.css'");
});
// task-268: a site with no layout imported the variables file into Home alone —
// every other page of the BUILT site had no variables (the canvas injects them).
it('imports variables into EVERY page of a site with no layout', async () => {
  runtime.close(); runtime = projectFsRuntime(projectId, { 'src/pages/index.astro': '<main>Home</main>\n', 'src/pages/pricing.astro': '<main>Pricing</main>\n', 'src/pages/blog/[slug].astro': '<main>Post</main>\n' });
  await acceptVariablesCss(projectId, `wc://${projectId}`, ':root {}');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/pages/index.astro')).toContain("import '../styles/sq-variables.css'");
  expect(runtime.read('src/pages/pricing.astro')).toContain("import '../styles/sq-variables.css'");
  expect(runtime.read('src/pages/blog/[slug].astro')).toContain("import '../../styles/sq-variables.css'");
});
it('keeps the variables import in the layouts when the site has any: its pages are not touched', async () => {
  runtime.close(); runtime = projectFsRuntime(projectId, { 'src/layouts/Base.astro': '<main>One</main>\n', 'src/pages/index.astro': '<main>Home</main>\n' });
  await acceptVariablesCss(projectId, `wc://${projectId}`, ':root {}');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read('src/layouts/Base.astro')).toContain("import '../styles/sq-variables.css'");
  expect(runtime.read('src/pages/index.astro')).toBe('<main>Home</main>\n');
});
it('editorial layouts D10: a post write with <Stack> and no import gains OUR import (update + create)', async () => {
  const row = '<Stack direction="row">\n<div>\n\nA\n\n</div>\n<div>\n\nB\n\n</div>\n</Stack>\n';
  const imp = "import Stack from '../../components/sq/Stack.astro';";
  runtime.close(); runtime = projectFsRuntime(projectId, { 'src/content/posts/lay.mdx': '---\ntitle: L\n---\nOld\n' });
  await acceptPostWrite(projectId, 'posts', 'lay', { title: 'L' }, row);
  expect((await readAcceptedPost(projectId, 'posts', 'lay')).body).toBe(`${imp}\n\n${row}`);
  const { acceptPostFileChange } = await import('../postCrudAcceptance');
  await acceptPostFileChange(`wc://${projectId}`, 'posts', { action: 'create', slug: 'fresh', frontmatter: { title: 'F' }, body: row });
  expect((await readAcceptedPost(projectId, 'posts', 'fresh')).body).toBe(`${imp}\n\n${row}`);
});
