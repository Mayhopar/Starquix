import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import * as store from '../store';
import { acceptProjectEdit, awaitAccepted } from '../acceptance';
import { getDurableEditStatus, subscribeDurableEditStatus } from '../status';

const PROJECT = 'acceptance-project';
const PAGE = 'page-1';
function baseDoc() {
  const doc = new Y.Doc();
  const page = new Y.Map();
  page.set('name', 'Old name');
  doc.getMap('pages').set(PAGE, page);
  return doc;
}
function pageName(doc: Y.Doc) {
  return doc.getMap<Y.Map<string>>('pages').get(PAGE)!.get('name');
}
function renamePage(doc: Y.Doc, name: string) {
  doc.getMap<Y.Map<string>>('pages').get(PAGE)!.set('name', name);
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('project edit acceptance', () => {
  it('holds asynchronous source preparation in the same lane before later staging', async () => {
    const doc = baseDoc(); const entered = deferred(); const release = deferred();
    const first = acceptProjectEdit(doc, { projectId: PROJECT, operationId: 'prepared', commands: [],
      prepare: async (revision: number) => { expect(revision).toBe(0); entered.resolve(); await release.promise; },
      mutate: staged => renamePage(staged, 'Prepared'),
    } as Parameters<typeof acceptProjectEdit>[1]);
    await Promise.race([entered.promise, first]);
    const next = acceptProjectEdit(doc, { projectId: PROJECT, operationId: 'later', commands: [], mutate: staged => renamePage(staged, `${pageName(staged)} later`) });
    expect(pageName(doc)).toBe('Old name');
    release.resolve(); await first; await next;
    expect(pageName(doc)).toBe('Prepared later'); doc.destroy();
  });
  it('leaves live state and observers untouched when storage rejects', async () => {
    const doc = baseDoc();
    const updates: unknown[] = [];
    doc.on('update', update => updates.push(update));
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    let latestStatus;
    const unsubscribe = subscribeDurableEditStatus(() => { latestStatus = getDurableEditStatus(PROJECT); });
    await expect(acceptProjectEdit(doc, {
      operationId: 'rename-1', projectId: PROJECT,
      mutate: staged => renamePage(staged, 'New name'), commands: [],
    })).rejects.toThrow('quota');
    expect(pageName(doc)).toBe('Old name');
    expect(updates).toEqual([]);
    expect(latestStatus).toMatchObject({ phase: 'rejected', operationId: 'rename-1' });
    expect(await db.durableEdits.count()).toBe(0);
    unsubscribe();
    doc.destroy();
  });

  it('serializes staging, publishes only after commit, and replays persisted updates exactly once', async () => {
    const doc = baseDoc();
    const reload = new Y.Doc();
    Y.applyUpdate(reload, Y.encodeStateAsUpdate(doc));
    const entered = deferred();
    const release = deferred();
    const accept = store.acceptStoredEdit;
    vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => {
      entered.resolve();
      await release.promise;
      return accept(input);
    });
    const origins: unknown[] = [];
    doc.on('update', (_update, origin) => origins.push(origin));
    const first = acceptProjectEdit(doc, {
      operationId: 'first', projectId: PROJECT,
      mutate: staged => { renamePage(staged, 'New name'); staged.getArray('events').push(['first']); }, commands: [],
    });
    await entered.promise;
    const barrier = awaitAccepted(PROJECT);
    const second = acceptProjectEdit(doc, {
      operationId: 'second', projectId: PROJECT,
      mutate: staged => {
        renamePage(staged, `${pageName(staged)} again`);
        staged.getArray('events').push(['second']);
      }, commands: [],
    });
    expect(pageName(doc)).toBe('Old name');
    expect(origins).toEqual([]);
    release.resolve();
    expect(await first).toEqual({ operationId: 'first', revision: 1 });
    expect(await barrier).toBe(1);
    expect(await second).toEqual({ operationId: 'second', revision: 2 });
    expect(await awaitAccepted(PROJECT)).toBe(2);
    expect(pageName(doc)).toBe('New name again');
    expect(origins).toEqual(['durable-edit:first', 'durable-edit:second']);
    const rows = await store.listUnmaterialized(PROJECT);
    for (const row of rows) {
      Y.applyUpdate(reload, row.yjsUpdate!);
      Y.applyUpdate(reload, row.yjsUpdate!);
    }
    expect(pageName(reload)).toBe('New name again');
    expect(reload.getArray('events').toArray()).toEqual(['first', 'second']);
    expect(getDurableEditStatus(PROJECT)).toMatchObject({ phase: 'accepted', acceptedRevision: 2 });
    doc.destroy(); reload.destroy();
  });

  it('continues the project queue after a rejected edit', async () => {
    const doc = baseDoc();
    vi.spyOn(store, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const failed = acceptProjectEdit(doc, { operationId: 'bad', projectId: PROJECT, mutate: staged => renamePage(staged, 'Lost'), commands: [] });
    const next = acceptProjectEdit(doc, { operationId: 'next', projectId: PROJECT, mutate: staged => renamePage(staged, `${pageName(staged)} kept`), commands: [] });
    await expect(failed).rejects.toThrow('quota');
    expect(await next).toEqual({ operationId: 'next', revision: 1 });
    expect(pageName(doc)).toBe('Old name kept');
    doc.destroy();
  });

  it('does not let a blocked project hold up another project', async () => {
    const firstDoc = baseDoc(); const otherDoc = baseDoc();
    const entered = deferred(); const release = deferred();
    const accept = store.acceptStoredEdit;
    vi.spyOn(store, 'acceptStoredEdit').mockImplementationOnce(async input => { entered.resolve(); await release.promise; return accept(input); });
    const first = acceptProjectEdit(firstDoc, { operationId: 'blocked', projectId: PROJECT, mutate: staged => renamePage(staged, 'A'), commands: [] });
    await entered.promise;
    try {
      const other = await acceptProjectEdit(otherDoc, { operationId: 'other', projectId: 'other-project', mutate: staged => renamePage(staged, 'B'), commands: [] });
      expect(other.revision).toBe(1);
      expect(pageName(otherDoc)).toBe('B');
    } finally { release.resolve(); await first; firstDoc.destroy(); otherDoc.destroy(); }
  });

  it('retains accepted document updates and deduplicates after refusing unsafe compaction', async () => {
    const doc = baseDoc();
    const input = { operationId: 'once', projectId: PROJECT, mutate: (staged: Y.Doc) => staged.getArray('events').push(['once']), commands: [] };
    await acceptProjectEdit(doc, input);
    await store.recordMaterialization({ projectId: PROJECT, operationId: 'once', materializedAt: 10 });
    await expect(store.compactDurableEdits(PROJECT, 1)).rejects.toThrow(/document.*checkpoint/i);
    expect(await acceptProjectEdit(doc, { ...input, mutate: () => { throw new Error('must not restage'); } })).toEqual({ operationId: 'once', revision: 1 });
    expect(doc.getArray('events').toArray()).toEqual(['once']);
    expect(await db.durableEdits.count()).toBe(1);
    doc.destroy();
  });

  it('discards staging when the mutation throws', async () => {
    const doc = baseDoc();
    await expect(acceptProjectEdit(doc, { operationId: 'throws', projectId: PROJECT, commands: [], mutate: staged => { renamePage(staged, 'Lost'); throw new Error('invalid'); } })).rejects.toThrow('invalid');
    expect(pageName(doc)).toBe('Old name');
    expect(await db.durableEdits.count()).toBe(0);
    doc.destroy();
  });

  it('captures the project high water revision when the pending operation is a duplicate', async () => {
    const doc = baseDoc();
    const input = { operationId: 'one', projectId: PROJECT, commands: [], mutate: (staged: Y.Doc) => renamePage(staged, 'One') };
    await acceptProjectEdit(doc, input);
    await acceptProjectEdit(doc, { ...input, operationId: 'two' });
    const retry = acceptProjectEdit(doc, input);
    const barrier = awaitAccepted(PROJECT);
    expect(await retry).toEqual({ operationId: 'one', revision: 1 });
    expect(await barrier).toBe(2);
    doc.destroy();
  });

  it('preserves accepted truth when a live observer throws after the durable commit', async () => {
    const doc = baseDoc();
    const observer = () => { throw new Error('live observer failed'); };
    doc.on('update', observer);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(acceptProjectEdit(doc, {
      operationId: 'observer-fault', projectId: PROJECT, commands: [],
      mutate: staged => renamePage(staged, 'Committed name'),
    })).resolves.toEqual({ operationId: 'observer-fault', revision: 1 });

    expect(pageName(doc)).toBe('Committed name');
    expect((await store.listUnmaterialized(PROJECT)).map(row => row.operationId)).toEqual(['observer-fault']);
    expect(getDurableEditStatus(PROJECT)).toMatchObject({ phase: 'accepted', operationId: 'observer-fault', acceptedRevision: 1 });
    expect(await awaitAccepted(PROJECT)).toBe(1);
    doc.off('update', observer);
    doc.destroy();
  });

  it('does not overturn acceptance when staging cleanup throws', async () => {
    const doc = baseDoc();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(acceptProjectEdit(doc, {
      operationId: 'cleanup-fault', projectId: PROJECT, commands: [],
      mutate: staged => {
        renamePage(staged, 'Committed name');
        staged.on('destroy', () => { throw new Error('staging cleanup failed'); });
      },
    })).resolves.toEqual({ operationId: 'cleanup-fault', revision: 1 });

    expect(pageName(doc)).toBe('Committed name');
    expect((await store.listUnmaterialized(PROJECT)).map(row => row.operationId)).toEqual(['cleanup-fault']);
    expect(getDurableEditStatus(PROJECT)).toMatchObject({ phase: 'accepted', acceptedRevision: 1 });
    doc.destroy();
  });
});
