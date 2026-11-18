import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { acceptProjectEdit } from '../acceptance';
import { getDurableProjectState } from '../store';
import { flushDurableSourceWrites, registerSourceMaterializers } from '../sourceMaterialization';
import { materializerRegistry } from '../registry';
import { createMaterializer } from '../materializer';
import * as store from '../store';
import type { MaterializationCommand } from '../types';

let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let doc: Y.Doc;
let dispatches: number;
const layout = 'src/layouts/Base.astro';
const css = 'src/styles/sq-variables.css';
const post = 'src/content/posts/hello.mdx';
const folders = '.starquix/folders.json';
const original = '<main>One</main>\n';
const manifest = { version: 1 as const, roots: ['f_one'], folders: { f_one: { name: 'One', children: [] } } };
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto);
  await db.delete(); await db.open();
  projectId = `browser_features_${crypto.randomUUID()}`; setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId); dispatches = 0;
  runtime = projectFsRuntime(projectId, { [layout]: original, [css]: 'old', [post]: '---\ntitle: Old\n---\nOld\n', [folders]: '{}' }, {
    beforeCommand: async () => { dispatches++; expect(await db.durableEdits.count()).toBe(1); },
    loseAcknowledgement: () => true,
  });
});
afterEach(async () => { runtime.close(); doc.destroy(); setActiveSaveProjectId(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(kind: 'layout-append' | 'variables-css' | 'post-write' | 'folder-manifest') {
  const file = kind === 'layout-append' ? layout : kind === 'variables-css' ? css : kind === 'post-write' ? post : folders;
  const beforeSource = runtime.read(file);
  const afterSource = kind === 'layout-append' ? '<main>One</main>\n  <Card />\n' : kind === 'variables-css' ? ':root { --color: red; }\n'
    : kind === 'post-write' ? '---\ntitle: New\n---\nNew\n' : JSON.stringify(manifest, null, 2) + '\n';
  const preparedFiles = [{ file, beforeSource, afterSource }];
  const command = kind === 'layout-append' ? { kind, payload: { pageFile: layout, markup: '  <Card />' } }
    : kind === 'variables-css' ? { kind, payload: { projectPath: `wc://${projectId}`, file, css: afterSource, imports: [], preparedFiles } }
    : kind === 'post-write' ? { kind, payload: { collection: 'posts', slug: 'hello', frontmatter: { title: 'New' }, body: 'New\n', expectedSource: beforeSource, preparedFiles } }
    : { kind, payload: { localPath: `wc://${projectId}`, manifest, preparedFiles } };
  return { file, beforeSource, afterSource, command: command as MaterializationCommand };
}

it.each(['layout-append', 'variables-css', 'post-write', 'folder-manifest'] as const)('%s resumes accepted intent after database/runtime reopen and reconciles a lost ACK exactly once', async kind => {
  const { file, beforeSource, afterSource, command } = fixture(kind);
  const input = { projectId, operationId: 'feature', commands: [command], mutate: () => {} };
  const accepted = await acceptProjectEdit(doc, input);
  expect(accepted.revision).toBe(1); expect(dispatches).toBe(0); expect(runtime.read(file)).toBe(beforeSource);
  runtime.restart(); db.close(); await db.open();
  expect(await acceptProjectEdit(doc, input)).toEqual(accepted);
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(afterSource); expect(dispatches).toBe(1);
  runtime.restart(); db.close(); await db.open(); await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(afterSource); expect(dispatches).toBe(1);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
});

// Agent multiplayer (owner 2026-11-08, ledger B3): an outside writer that rewrote
// the whole file is newer than the waiting edit — nothing of the edit finds its
// place, the file keeps the outside bytes and the queue moves on (no issue).
it.each(['layout-append', 'variables-css', 'post-write', 'folder-manifest'] as const)('%s yields to a newer outside rewrite that landed after its preparation', async kind => {
  const { file, command } = fixture(kind);
  await acceptProjectEdit(doc, { projectId, operationId: 'conflict', commands: [command], mutate: () => {} });
  // Force original preparation before an external edit, including layout append.
  const { prepareSourceCommand } = await import('../commandReceipts');
  await prepareSourceCommand(projectId, JSON.stringify(['conflict', 0]), command as Parameters<typeof prepareSourceCommand>[2]);
  writeFileSync(join(runtime.root, file), 'external');
  registerSourceMaterializers();
  const worker = createMaterializer({ store, registry: materializerRegistry, scheduleRetry: () => () => {} });
  const stop = worker.startMaterializer(projectId);
  await worker.runOnce(projectId);
  expect(worker.getStatus(projectId).issue).toBeNull();
  stop();
  expect(runtime.read(file)).toBe('external'); expect(dispatches).toBe(0);
  expect(await db.durableEdits.count()).toBe(1);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
});

it.each(['layout-append', 'variables-css', 'post-write', 'folder-manifest'] as const)('%s yields to a newer outside rewrite that landed before its first preparation', async kind => {
  const { file, command } = fixture(kind);
  await acceptProjectEdit(doc, { projectId, operationId: 'refusal', commands: [command], mutate: () => {} });
  writeFileSync(join(runtime.root, file), 'external');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('external'); expect(dispatches).toBe(0);
  expect(await db.durableEdits.count()).toBe(1);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1, materializedRevision: 1 });
});
