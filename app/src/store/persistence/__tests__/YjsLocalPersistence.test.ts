import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { describe, it, expect } from 'vitest';
import { bindLocalPersistence, hasLocalDoc } from '../YjsLocalPersistence';

describe('YjsLocalPersistence', () => {
  it('persists a doc and rehydrates it into a fresh doc with the same data', async () => {
    const docA = new Y.Doc();
    const p1 = await bindLocalPersistence('proj-test', docA);
    docA.getMap('pages').set('page-1', 'hello');
    await p1.whenSynced;
    p1.destroy();

    const docB = new Y.Doc();
    const p2 = await bindLocalPersistence('proj-test', docB);
    await p2.whenSynced;
    expect(docB.getMap('pages').get('page-1')).toBe('hello');
    p2.destroy();
  });

  it('hasLocalDoc reports false before any binding and true after data persisted', async () => {
    expect(await hasLocalDoc('proj-unseen')).toBe(false);

    const doc = new Y.Doc();
    const p = await bindLocalPersistence('proj-seen', doc);
    doc.getMap('pages').set('p', 1);
    await p.whenSynced;
    p.destroy();

    expect(await hasLocalDoc('proj-seen')).toBe(true);
  });

  it('keeps projects isolated by name', async () => {
    const docA = new Y.Doc();
    const pA = await bindLocalPersistence('proj-a', docA);
    docA.getMap('pages').set('only-in-a', true);
    await pA.whenSynced;
    pA.destroy();

    const docB = new Y.Doc();
    const pB = await bindLocalPersistence('proj-b', docB);
    await pB.whenSynced;
    expect(docB.getMap('pages').get('only-in-a')).toBeUndefined();
    pB.destroy();
  });
});
