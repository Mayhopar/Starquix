import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { db } from '@/db';
import type { StructuralOp } from '@/store/structuralUndo';
import { acceptStructuralReplay } from '../structuralReplayAcceptance';
import { listUnmaterialized } from '../store';
import { _resetLocalPageSyncForTests } from '@/utils/localPageSync';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';

const file = 'src/pages/index.astro';
const loc = { file, line: 1, column: 1 };
const stamped = '<Card data-sq-id="s0123456789abcdef" /><Other data-sq-id={undefined} />';
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { _resetLocalPageSyncForTests(); setActiveSaveProjectId(null); });

it.each(['insert', 'append-page'] as const)('replay %s accepts fresh markup without copying source stamps', async kind => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', 'replay-stamps');
  const runtime = projectFsRuntime('replay-stamps', { [file]: '<main></main>' });
  try {
  const op: StructuralOp = kind === 'insert'
    ? { kind, loc, markup: stamped, position: 'inside-end' }
    : { kind, pageFile: file, markup: stamped };
  await acceptStructuralReplay(doc, [op]);
  const [row] = await listUnmaterialized('replay-stamps');
  const command = row.commands[0];
  if (command.kind !== 'file-batch') throw new Error('Expected accepted structural file evidence');
  expect(command.payload.files[0].afterSource).toContain('<Card />');
  expect(command.payload.files[0].afterSource).toContain('<Other data-sq-id={undefined} />');
  expect(command.payload.files[0].afterSource).not.toContain('s0123456789abcdef');
  expect(command.payload.files[0].identityMaps).toHaveLength(1);
  expect(runtime.read(file)).toBe('<main></main>');
  expect(op.markup).toBe(stamped);
  } finally { runtime.close(); doc.destroy(); }
});

it('preserves byte-exact restore payloads and move coordinates', async () => {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', 'replay-restores');
  const original = '<main>\n<p>A</p>\n<p>B</p>\n</main>\n';
  const runtime = projectFsRuntime('replay-restores', { [file]: original });
  try {
  const restored = '<Card data-sq-id="s0123456789abcdef" />\n';
  const ops: StructuralOp[] = [
    { kind: 'restore', loc: { ...loc, line: 2 }, text: restored },
    { kind: 'restore-region', loc: { ...loc, line: 2 }, lineCount: 1, segment: restored },
    { kind: 'move', from: { ...loc, line: 4 }, to: { ...loc, line: 3 }, position: 'before', allowRootRemoval: true },
  ];
  await acceptStructuralReplay(doc, ops);
  const [row] = await listUnmaterialized('replay-restores');
  const command = row.commands[0];
  if (command.kind !== 'file-batch') throw new Error('Expected accepted structural file evidence');
  expect(command.payload.files[0].afterSource).toBe('<main>\n<Card data-sq-id="s0123456789abcdef" />\n<p>B</p>\n<p>A</p>\n</main>\n');
  expect(command.payload.files[0].identityMaps).toHaveLength(3);
  expect(runtime.read(file)).toBe(original);
  expect(ops[0]).toMatchObject({ text: restored });
  } finally { runtime.close(); doc.destroy(); }
});
