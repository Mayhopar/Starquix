import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { describe, it, expect, vi } from 'vitest';
import {
  loadDocLocalFirst,
  isDocMigrated,
  MIGRATED_FLAG,
  repairMetaAfterRestore,
} from '../migrateLegacyToYDoc';

describe('loadDocLocalFirst (legacy → Y.Doc migration)', () => {
  it('first open runs the legacy loader, stamps the flag, and persists', async () => {
    const doc = new Y.Doc();
    const legacyLoader = vi.fn((d: Y.Doc) => {
      d.getMap('pages').set('page-1', 'from-legacy');
    });

    const { handle, source } = await loadDocLocalFirst('proj-mig', doc, legacyLoader);
    expect(source).toBe('fresh-migration');
    expect(legacyLoader).toHaveBeenCalledOnce();
    expect(doc.getMap('pages').get('page-1')).toBe('from-legacy');
    expect(isDocMigrated(doc)).toBe(true);

    // let y-indexeddb flush the update, then release
    await new Promise((r) => setTimeout(r, 50));
    handle.destroy();
  });

  it('second open loads from y-indexeddb and NEVER calls the legacy loader', async () => {
    const throwingLoader = vi.fn(() => {
      throw new Error('legacy loader must not run for a migrated project');
    });

    const doc = new Y.Doc();
    const { handle, source } = await loadDocLocalFirst('proj-mig', doc, throwingLoader);
    expect(source).toBe('from-local');
    expect(throwingLoader).not.toHaveBeenCalled();
    // data came from y-indexeddb (seeded by the previous test's project)
    expect(doc.getMap('pages').get('page-1')).toBe('from-legacy');
    expect(isDocMigrated(doc)).toBe(true);
    handle.destroy();
  });

  it('a local doc without the flag (partial write) re-imports from legacy', async () => {
    // Seed a doc that has data but no migration flag.
    const seed = new Y.Doc();
    const { handle: seedHandle } = await loadDocLocalFirst('proj-partial', seed, (d) => {
      d.getMap('pages').set('stale', true);
    });
    seed.getMap('meta').delete(MIGRATED_FLAG);
    await new Promise((r) => setTimeout(r, 50));
    seedHandle.destroy();

    const doc = new Y.Doc();
    const legacyLoader = vi.fn((d: Y.Doc) => {
      d.getMap('pages').set('reimported', true);
    });
    const { handle, source } = await loadDocLocalFirst('proj-partial', doc, legacyLoader);
    expect(source).toBe('fresh-migration');
    expect(legacyLoader).toHaveBeenCalledOnce();
    expect(isDocMigrated(doc)).toBe(true);
    handle.destroy();
  });

  describe('repairMetaAfterRestore', () => {
    // createEditorDoc pre-seeds meta (projectId '', currentPageId null) on the
    // fresh doc BEFORE y-indexeddb merges the stored state in. Concurrent
    // Y.Map sets resolve by clientID — a coin flip per session — so the seeds
    // can clobber the restored values. The repair must make the outcome
    // deterministic. (Found live: reload landed with no page selected.)
    it('repairs a null/clobbered currentPageId to the first root page', () => {
      const doc = new Y.Doc();
      const meta = doc.getMap('meta');
      meta.set('projectId', '');
      meta.set('currentPageId', null);
      const page = new Y.Map();
      page.set('id', 'pg1');
      doc.getMap('pages').set('pg1', page);
      doc.getArray('rootPages').push(['pg1']);

      repairMetaAfterRestore(doc, 'proj-r', 'Fixed Name');
      expect(meta.get('projectId')).toBe('proj-r');
      expect(meta.get('currentPageId')).toBe('pg1');
      expect(meta.get('projectName')).toBe('Fixed Name');
    });

    it('repairs a currentPageId pointing at a deleted page', () => {
      const doc = new Y.Doc();
      doc.getMap('meta').set('currentPageId', 'gone');
      const page = new Y.Map();
      doc.getMap('pages').set('pg1', page);
      doc.getArray('rootPages').push(['pg1']);

      repairMetaAfterRestore(doc, 'proj-r');
      expect(doc.getMap('meta').get('currentPageId')).toBe('pg1');
    });

    it('leaves a valid currentPageId and existing name untouched', () => {
      const doc = new Y.Doc();
      const meta = doc.getMap('meta');
      meta.set('currentPageId', 'pg2');
      meta.set('projectName', 'Kept');
      doc.getMap('pages').set('pg1', new Y.Map());
      doc.getMap('pages').set('pg2', new Y.Map());
      doc.getArray('rootPages').push(['pg1', 'pg2']);

      repairMetaAfterRestore(doc, 'proj-r', 'Ignored Fallback');
      expect(meta.get('currentPageId')).toBe('pg2');
      expect(meta.get('projectName')).toBe('Kept');
    });
  });

  it('propagates legacy loader errors without stamping the flag', async () => {
    const doc = new Y.Doc();
    await expect(
      loadDocLocalFirst('proj-err', doc, () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(isDocMigrated(doc)).toBe(false);
  });
});
