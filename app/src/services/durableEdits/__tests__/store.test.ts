import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';

import { db } from '@/db';
import {
  acceptStoredEdit,
  compactDurableEdits,
  getDurableProjectState,
  listUnmaterialized,
  recordMaterialization,
} from '../store';
import type { NewDurableEdit } from '../types';

const PROJECT = 'project-1';

function edit(operationId: string, projectId = PROJECT): NewDurableEdit {
  return {
    operationId,
    projectId,
    yjsUpdate: null,
    commands: [],
    acceptedAt: 1_789_329_600_000,
  };
}

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('durable edit store', () => {
  it('accepts once and advances the project revision atomically', async () => {
    const first = await acceptStoredEdit(edit('op-1'));
    const duplicate = await acceptStoredEdit(edit('op-1'));

    expect(first).toEqual({ operationId: 'op-1', revision: 1 });
    expect(duplicate).toEqual(first);
    expect((await getDurableProjectState(PROJECT)).acceptedRevision).toBe(1);
    expect(await db.durableEdits.where('projectId').equals(PROJECT).count()).toBe(1);
  });

  it('serializes concurrent accepts into distinct project revisions', async () => {
    const accepted = await Promise.all([
      acceptStoredEdit(edit('op-1')),
      acceptStoredEdit(edit('op-2')),
    ]);

    expect(accepted.map(({ revision }) => revision).sort()).toEqual([1, 2]);
    expect((await getDurableProjectState(PROJECT)).acceptedRevision).toBe(2);
  });

  it('aborts both the journal row and revision increment when the row cannot be stored', async () => {
    const uncloneable = edit('op-bad');
    uncloneable.yjsUpdate = Symbol('cannot-clone') as unknown as Uint8Array;

    await expect(acceptStoredEdit(uncloneable)).rejects.toBeDefined();

    expect(await db.durableEdits.get(`${PROJECT}:op-bad`)).toBeUndefined();
    expect(await getDurableProjectState(PROJECT)).toEqual({
      projectId: PROJECT,
      acceptedRevision: 0,
      materializedRevision: 0,
    });
  });

  it('lists only unmaterialized edits after the requested revision in revision order', async () => {
    await acceptStoredEdit(edit('op-1'));
    await acceptStoredEdit(edit('op-2'));
    await acceptStoredEdit(edit('op-3'));
    await recordMaterialization({
      projectId: PROJECT,
      operationId: 'op-2',
      materializedAt: 1_789_329_600_100,
    });

    const rows = await listUnmaterialized(PROJECT, 1);

    expect(rows.map(({ operationId, revision }) => ({ operationId, revision }))).toEqual([
      { operationId: 'op-3', revision: 3 },
    ]);
  });

  it('advances the materialization cursor only across a contiguous materialized prefix', async () => {
    await acceptStoredEdit(edit('op-1'));
    await acceptStoredEdit(edit('op-2'));
    await acceptStoredEdit(edit('op-3'));

    await recordMaterialization({ projectId: PROJECT, operationId: 'op-2', materializedAt: 20 });
    expect((await getDurableProjectState(PROJECT)).materializedRevision).toBe(0);

    await recordMaterialization({ projectId: PROJECT, operationId: 'op-1', materializedAt: 10 });
    expect((await getDurableProjectState(PROJECT)).materializedRevision).toBe(2);

    await recordMaterialization({ projectId: PROJECT, operationId: 'op-3', materializedAt: 30 });
    expect((await getDurableProjectState(PROJECT)).materializedRevision).toBe(3);
  });

  it('refuses unsafe compaction and deletes only through the materialized cursor', async () => {
    await acceptStoredEdit(edit('op-1'));
    await acceptStoredEdit(edit('op-2'));
    await acceptStoredEdit(edit('op-3'));
    await recordMaterialization({ projectId: PROJECT, operationId: 'op-1', materializedAt: 10 });
    await recordMaterialization({ projectId: PROJECT, operationId: 'op-2', materializedAt: 20 });

    await expect(compactDurableEdits(PROJECT, 3)).rejects.toThrow(
      'Cannot compact durable edits past materialized revision 2',
    );
    expect(await db.durableEdits.where('projectId').equals(PROJECT).count()).toBe(3);

    await compactDurableEdits(PROJECT, 2);
    expect((await db.durableEdits.where('projectId').equals(PROJECT).toArray()).map(row => row.revision)).toEqual([3]);
  });

  it('returns the original revision when an operation is retried after compaction', async () => {
    const first = await acceptStoredEdit(edit('op-1'));
    await recordMaterialization({ projectId: PROJECT, operationId: 'op-1', materializedAt: 10 });
    await compactDurableEdits(PROJECT, 1);

    expect(await db.durableEdits.get(`${PROJECT}:op-1`)).toBeUndefined();

    const retry = await acceptStoredEdit(edit('op-1'));

    expect(retry).toEqual(first);
    expect((await getDurableProjectState(PROJECT)).acceptedRevision).toBe(1);
    expect(await db.durableEdits.where('projectId').equals(PROJECT).count()).toBe(0);
  });

  it.each(['file-batch', 'receipt-replay'] as const)('retains %s source ownership evidence when compaction has no identity checkpoint', async kind => {
    const sourceEdit = edit('source-owner');
    sourceEdit.commands = kind === 'file-batch'
      ? [{ kind, payload: { files: [{ file: 'src/pages/index.astro', beforeSource: '<p>Before</p>', afterSource: '<p>After</p>' }] } }]
      : [{ kind, payload: { commandIds: ['original-command'], direction: 'before' } }];
    await acceptStoredEdit(edit('safe-prefix'));
    await acceptStoredEdit(sourceEdit);
    await recordMaterialization({ projectId: PROJECT, operationId: 'safe-prefix', materializedAt: 10 });
    await recordMaterialization({ projectId: PROJECT, operationId: 'source-owner', materializedAt: 20 });

    // Materialized bytes alone do not retire source identities or Undo owners.
    // Refusal must be atomic: even the source-independent prefix stays intact.
    await expect(compactDurableEdits(PROJECT, 2)).rejects.toThrow(/source.*checkpoint/i);
    expect(await db.durableEdits.where('projectId').equals(PROJECT).count()).toBe(2);
    expect((await db.durableEdits.get(`${PROJECT}:source-owner`))?.commands).toEqual(sourceEdit.commands);
    expect(await acceptStoredEdit(sourceEdit)).toEqual({ operationId: 'source-owner', revision: 2 });
  });

  it('retains document-only accepted state until a durable document checkpoint exists', async () => {
    const original = new Y.Doc();
    original.getMap('semantic-state').set('retained-value', 'accepted');
    const input = { ...edit('document-owner'), yjsUpdate: Y.encodeStateAsUpdate(original) };
    await acceptStoredEdit(input);
    await recordMaterialization({ projectId: PROJECT, operationId: input.operationId, materializedAt: 10 });
    await expect(compactDurableEdits(PROJECT, 1)).rejects.toThrow(/document.*checkpoint/i);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, (await db.durableEdits.get(`${PROJECT}:document-owner`))!.yjsUpdate!);
    expect(restored.getMap('semantic-state').get('retained-value')).toBe('accepted');
    expect(await acceptStoredEdit(input)).toEqual({ operationId: 'document-owner', revision: 1 });
    original.destroy(); restored.destroy();
  });

  it('can compact the canonical empty Yjs update without treating it as document state', async () => {
    await acceptStoredEdit({ ...edit('no-op'), yjsUpdate: new Uint8Array([0, 0]) });
    await recordMaterialization({ projectId: PROJECT, operationId: 'no-op', materializedAt: 10 });
    await compactDurableEdits(PROJECT, 1);
    expect(await db.durableEdits.count()).toBe(0);
    expect(await acceptStoredEdit(edit('no-op'))).toEqual({ operationId: 'no-op', revision: 1 });
  });

  it('keeps project revision streams isolated', async () => {
    const [first, second] = await Promise.all([
      acceptStoredEdit(edit('same-operation', 'project-a')),
      acceptStoredEdit(edit('same-operation', 'project-b')),
    ]);

    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
  });
});
