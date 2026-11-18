/** instant-edit P0b: the call-order number is reserved when acceptProjectEdit is CALLED, so FIFO call order = lane
 * order = intent order; the observer inside the accepted apply reads its op's revision and held keys. */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import * as store from '../store';
import { acceptProjectEdit } from '../acceptance';
import { intentOfOrigin, _resetClassIntentsForTests } from '@/services/classIntents';

const P = 'intent-seq';
beforeEach(async () => { vi.restoreAllMocks(); await db.delete(); await db.open(); _resetClassIntentsForTests(); });
const gate = () => { let open!: () => void; const promise = new Promise<void>(r => { open = r; }); return { promise, open }; };

describe('acceptProjectEdit intent bookkeeping', () => {
  it('reserves seq in CALL order even when the lane runs the edits later and slowly', async () => {
    const doc = new Y.Doc(); const first = gate(); const seen: Array<{ op: string; seq: number }> = [];
    const edit = (op: string, prepare?: () => Promise<void>) => acceptProjectEdit(doc, { projectId: P, operationId: op, commands: [], prepare,
      mutate: staged => { staged.getMap('m').set(op, 1); const t = intentOfOrigin(P, `durable-edit:${op}`); seen.push({ op, seq: t!.seq }); } });
    const a = edit('a', () => first.promise); const b = edit('b'); const c = edit('c');
    first.open(); await Promise.all([a, b, c]);
    expect(seen.map(s => s.op)).toEqual(['a', 'b', 'c']);
    expect(seen[0].seq).toBeLessThan(seen[1].seq);
    expect(seen[1].seq).toBeLessThan(seen[2].seq);
    doc.destroy();
  });

  it('hands the observer inside the accepted apply its op revision and the keys the writer reported', async () => {
    const doc = new Y.Doc(); const holdKeys = new Set<string>();
    let observed: ReturnType<typeof intentOfOrigin>;
    doc.getMap('m').observe((_event, transaction) => { observed = intentOfOrigin(P, transaction.origin); });
    const result = await acceptProjectEdit(doc, { projectId: P, operationId: 'class-edit:one', commands: [], holdKeys,
      mutate: staged => { staged.getMap('m').set('x', 1); holdKeys.add('src/pages/a.astro:5:3'); } });
    expect(observed).toMatchObject({ op: 'class-edit:one', rev: result.revision });
    expect(observed!.holdKeys!.has('src/pages/a.astro:5:3')).toBe(true);
    doc.destroy();
  });

  it('an edit whose writer reports nothing holds nothing', async () => {
    const doc = new Y.Doc(); let observed: ReturnType<typeof intentOfOrigin>;
    doc.getMap('m').observe((_event, transaction) => { observed = intentOfOrigin(P, transaction.origin); });
    await acceptProjectEdit(doc, { projectId: P, operationId: 'plain', commands: [], mutate: staged => { staged.getMap('m').set('x', 1); } });
    expect(observed!.holdKeys).toBeNull();
    doc.destroy();
  });

  it('forgets the op once accepted, and when the edit is rejected', async () => {
    const doc = new Y.Doc();
    await acceptProjectEdit(doc, { projectId: P, operationId: 'ok', commands: [], mutate: staged => { staged.getMap('m').set('x', 1); } });
    expect(intentOfOrigin(P, 'durable-edit:ok')).toBeUndefined();
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    await expect(acceptProjectEdit(doc, { projectId: P, operationId: 'bad', commands: [], mutate: staged => { staged.getMap('m').set('y', 1); } })).rejects.toThrow('quota');
    expect(intentOfOrigin(P, 'durable-edit:bad')).toBeUndefined();
    doc.destroy();
  });

  it('honours an explicit intentSeq', async () => {
    const doc = new Y.Doc(); let seq = -1;
    await acceptProjectEdit(doc, { projectId: P, operationId: 'fixed', commands: [], intentSeq: { epoch: 'x', seq: 99 },
      mutate: staged => { staged.getMap('m').set('x', 1); seq = intentOfOrigin(P, 'durable-edit:fixed')!.seq; } });
    expect(seq).toBe(99);
    doc.destroy();
  });
});
