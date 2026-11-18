import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { acceptFileChanges } from '../fileAcceptance';
import { flushDurableSourceWritesThrough } from '../sourceMaterialization';
import { readProjectedSourceState, withProjectedSource } from '../projectedSource';

let projectId: string, runtime: ReturnType<typeof projectFsRuntime>, releaseWrite: (() => void) | undefined;
let writeGate: Promise<void>;
const file = 'src/pages/index.astro';
beforeEach(async () => {
  await db.delete(); await db.open(); projectId = `projection-race-${crypto.randomUUID()}`; writeGate = Promise.resolve();
  runtime = projectFsRuntime(projectId, { [file]: '<main>Original</main>\n' }, { beforeCommand: () => writeGate });
});
afterEach(() => { releaseWrite?.(); vi.restoreAllMocks(); runtime.close(); });

it('reads the accepted bytes whether the row materialized during projection or not', async () => {
  const first = await acceptFileChanges(`wc://${projectId}`, [{ file, beforeSource: '<main>Original</main>\n', afterSource: '<main>First</main>\n' }]);
  await flushDurableSourceWritesThrough(projectId, first.revision);
  writeGate = new Promise<void>(resolve => { releaseWrite = resolve; });
  const second = await acceptFileChanges(`wc://${projectId}`, [{ file, beforeSource: '<main>First</main>\n', afterSource: '<main>Second</main>\n' }]);
  // Not materialized yet: projected on top of the disk (First).
  expect(await withProjectedSource(projectId, second.revision, () => readProjectedSourceState(projectId, file))).toBe('<main>Second</main>\n');
  expect(runtime.read(file)).toBe('<main>First</main>\n');
  releaseWrite!(); await flushDurableSourceWritesThrough(projectId, second.revision);
  // Materialized: the disk IS the baseline (files are truth).
  expect(runtime.read(file)).toBe('<main>Second</main>\n');
  expect(await withProjectedSource(projectId, second.revision, () => readProjectedSourceState(projectId, file))).toBe('<main>Second</main>\n');
});
