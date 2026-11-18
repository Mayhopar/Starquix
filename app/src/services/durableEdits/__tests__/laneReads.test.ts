/** P0a (instant-edit): one journal read, one evidence scan and one disk read per acceptance SLOT,
 * not per question. Before: 6 whole-journal scans + J receipt gets per class edit (service = 12 + 5.24 J ms). */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';

const readState = vi.hoisted(() => vi.fn());
vi.mock('../commandReceipts', async importOriginal => ({ ...(await importOriginal<typeof import('../commandReceipts')>()), readSourceState: readState }));

import { closeLaneReadScope, laneMemo, listProjectRows, openLaneReadScope } from '../store';
import { acceptedIdentityMaps } from '../sourceIdentity';
import { readProjectedSourceState, withProjectedSource } from '../projectedSource';
import { acceptProjectEdit } from '../acceptance';
import type { StoredDurableEdit } from '../types';

const P = 'lane-reads';
const FILE = 'src/pages/index.astro';
const J = 50;
const classRow = (n: number, materialized = true): StoredDurableEdit => ({
  id: `${P}:op-${n}`, projectId: P, operationId: `op-${n}`, revision: n, yjsUpdate: null, acceptedAt: n, materializedAt: materialized ? n : null,
  commands: [{ kind: 'class-write', payload: { sourceLocation: { file: FILE, line: 1, column: 1 }, newClasses: `w-${n}`, baseClasses: null, origin: null,
    preparedFiles: [{ file: FILE, beforeSource: `<img class="w-${n - 1}">`, afterSource: `<img class="w-${n}">`, identityMaps: [] }] } }],
});
const batchRow = (n: number): StoredDurableEdit => ({
  id: `${P}:op-${n}`, projectId: P, operationId: `op-${n}`, revision: n, yjsUpdate: null, acceptedAt: n, materializedAt: n,
  commands: [{ kind: 'file-batch', payload: { files: [{ file: FILE, beforeSource: 'a', afterSource: `kept-${n}` }] } }],
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.delete(); await db.open();
  readState.mockReset();
  closeLaneReadScope(P);
});
const journalReads = () => vi.spyOn(db.durableEdits, 'where');
const received = (spy: ReturnType<typeof journalReads>) => spy.mock.calls.filter(([index]) => index === 'projectId').length;

describe('per-slot journal snapshot', () => {
  it('outside an acceptance slot every read is fresh', async () => {
    await db.durableEdits.bulkAdd(Array.from({ length: J }, (_, i) => classRow(i + 1)));
    const spy = journalReads();
    await listProjectRows(P); await listProjectRows(P); await acceptedIdentityMaps(P, FILE);
    expect(received(spy)).toBe(3);
  });

  it('inside a slot the journal is read ONCE for every reader (rows, identity evidence, projection)', async () => {
    await db.durableEdits.bulkAdd(Array.from({ length: J }, (_, i) => classRow(i + 1)));
    const spy = journalReads(); const receipts = vi.spyOn(db.durableCommandReceipts, 'get');
    openLaneReadScope(P);
    try {
      await listProjectRows(P); await listProjectRows(P, 10);
      for (let i = 0; i < 6; i++) await acceptedIdentityMaps(P, FILE); // the lane asked this six times per edit
      expect(await withProjectedSource(P, J, async () => 'ran')).toBe('ran');
    } finally { closeLaneReadScope(P); }
    expect(received(spy)).toBe(1);
    expect(receipts).not.toHaveBeenCalled(); // 0 receipt gets per materialized row (was J)
  });

  it('serves the through-revision prefix from the same read', async () => {
    await db.durableEdits.bulkAdd(Array.from({ length: J }, (_, i) => classRow(i + 1)));
    openLaneReadScope(P);
    try {
      expect((await listProjectRows(P, 10)).map(r => r.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(await listProjectRows(P)).toHaveLength(J);
    } finally { closeLaneReadScope(P); }
  });

  it('a closed scope forgets everything: the next slot sees the row the previous slot appended', async () => {
    await db.durableEdits.bulkAdd([classRow(1), classRow(2)]);
    openLaneReadScope(P);
    expect(await listProjectRows(P)).toHaveLength(2);
    closeLaneReadScope(P);
    await db.durableEdits.add(classRow(3));
    openLaneReadScope(P);
    try { expect(await listProjectRows(P)).toHaveLength(3); } finally { closeLaneReadScope(P); }
    expect(await listProjectRows(P)).toHaveLength(3);
  });

  it('a failed read does not poison the rest of the slot', async () => {
    openLaneReadScope(P);
    try {
      let calls = 0;
      await expect(laneMemo(P, 'k', async () => { calls++; throw new Error('boom'); })).rejects.toThrow('boom');
      await expect(laneMemo(P, 'k', async () => { calls++; return 'ok'; })).resolves.toBe('ok');
      expect(calls).toBe(2);
    } finally { closeLaneReadScope(P); }
  });

  it('two projects never share a snapshot', async () => {
    await db.durableEdits.bulkAdd([classRow(1)]);
    openLaneReadScope(P);
    try {
      expect(await listProjectRows(P)).toHaveLength(1);
      expect(await listProjectRows('other-project')).toHaveLength(0);
    } finally { closeLaneReadScope(P); }
  });
});

describe('per-slot disk read memo and the lazy retained fallback', () => {
  it('reads each file from the runtime once per slot, and every time outside one', async () => {
    readState.mockResolvedValue('on disk');
    for (let i = 0; i < 4; i++) await readProjectedSourceState(P, FILE);
    expect(readState).toHaveBeenCalledTimes(4);
    readState.mockClear();
    openLaneReadScope(P);
    try { for (let i = 0; i < 4; i++) expect(await readProjectedSourceState(P, FILE)).toBe('on disk'); } finally { closeLaneReadScope(P); }
    expect(readState).toHaveBeenCalledTimes(1);
  });

  it('an unreadable runtime still falls back to the last materialized bytes (built only then)', async () => {
    await db.durableEdits.bulkAdd([batchRow(1), batchRow(2), batchRow(3)]);
    readState.mockRejectedValue(new Error('offline'));
    const receipts = vi.spyOn(db.durableCommandReceipts, 'get');
    const seen = await withProjectedSource(P, 3, () => readProjectedSourceState(P, FILE));
    expect(seen).toBe('kept-3');
    await expect(readProjectedSourceState(P, FILE)).rejects.toThrow('offline'); // no projection = no fallback, as before
    expect(receipts).not.toHaveBeenCalled(); // file-batch rows carry their bytes inline
  });
});

describe('the lane scope', () => {
  it('is open while a slot prepares (one read for its readers) and closed once it has accepted', async () => {
    await db.durableEdits.bulkAdd(Array.from({ length: 5 }, (_, i) => classRow(i + 1)));
    await db.durableProjectState.put({ projectId: P, acceptedRevision: 5, materializedRevision: 5 });
    const spy = journalReads(); const doc = new Y.Doc();
    await acceptProjectEdit(doc, { projectId: P, operationId: 'op-6', commands: [], mutate: staged => { staged.getMap('m').set('k', 1); },
      prepare: async () => { await listProjectRows(P); await listProjectRows(P); await acceptedIdentityMaps(P, FILE); } });
    expect(received(spy)).toBe(1);
    expect((await listProjectRows(P)).map(r => r.revision)).toEqual([1, 2, 3, 4, 5, 6]); // not the stale 5-row memo
    expect(received(spy)).toBe(2);
    doc.destroy();
  });

  it('is closed again when the slot is rejected', async () => {
    await db.durableEdits.bulkAdd([classRow(1)]);
    const doc = new Y.Doc();
    await expect(acceptProjectEdit(doc, { projectId: P, operationId: 'op-2', commands: [], mutate: () => { throw new Error('nope'); },
      prepare: async () => { await listProjectRows(P); } })).rejects.toThrow('nope');
    await db.durableEdits.add(classRow(2));
    expect(await listProjectRows(P)).toHaveLength(2);
    doc.destroy();
  });
});
