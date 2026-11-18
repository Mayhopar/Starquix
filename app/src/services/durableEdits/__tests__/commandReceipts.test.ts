// @vitest-environment node
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from '@/db';
import { setLocalTransport } from '@/utils/sqLocalBase';
import { registerProjectFsRoutes, createChangeJournal } from '../../../../../preview-template/src/plugins/sq-project-fs-routes.js';
import { prepareSourceCommand, dispatchSourceCommand, reconcileSourceCommand } from '../commandReceipts';
import { acceptProjectEdit, probeDurableEditStorage } from '../acceptance';
import { acceptStructuralOperations } from '../structuralAcceptance';
import * as store from '../store';
import { setLocalExpectedRoute, setLocalPageFile, _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import type { MaterializationCommand } from '../types';
import { createLocalDocPage, deleteLocalDocPage, restoreLocalPageFile } from '@/store/localPages';
import { moveLocalPageFile, renameLocalDocPage } from '@/utils/localPageSync';
import { applyCommand } from '@/store/commands';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { contentOps, setLocalContentSource } from '@/core/collections/content-ops';
import { acceptStructuralReplay } from '../structuralReplayAcceptance';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { localPageId } from '@/utils/localMode';
import { retryAcceptedFiles } from '../fileAcceptance';

let projectId: string;
const file = 'src/pages/index.astro';
const before = '<main class="p-2"><h1>Title</h1></main>\n';
const after = '<main class="p-4"><h1>Title</h1></main>\n';
type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
let root: string;
let journal: ReturnType<typeof createChangeJournal>;
let routes: Map<string, Handler>;
let lostAck: boolean;
let applies: number;

function bindRuntime() {
  journal = createChangeJournal();
  routes = new Map();
  registerProjectFsRoutes({ middlewares: { use: (route: string, handler: Handler) => routes.set(route, handler) } } as never,
    { resolveRoot: () => root, sqComponentsDir: '', journal });
  setLocalTransport({ projectPath: `wc://${projectId}`, fetch: async (url, init) => {
    const response = await request(url, init);
    if (url.split('?')[0] === '/__sq/local/source-command') {
      applies++;
      if (lostAck) { lostAck = false; throw new Error('ACK lost after write'); }
    }
    return response;
  } });
}
async function request(url: string, init?: RequestInit): Promise<Response> {
  const route = routes.get(url.split('?')[0]);
  if (!route) return new Response('missing route', { status: 404 });
  return new Promise((resolve, reject) => {
    const headers = new Map<string, string>();
    const req = Readable.from(init?.body ? [init.body] : []) as IncomingMessage;
    Object.assign(req, { method: init?.method ?? 'GET', url, headers: {} });
    const res = {
      statusCode: 200,
      setHeader(key: string, value: string) { headers.set(key, value); },
      writeHead(status: number, incoming: Record<string, string>) {
        this.statusCode = status;
        for (const [key, value] of Object.entries(incoming)) headers.set(key, value);
      },
      end(body?: string | Uint8Array) { resolve(new Response(body, { status: this.statusCode, headers: [...headers] })); },
    };
    try { route(req, res as unknown as ServerResponse, () => reject(new Error('No handler'))); }
    catch (error) { reject(error); }
  });
}
function command(classes = 'p-4'): Extract<MaterializationCommand, { kind: 'class-write' }> {
  return { kind: 'class-write', payload: {
    sourceLocation: { file, line: 1, column: 1 }, newClasses: classes,
    baseClasses: 'p-2', origin: { armed: true, pageFile: file },
  } };
}

beforeEach(async () => {
  await db.delete(); await db.open();
  projectId = `browser_receipts_${crypto.randomUUID()}`;
  root = mkdtempSync(join(tmpdir(), 'sq-command-receipts-'));
  mkdirSync(join(root, 'src/pages'), { recursive: true });
  writeFileSync(join(root, file), before);
  lostAck = false; applies = 0; bindRuntime();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setLocalContentSource(null); _resetLocalPageSyncForTests(); rmSync(root, { recursive: true, force: true }); });

it.each(['delete', 'rename'] as const)('prepares %s after the preceding accepted class edit, before debounce', async owner => {
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  setActiveSaveProjectId(projectId);
  const target = 'src/pages/about.astro'; writeFileSync(join(root, target), before);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: localPageId('/'), name: '/', children: [], rootElementIds: [] } });
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: localPageId('/about'), name: '/about', children: [], rootElementIds: [] } });
  const c = command(); c.payload.deferUntil = Date.now() + 60_000;
  c.payload.sourceLocation.file = target; c.payload.origin = { armed: true, pageFile: target };
  await acceptProjectEdit(doc, { projectId, operationId: 'class-first', commands: [c], mutate: () => {} });
  expect(readFileSync(join(root, file), 'utf8')).toBe(before);
  const undo: unknown[] = [];
  if (owner === 'delete') {
    await deleteLocalDocPage(doc, `wc://${projectId}`, localPageId('/about'), record => { undo.push(record); });
    await flushDurableSourceWritesThrough(projectId, 2);
    expect(existsSync(join(root, target))).toBe(false);
    expect(JSON.stringify(undo)).toContain('p-4');
  } else {
    await renameLocalDocPage(doc, `wc://${projectId}`, localPageId('/about'), 'renamed');
    await flushDurableSourceWritesThrough(projectId, 2);
    expect(readFileSync(join(root, 'src/pages/renamed.astro'), 'utf8')).toBe(after);
  }
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 2 });
  doc.destroy(); setActiveSaveProjectId(null);
});

it('retains page deletion acceptance and its inverse when source conflicts after commit', async () => {
  const target = 'src/pages/about.astro'; writeFileSync(join(root, target), before);
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  for (const route of ['/', '/about']) applyCommand(doc, { type: 'ADD_PAGE', page: { id: localPageId(route), name: route, children: [], rootElementIds: [] } });
  const save = store.acceptStoredEdit;
  vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => {
    const accepted = await save(input); writeFileSync(join(root, target), '<main>External edit</main>'); return accepted;
  });
  const inverse: unknown[] = [];
  await expect(deleteLocalDocPage(doc, `wc://${projectId}`, localPageId('/about'), record => { inverse.push(record); })).resolves.toBeUndefined();
  expect(doc.getMap('pages').has(localPageId('/about'))).toBe(false);
  expect(inverse).toHaveLength(1);
  expect(readFileSync(join(root, target), 'utf8')).toBe('<main>External edit</main>');
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 0 });
  const [row] = await db.durableEdits.toArray();
  writeFileSync(join(root, target), before);
  // Retry reconciles the accepted operation, not a new delete gesture.
  expect(await retryAcceptedFiles({ projectId, operationId: row.operationId, revision: row.revision })).toMatchObject({ status: 'materialized' });
  await vi.waitFor(async () => expect((await store.getDurableProjectState(projectId)).materializedRevision).toBe(1));
  expect(await db.durableEdits.count()).toBe(1);
  expect(existsSync(join(root, target))).toBe(false); doc.destroy();
});

it('receipt replay preserves proven absence across multiple commands on the same new file', async () => {
  const target = 'src/components/Card.astro';
  for (const [id, beforeSource, afterSource] of [['create', null, '<Card />'], ['change', '<Card />', '<Card>Final</Card>']] as const) {
    await prepareSourceCommand(projectId, id, { kind: 'file-batch', payload: { files: [{ file: target, beforeSource, afterSource }] } });
    await dispatchSourceCommand(projectId, id);
  }
  await prepareSourceCommand(projectId, 'undo', { kind: 'receipt-replay', payload: { commandIds: ['create', 'change'], direction: 'before' } });
  await dispatchSourceCommand(projectId, 'undo');
  expect(existsSync(join(root, target))).toBe(false);
  await prepareSourceCommand(projectId, 'redo', { kind: 'receipt-replay', payload: { commandIds: ['create', 'change'], direction: 'after' } });
  await dispatchSourceCommand(projectId, 'redo');
  expect(readFileSync(join(root, target), 'utf8')).toBe('<Card>Final</Card>');
});

it('completes an accepted structural revision despite a later queued rejection', async () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  const original = store.acceptStoredEdit;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => {
    entered(); await gate; return original(input);
  }).mockRejectedValueOnce(new Error('later quota'));
  const first = acceptStructuralOperations([
    { kind: 'insert', loc: { file, line: 1, column: 1 }, position: 'inside-end', markup: '<p>Accepted</p>' },
  ], { doc }).then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  await started;
  const later = acceptProjectEdit(doc, { projectId, operationId: 'later-rejected', commands: [], mutate: () => {} })
    .then(() => undefined, error => error);
  release();
  expect(await later).toEqual(new Error('later quota'));
  const completed = await first;
  expect(completed.error).toBeUndefined();
  expect(completed.value).toHaveLength(1);
  await flushDurableSourceWritesThrough(projectId, 1);
  expect(readFileSync(join(root, file), 'utf8')).toContain('<p>Accepted</p>');
  expect(applies).toBe(1);
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
  doc.destroy();
});

it('persists exact preparation before dispatch and preserves the existing partial-literal transform', async () => {
  const source = "<main class={'p-2 ' + variant}>Title</main>\n";
  writeFileSync(join(root, file), source);
  const c = command('p-4 flex'); c.payload.baseClasses = 'p-2 flex';
  const prepared = await prepareSourceCommand(projectId, 'op:0', c);
  expect(prepared).toMatchObject({ projectId, commandId: 'op:0', file, beforeSource: source,
    afterSource: "<main class={'p-4 ' + variant}>Title</main>\n", skipped: [] });
  expect(readFileSync(join(root, file), 'utf8')).toBe(source);
  expect(journal.since(0).entries).toEqual([]);
  await db.close(); await db.open();
  expect(await db.durableCommandReceipts.get([projectId, 'op:0'])).toMatchObject({ prepared, outcome: null });
});

it('rejects reused command IDs with changed intent and retains the original preparation', async () => {
  const original = await prepareSourceCommand(projectId, 'same', command());
  await expect(prepareSourceCommand(projectId, 'same', command('p-8'))).rejects.toThrow(/identity|intent/i);
  expect((await db.durableCommandReceipts.get([projectId, 'same']))?.prepared).toEqual(original);
});

it('does not dispatch when durable preparation is rejected', async () => {
  const reject = () => { throw new Error('IndexedDB quota'); };
  db.durableCommandReceipts.hook('creating', reject);
  try { await expect(prepareSourceCommand(projectId, 'quota', command())).rejects.toThrow(/quota/); }
  finally { db.durableCommandReceipts.hook('creating').unsubscribe(reject); }
  await expect(dispatchSourceCommand(projectId, 'quota')).rejects.toThrow(/prepar/i);
  expect(applies).toBe(0); expect(readFileSync(join(root, file), 'utf8')).toBe(before);
});

it('applies prepared bytes, journals before acknowledgement, and commits a command receipt', async () => {
  await prepareSourceCommand(projectId, 'op', command());
  expect(await dispatchSourceCommand(projectId, 'op')).toMatchObject({ status: 'written' });
  expect(readFileSync(join(root, file), 'utf8')).toBe(after);
  expect(journal.since(0).entries).toEqual([{ seq: 1, file, kind: 'change' }]);
  expect((await db.durableCommandReceipts.get([projectId, 'op']))?.outcome).toMatchObject({ status: 'written' });
});

it('recovers a lost acknowledgement from exact source bytes without redispatch', async () => {
  await prepareSourceCommand(projectId, 'lost', command()); lostAck = true;
  expect(await dispatchSourceCommand(projectId, 'lost')).toMatchObject({ status: 'written' });
  expect(applies).toBe(1);
  expect(readFileSync(join(root, file), 'utf8')).toBe(after);
});

it('prepares a structural insert once and reconciles a lost acknowledgement without inserting twice', async () => {
  const c: MaterializationCommand = { kind: 'structural-write', payload: { operations: [
    { kind: 'insert', loc: { file, line: 1, column: 1 }, position: 'inside-end', markup: '<p>New</p>' },
  ] } };
  const prepared = await prepareSourceCommand(projectId, 'structural', c);
  expect(prepared.afterSource).toContain('<p>New</p>');
  expect(readFileSync(join(root, file), 'utf8')).toBe(before);
  lostAck = true;
  expect(await dispatchSourceCommand(projectId, 'structural')).toMatchObject({ status: 'written' });
  expect(await reconcileSourceCommand(projectId, 'structural')).toMatchObject({ status: 'written' });
  expect(applies).toBe(1);
  expect(readFileSync(join(root, file), 'utf8').match(/<p>New<\/p>/g)).toHaveLength(1);
});

it('reconciles after database and runtime restart without replaying the transformation', async () => {
  const prepared = await prepareSourceCommand(projectId, 'restart', command());
  // The process dies after applying but before the browser receives/persists the receipt.
  const response = await request('/__sq/local/source-command', { method: 'POST', body: JSON.stringify(prepared) });
  expect(response.ok).toBe(true);
  await db.close(); await db.open(); bindRuntime();
  expect(await reconcileSourceCommand(projectId, 'restart')).toMatchObject({ status: 'written' });
  expect(journal.since(0).entries).toEqual([]); expect(applies).toBe(0);
});

it('retains exact skipped selectors across restart and never dispatches a known partial again', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await prepareSourceCommand(projectId, 'partial', { kind: 'source-batch', payload: {
    payloads: [{ astroSource: file, overrides: { classOverrides: { 'main-0': 'p-4', 'h2-0': 'text-lg' } } }], skipped: [],
  } });
  const outcome = await dispatchSourceCommand(projectId, 'partial');
  expect(outcome).toMatchObject({ status: 'partial', skipped: [
    { source: file, category: 'classes', selector: 'h2-0', reason: 'unresolved' },
  ] });
  expect(readFileSync(join(root, file), 'utf8')).toBe(after);
  await db.close(); await db.open(); bindRuntime();
  expect(await dispatchSourceCommand(projectId, 'partial')).toEqual(outcome);
  expect(applies).toBe(1);
  expect((await db.durableCommandReceipts.get([projectId, 'partial']))?.outcome).toEqual(outcome);
  expect(warn).toHaveBeenCalledOnce();
});

it('refuses to overwrite intervening source changes and retains an unknown outcome', async () => {
  await prepareSourceCommand(projectId, 'conflict', command());
  writeFileSync(join(root, file), '<main>External edit</main>');
  expect(await dispatchSourceCommand(projectId, 'conflict')).toMatchObject({ status: 'unknown' });
  expect(readFileSync(join(root, file), 'utf8')).toBe('<main>External edit</main>');
  expect(journal.since(0).entries).toEqual([]);
});

it('concurrent commands sharing an old baseline cannot both succeed', async () => {
  const a = await prepareSourceCommand(projectId, 'a', command('p-4'));
  const b = await prepareSourceCommand(projectId, 'b', command('p-8'));
  const responses = await Promise.all([a, b].map(prepared => request('/__sq/local/source-command', {
    method: 'POST', body: JSON.stringify(prepared),
  }).then(response => response.json())));
  expect(responses.map(r => r.status).sort()).toEqual(['unknown', 'written']);
  expect(journal.since(0).entries).toHaveLength(1);
});

it('preserves gesture-time instance scope and refuses multi-file preparation', async () => {
  const instance = command(); instance.payload.origin = { armed: true, pageFile: 'src/pages/other.astro' };
  await expect(prepareSourceCommand(projectId, 'instance', instance)).rejects.toThrow(/scope|instance/i);
  await expect(prepareSourceCommand(projectId, 'multi', { kind: 'source-batch', payload: {
    payloads: [{ astroSource: file, overrides: {} }, { astroSource: 'src/pages/other.astro', overrides: {} }], skipped: [],
  } })).rejects.toThrow(/one|single/i);
  expect(await db.durableCommandReceipts.count()).toBe(0);
});

it('storage readiness probes the command receipt table before enabling edits', async () => {
  const reject = () => { throw new Error('Receipt storage unavailable'); };
  db.durableCommandReceipts.hook('creating', reject);
  try { await expect(probeDurableEditStorage()).rejects.toThrow(/Receipt storage/); }
  finally { db.durableCommandReceipts.hook('creating').unsubscribe(reject); }
});

it('commits verified bytes and the receipt atomically, recovering a failed file-store commit', async () => {
  await prepareSourceCommand(projectId, 'file-quota', command());
  const reject = () => { throw new Error('File storage quota'); };
  db.projectFiles.hook('creating', reject);
  try { await expect(dispatchSourceCommand(projectId, 'file-quota')).rejects.toThrow(/quota/); }
  finally { db.projectFiles.hook('creating').unsubscribe(reject); }
  expect((await db.durableCommandReceipts.get([projectId, 'file-quota']))?.outcome).toMatchObject({ status: 'not-written' });
  expect(await db.projectFiles.count()).toBe(0);
  expect(readFileSync(join(root, file), 'utf8')).toBe(after);
  expect(await reconcileSourceCommand(projectId, 'file-quota')).toMatchObject({ status: 'written' });
  const persisted = await db.projectFiles.get(`${projectId}:${file}`);
  expect(new TextDecoder().decode(persisted!.content)).toBe(after);
  expect(applies).toBe(1);
});

it('a missing captured origin still obeys the existing current-surface scope check', async () => {
  setLocalExpectedRoute('/other'); setLocalPageFile('src/pages/other.astro');
  const c = command(); c.payload.origin = null;
  await expect(prepareSourceCommand(projectId, 'missing-origin', c)).rejects.toThrow(/scope|instance/i);
  expect(readFileSync(join(root, file), 'utf8')).toBe(before);
  expect(await db.durableCommandReceipts.count()).toBe(0);
});

it('conditionally creates and deletes files across a lost ACK and runtime restart', async () => {
  const target = 'src/pages/about/index.astro';
  const c = { kind: 'file-batch', payload: { files: [
    { file, beforeSource: before, afterSource: null },
    { file: target, beforeSource: null, afterSource: before },
  ] } } as MaterializationCommand;
  await prepareSourceCommand(projectId, 'rename', c as never);
  expect(existsSync(join(root, file))).toBe(true);
  expect(existsSync(join(root, target))).toBe(false);
  lostAck = true;
  expect(await dispatchSourceCommand(projectId, 'rename')).toMatchObject({ status: 'written' });
  expect(existsSync(join(root, file))).toBe(false);
  expect(readFileSync(join(root, target), 'utf8')).toBe(before);
  expect(await db.projectFiles.get(`${projectId}:${file}`)).toBeUndefined();
  expect(new TextDecoder().decode((await db.projectFiles.get(`${projectId}:${target}`))!.content)).toBe(before);
  await db.close(); await db.open(); bindRuntime();
  expect(await dispatchSourceCommand(projectId, 'rename')).toMatchObject({ status: 'written' });
  expect(applies).toBe(1);
  expect(journal.since(0).entries).toEqual([]);
});

it('refuses an intervening creation before deleting any member of a file batch', async () => {
  const target = 'src/pages/about.astro';
  await prepareSourceCommand(projectId, 'rename-conflict', { kind: 'file-batch', payload: { files: [
    { file, beforeSource: before, afterSource: null },
    { file: target, beforeSource: null, afterSource: before },
  ] } } as never);
  writeFileSync(join(root, target), 'External content');
  expect(await dispatchSourceCommand(projectId, 'rename-conflict')).toMatchObject({ status: 'unknown' });
  expect(readFileSync(join(root, file), 'utf8')).toBe(before);
  expect(readFileSync(join(root, target), 'utf8')).toBe('External content');
  expect(applies).toBe(0);
});

it('commits binary bundled assets and source in one exact replayable receipt', async () => {
  const assetFile = 'public/assets/card.png';
  const bytes = new Uint8Array([137, 80, 0, 255, 1]);
  const encoded = Buffer.from(bytes).toString('base64');
  await prepareSourceCommand(projectId, 'binary-batch', { kind: 'file-batch', payload: { files: [
    { file, beforeSource: before, afterSource: '<img src="/assets/card.png" />' },
    { file: assetFile, encoding: 'base64', beforeSource: null, afterSource: encoded },
  ] } } as never);
  lostAck = true;
  expect(await dispatchSourceCommand(projectId, 'binary-batch')).toMatchObject({ status: 'written' });
  expect(new Uint8Array(readFileSync(join(root, assetFile)))).toEqual(bytes);
  expect(new Uint8Array((await db.projectFiles.get(`${projectId}:${assetFile}`))!.content)).toEqual(bytes);
  await db.close(); await db.open(); bindRuntime();
  expect(await dispatchSourceCommand(projectId, 'binary-batch')).toMatchObject({ status: 'written' });
  expect(applies).toBe(1);
});

it('never overwrites a file a create believed absent: the existing file stays and the queue moves on (ledger B8)', async () => {
  const prepared = await prepareSourceCommand(projectId, 'create-conflict', { kind: 'file-batch', payload: { files: [
    { file, beforeSource: null, afterSource: 'replacement' },
  ] } } as never);
  expect(prepared.files?.[0]).toMatchObject({ file, beforeSource: before, afterSource: before });
  expect(await dispatchSourceCommand(projectId, 'create-conflict')).toMatchObject({ status: 'written' });
  expect(readFileSync(join(root, file), 'utf8')).toBe(before);
});

it.each(['create', 'delete', 'rename', 'move', 'restore'] as const)('rejects local page %s before changing source or the live document', async kind => {
  setActiveSaveProjectId(projectId);
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', children: [], rootElementIds: [] } });
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'about', name: '/about', children: [], rootElementIds: [] } });
  writeFileSync(join(root, 'src/pages/about.astro'), before);
  const baseline = doc.toJSON();
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('owner quota'));
  const action = () => kind === 'create' ? createLocalDocPage(doc, `wc://${projectId}`, 'Contact')
    : kind === 'delete' ? deleteLocalDocPage(doc, `wc://${projectId}`, 'about')
    : kind === 'rename' ? renameLocalDocPage(doc, `wc://${projectId}`, 'about', 'Contact')
    : kind === 'move' ? moveLocalPageFile(`wc://${projectId}`, 'src/pages/about.astro', 'src/pages/contact.astro')
    : restoreLocalPageFile(`wc://${projectId}`, '/contact', before);
  await expect(action()).rejects.toThrow('owner quota');
  expect(doc.toJSON()).toEqual(baseline);
  expect(existsSync(join(root, 'src/pages/contact.astro'))).toBe(false);
  expect(readFileSync(join(root, 'src/pages/about.astro'), 'utf8')).toBe(before);
  expect(journal.since(0).entries).toEqual([]);
  expect(await db.durableEdits.count()).toBe(0);
  doc.destroy();
});

it('rejects dynamic post-page deletion before deleting its content file or document row', async () => {
  setLocalContentSource(`wc://${projectId}`);
  vi.stubGlobal('window', { dispatchEvent: () => true });
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', children: [], rootElementIds: [] } });
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'works-first', name: '/works/first', children: [], rootElementIds: [] } });
  mkdirSync(join(root, 'src/content/works'), { recursive: true });
  const post = 'src/content/works/First.mdx'; writeFileSync(join(root, post), '---\ntitle: First\n---\nBody');
  vi.spyOn(contentOps, 'fetchCollections').mockResolvedValue([
    { name: 'works', posts: [{ slug: 'First', frontmatter: {}, body: 'Body' }], inferredFields: [] },
  ] as never);
  vi.spyOn(store, 'acceptStoredEdit').mockRejectedValue(new Error('post quota'));
  await expect(deleteLocalDocPage(doc, `wc://${projectId}`, 'works-first')).rejects.toThrow('post quota');
  expect(doc.getMap('pages').has('works-first')).toBe(true);
  expect(readFileSync(join(root, post), 'utf8')).toContain('Body');
  expect(journal.since(0).entries).toEqual([]);
});

it('accepts mixed span plus page move replay once and reverses it byte-exactly through receipts', async () => {
  const doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  const target = 'src/pages/archive/index.astro';
  const forward = await acceptStructuralReplay(doc, [
    { kind: 'restore-region', loc: { file, line: 1, column: 1 }, lineCount: 1, segment: '<main>Changed</main>\n' },
    { kind: 'page-move', folder: `wc://${projectId}`, from: file, to: target },
  ]);
  await flushDurableSourceWritesThrough(projectId, forward.revision);
  expect(readFileSync(join(root, target), 'utf8')).toBe('<main>Changed</main>\n');
  expect(existsSync(join(root, file))).toBe(false);
  const inverse = await acceptStructuralReplay(doc, [
    { kind: 'page-move', folder: `wc://${projectId}`, from: target, to: file },
    { kind: 'restore-region', loc: { file, line: 1, column: 1 }, lineCount: 1, segment: before },
  ]);
  await flushDurableSourceWritesThrough(projectId, inverse.revision);
  expect(readFileSync(join(root, file), 'utf8')).toBe(before);
  expect(existsSync(join(root, target))).toBe(false);
  expect(await store.getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 2, materializedRevision: 2 });
  expect((await db.durableCommandReceipts.toArray()).every(row => row.outcome?.status === 'written')).toBe(true);
});
