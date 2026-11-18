import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { viteStructuralWriter } from '@/services/ViteStructuralWriter';
import { _resetLocalPageSyncForTests, setLocalExpectedRoute, setLocalPageFile, setLocalScannedRoute } from '@/utils/localPageSync';
import { acceptProjectEdit } from '../acceptance';
import { getDurableProjectState } from '../store';
import { sourceVersion } from '../sourceIdentity';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { prepareSourceCommand } from '../commandReceipts';

const file = 'src/pages/index.astro';
const scanned = '<main>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
const external = '<main>\n  <p>Injected</p>\n  <p>One</p>\n  <p>Two</p>\n</main>\n';
let projectId: string, doc: Y.Doc, runtime: ReturnType<typeof projectFsRuntime>;
beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `version-owner-${crypto.randomUUID()}`;
  setActiveSaveProjectId(projectId); setLocalExpectedRoute('/'); setLocalPageFile(file); setLocalScannedRoute('/');
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
});
afterEach(async () => {
  await flushDurableSourceWritesThrough(projectId, (await getDurableProjectState(projectId)).acceptedRevision);
  runtime.close(); doc.destroy(); setActiveSaveProjectId(null); _resetLocalPageSyncForTests(); vi.unstubAllGlobals();
});

it.each(['structural', 'class'] as const)('rejects the first %s target from an external unowned source version', async kind => {
  runtime = projectFsRuntime(projectId, { [file]: external });
  const loc = { file, line: 3, column: 3, sourceVersion: sourceVersion(scanned), sourceRevision: 0 };
  const edit = kind === 'structural' ? viteStructuralWriter.writeRemove(loc)
    : acceptProjectEdit(doc, { projectId, operationId: 'class', mutate: staged => staged.getMap('meta').set('edited', true), commands: [{ kind: 'class-write', payload: { sourceLocation: loc, newClasses: 'chosen', baseClasses: '' } }] });
  await expect(edit).rejects.toThrow(/source.*version/i);
  expect(await db.durableEdits.count()).toBe(0);
  expect(await db.durableCommandReceipts.count()).toBe(0);
  expect(doc.getMap('meta').has('edited')).toBe(false);
  expect(runtime.read(file)).toBe(external);
});

it.each(['structural', 'class'] as const)('does not let a document-only revision vouch an unowned %s source version', async kind => {
  runtime = projectFsRuntime(projectId, { [file]: external });
  await acceptProjectEdit(doc, { projectId, operationId: 'doc-only', mutate() {}, commands: [] });
  const loc = { file, line: 3, column: 3, sourceVersion: sourceVersion(scanned), sourceRevision: 1 };
  const edit = kind === 'structural' ? viteStructuralWriter.writeRemove(loc)
    : acceptProjectEdit(doc, { projectId, operationId: 'class', mutate() {}, commands: [{ kind: 'class-write', payload: { sourceLocation: loc, newClasses: 'chosen', baseClasses: '' } }] });
  await expect(edit).rejects.toThrow(/source.*version/i);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1 });
  expect(runtime.read(file)).toBe(external);
});

it.each(['structural', 'class'] as const)('does not treat start<0 as proof of the current %s source version', async kind => {
  runtime = projectFsRuntime(projectId, { [file]: scanned });
  await viteStructuralWriter.writeImport(file, '', '../styles/sq-variables.css');
  await flushDurableSourceWritesThrough(projectId, 1);
  const baseline = runtime.read(file);
  const loc = { file, line: 5, column: 3, sourceVersion: sourceVersion(scanned), sourceRevision: 1 };
  const edit = kind === 'structural' ? viteStructuralWriter.writeRemove(loc)
    : acceptProjectEdit(doc, { projectId, operationId: 'class', mutate() {}, commands: [{ kind: 'class-write', payload: { sourceLocation: loc, newClasses: 'chosen', baseClasses: '' } }] });
  await expect(edit).rejects.toThrow(/source.*version/i);
  expect(await getDurableProjectState(projectId)).toMatchObject({ acceptedRevision: 1 });
  expect(runtime.read(file)).toBe(baseline);
});

it.each(['structural', 'class'] as const)('refuses legacy %s preparation before writing a receipt for unowned bytes', async kind => {
  runtime = projectFsRuntime(projectId, { [file]: external });
  const loc = { file, line: 3, column: 3, sourceVersion: sourceVersion(scanned), sourceRevision: 0 };
  const command = kind === 'structural'
    ? { kind: 'structural-write' as const, payload: { operations: [{ kind: 'remove' as const, loc }], masterWrite: false } }
    : { kind: 'class-write' as const, payload: { sourceLocation: loc, newClasses: 'chosen', baseClasses: '' } };
  await expect(prepareSourceCommand(projectId, 'legacy-command', command)).rejects.toThrow(/source.*version/i);
  expect(await db.durableCommandReceipts.count()).toBe(0);
  expect(runtime.read(file)).toBe(external);
});

it.each(['structural', 'class'] as const)('accepts the first %s edit when its owned version matches the exact baseline', async kind => {
  runtime = projectFsRuntime(projectId, { [file]: scanned });
  const loc = { file, line: 3, column: 3, sourceVersion: sourceVersion(scanned), sourceRevision: 0 };
  if (kind === 'structural') await viteStructuralWriter.writeRemove(loc);
  else await acceptProjectEdit(doc, { projectId, operationId: 'class', mutate() {}, commands: [{ kind: 'class-write', payload: { sourceLocation: loc, newClasses: 'chosen', baseClasses: '' } }] });
  await flushDurableSourceWritesThrough(projectId, 1);
  expect(runtime.read(file)).toBe(kind === 'structural' ? '<main>\n  <p>One</p>\n</main>\n' : '<main>\n  <p>One</p>\n  <p class="chosen">Two</p>\n</main>\n');
});
