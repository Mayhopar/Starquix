/** instant-edit P1: an UN-STARTED older slot of the same key is skipped by a newer call. A skipped slot stages
 * nothing, takes no snapshot, writes no row and resolves with its predecessor's result, never revision 0. */
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { acceptProjectEdit, awaitAccepted } from '../acceptance';
import { getDurableEditStatus } from '../status';

const P = 'supersede';
beforeEach(async () => { await db.delete(); await db.open(); });
const gate = () => { let open!: () => void; const promise = new Promise<void>(r => { open = r; }); return { promise, open }; };
const edit = (doc: Y.Doc, op: string, over: Partial<Parameters<typeof acceptProjectEdit>[1]> = {}, ran?: string[]) =>
  acceptProjectEdit(doc, { projectId: P, operationId: op, commands: [], ...over, mutate: staged => { ran?.push(op); staged.getMap('m').set('v', op); } });

describe('supersede', () => {
  it('skips a queued same-key slot: its mutate never runs, no row, and it resolves with its predecessor\'s result', async () => {
    const doc = new Y.Doc(); const hold = gate(); const ran: string[] = [];
    const entered = gate();
    const first = edit(doc, 'a', { supersedeKey: 'k', prepare: async () => { entered.open(); await hold.promise; } }, ran);   // in flight
    await entered.promise;
    const second = edit(doc, 'b', { supersedeKey: 'k' }, ran);                                                                 // queued: superseded
    const third = edit(doc, 'c', { supersedeKey: 'k' }, ran);                                                                  // the survivor
    hold.open();
    const [a, b, c] = await Promise.all([first, second, third]);
    expect(ran).toEqual(['a', 'c']);
    expect(await db.durableEdits.count()).toBe(2);
    expect(a.revision).toBe(1);
    expect(b.revision).toBe(1);               // the predecessor's accepted revision, never 0
    expect(c.revision).toBe(2);
    expect(doc.getMap('m').get('v')).toBe('c');
    doc.destroy();
  });

  it('a slot that has not started yet is superseded even by a call in the same tick (the final value wins)', async () => {
    const doc = new Y.Doc(); const ran: string[] = [];
    const a = edit(doc, 'a', { supersedeKey: 'k' }, ran);
    const b = edit(doc, 'b', { supersedeKey: 'k' }, ran);
    await Promise.all([a, b]);
    expect(ran).toEqual(['b']);
    expect(await db.durableEdits.count()).toBe(1);
    doc.destroy();
  });

  it('never cancels the in-flight slot, and other keys keep their FIFO position', async () => {
    const doc = new Y.Doc(); const hold = gate(); const ran: string[] = []; const entered = gate();
    const a = edit(doc, 'a', { supersedeKey: 'x', prepare: async () => { entered.open(); await hold.promise; } }, ran);
    await entered.promise;
    const b = edit(doc, 'b', { supersedeKey: 'y' }, ran);
    const c = edit(doc, 'c', { supersedeKey: 'x' }, ran);   // supersedes nothing un-started: a is in flight, b has another key
    hold.open(); await Promise.all([a, b, c]);
    expect(ran).toEqual(['a', 'b', 'c']);
    doc.destroy();
  });

  it('awaitAccepted after a skipped tail waits for the earlier rows and resolves with the last accepted revision', async () => {
    const doc = new Y.Doc(); const hold = gate(); const entered = gate();
    const first = edit(doc, 'a', { supersedeKey: 'k', prepare: async () => { entered.open(); await hold.promise; } });
    await entered.promise;
    const skipped = edit(doc, 'b', { supersedeKey: 'k' });
    const survivor = edit(doc, 'c', { supersedeKey: 'k' });
    const barrier = awaitAccepted(P);
    hold.open();
    await Promise.all([first, skipped, survivor]);
    expect(await barrier).toBe(2);
    expect(getDurableEditStatus(P)).toMatchObject({ phase: 'accepted', acceptedRevision: 2 });
    doc.destroy();
  });

  it('a barrier awaiting a skipped TAIL does not stop at revision 0', async () => {
    const doc = new Y.Doc(); const hold = gate(); const entered = gate();
    const first = edit(doc, 'a', { supersedeKey: 'k', prepare: async () => { entered.open(); await hold.promise; } });
    await entered.promise;
    const skipped = edit(doc, 'b', { supersedeKey: 'k' });
    const survivor = edit(doc, 'c', { supersedeKey: 'other' });   // does not supersede b: b is the skipped one only if superseded
    void survivor;
    const newer = edit(doc, 'd', { supersedeKey: 'k' });          // supersedes b; the tail is now d, then c ... order: a, b(skipped), c, d
    hold.open();
    await Promise.all([first, skipped, survivor, newer]);
    expect(await awaitAccepted(P)).toBe(3);
    doc.destroy();
  });

  it('without a key (or with different keys) nothing is skipped', async () => {
    const doc = new Y.Doc(); const hold = gate(); const ran: string[] = []; const entered = gate();
    const a = edit(doc, 'a', { prepare: async () => { entered.open(); await hold.promise; } }, ran);
    await entered.promise;
    const b = edit(doc, 'b', {}, ran);
    const c = edit(doc, 'c', { supersedeKey: 'k1' }, ran);
    const d = edit(doc, 'd', { supersedeKey: 'k2' }, ran);
    hold.open(); await Promise.all([a, b, c, d]);
    expect(ran).toEqual(['a', 'b', 'c', 'd']);
    doc.destroy();
  });

  it('a slot that already started is not skipped even when a newer call arrives', async () => {
    const doc = new Y.Doc(); const hold = gate(); const started = gate(); const ran: string[] = [];
    const a = edit(doc, 'a', { supersedeKey: 'k', prepare: async () => { started.open(); await hold.promise; } }, ran);
    await started.promise;
    const b = edit(doc, 'b', { supersedeKey: 'k' }, ran);
    hold.open(); await Promise.all([a, b]);
    expect(ran).toEqual(['a', 'b']);
    doc.destroy();
  });
});
