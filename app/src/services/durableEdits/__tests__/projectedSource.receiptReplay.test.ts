import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { markFilesTruth } from '@/utils/localMode';
import { setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';
import { acceptProjectEdit, inspectAcceptedProject } from '../acceptance';
import { readProjectedSourceState, withProjectedSource } from '../projectedSource';
import { flushDurableSourceWrites } from '../sourceMaterialization';
import { prepareSourceCommand } from '../commandReceipts';

const file = 'src/layouts/Base.astro';
const original = '<main>Original</main>\n';
let projectId: string;
let doc: Y.Doc;
let runtime: ReturnType<typeof projectFsRuntime>;

beforeEach(async () => {
  vi.stubGlobal('crypto', webcrypto); await db.delete(); await db.open();
  projectId = `browser_receipt_projection_${crypto.randomUUID()}`;
  markFilesTruth(projectId); setActiveSaveProjectId(projectId);
  doc = new Y.Doc(); doc.getMap('meta').set('projectId', projectId);
  runtime = projectFsRuntime(projectId, { [file]: original });
  await acceptProjectEdit(doc, { projectId, operationId: 'append', mutate: () => {},
    commands: [{ kind: 'layout-append', payload: { pageFile: file, markup: '<Card />' } }],
  });
  await acceptProjectEdit(doc, { projectId, operationId: 'undo', mutate: () => {}, commands: [
    { kind: 'receipt-replay', payload: { commandIds: [JSON.stringify(['append', 0])], direction: 'before' } },
  ] });
});

afterEach(() => {
  runtime.close(); doc.destroy(); setActiveSaveProjectId(null);
  setLocalExpectedRoute(null); setLocalPageFile(null); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const readAcceptedLayout = () => inspectAcceptedProject(projectId,
  revision => withProjectedSource(projectId, revision, () => readProjectedSourceState(projectId, file)));

it('reads an accepted undo before the original layout command has dispatched', async () => {
  expect(runtime.read(file)).toBe(original);
  expect(await readAcceptedLayout()).toBe(original);
  expect(runtime.read(file)).toBe(original);
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(original);
});

// Agent multiplayer (owner 2026-11-08, ledger B3/C3): bytes written after the
// edit and its undo were accepted are newer — both yield, nothing blocks.
it('lets newer outside bytes win over an accepted edit and its undo, without blocking', async () => {
  runtime.close(); runtime = projectFsRuntime(projectId, { [file]: '<main>External</main>\n' });
  db.close(); await db.open();
  expect(await readAcceptedLayout()).toBe('<main>External</main>\n');
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('<main>External</main>\n');
  expect(await db.durableEdits.count()).toBe(2);
});

it('does not let a cached read-projection preparation bypass the original writer receipt', async () => {
  await readAcceptedLayout();
  const replay = { kind: 'receipt-replay' as const, payload: { commandIds: [JSON.stringify(['append', 0])], direction: 'before' as const } };
  await expect(prepareSourceCommand(projectId, JSON.stringify(['undo', 0]), replay)).rejects.toThrow('Original source command has no complete receipt');
  expect(runtime.read(file)).toBe(original);
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(original);
});
