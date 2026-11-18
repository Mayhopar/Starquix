// task-086 Phase 1: local-first load path. Session 1 imports the legacy
// Dexie project into the doc (y-indexeddb persists it); session 2 loads from
// y-indexeddb even with the legacy stores wiped, and Dexie writers are gated
// off for durable projects.
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { describe, it, expect, beforeAll } from 'vitest';
import { createEditorDoc } from '../createEditorDoc';
import { db } from '@/db';
import {
  loadBrowserProjectLocalFirst,
} from '../useProjectSync';
import { COMPONENT_EDITOR_PAGE_ID } from '../constants';
import { autoMigration } from '@/store/useProjectSync';

const PID = 'browser_localfirst-1';

async function seedLegacy(projectId: string) {
  await db.projects.put({
    id: projectId,
    name: 'LF Project',
    pagesTree: [{ id: 'pg1', children: [] }],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.pages.put({
    id: 'pg1',
    projectId,
    name: 'Home',
    components: [],
    metadata: { fonts: [] },
  });
}

const flushIdb = () => new Promise((r) => setTimeout(r, 100));

autoMigration.enabled = false; // Phase 6.2: these test the doc-truth load path itself

describe('local-first load path', () => {
  beforeAll(async () => {
    await seedLegacy(PID);
  });

  it('session 1 migrates from legacy, session 2 loads from y-indexeddb with legacy wiped', async () => {
    const docA = createEditorDoc();
    const r1 = await loadBrowserProjectLocalFirst(PID, docA);
    expect(r1.source).toBe('fresh-migration');
    expect(r1.project._id).toBe(PID);
    expect((docA.getMap('pages').get('pg1') as Y.Map<unknown>).get('name')).toBe('Home');

    // Session-1 edit that only the doc knows about.
    (docA.getMap('pages').get('pg1') as Y.Map<unknown>).set('name', 'Renamed');
    await flushIdb();
    r1.handle.destroy();

    // Wipe the legacy stores — session 2 must not need them.
    await db.pages.clear();
    await db.projects.clear();

    const docB = createEditorDoc();
    const r2 = await loadBrowserProjectLocalFirst(PID, docB);
    expect(r2.source).toBe('from-local');
    expect((docB.getMap('pages').get('pg1') as Y.Map<unknown>).get('name')).toBe('Renamed');
    expect(r2.project._id).toBe(PID);
    // Meta invariants must hold regardless of which side won the seed-vs-
    // restore Y.Map merge (createEditorDoc pre-seeds nulls before sync).
    expect(docB.getMap('meta').get('projectId')).toBe(PID);
    expect(docB.getMap('meta').get('currentPageId')).toBe('pg1');
    r2.handle.destroy();
  });

  it('drops the ephemeral component-editor page on load', async () => {
    const pid = 'browser_localfirst-ephemeral';
    await seedLegacy(pid);

    const docA = createEditorDoc();
    const r1 = await loadBrowserProjectLocalFirst(pid, docA);
    // Simulate a component-editor session leaking its ephemeral page into the doc.
    const ePage = new Y.Map();
    ePage.set('id', COMPONENT_EDITOR_PAGE_ID);
    ePage.set('name', 'Component Editor');
    docA.getMap('pages').set(COMPONENT_EDITOR_PAGE_ID, ePage);
    docA.getArray('rootPages').push([COMPONENT_EDITOR_PAGE_ID]);
    await flushIdb();
    r1.handle.destroy();

    const docB = createEditorDoc();
    const r2 = await loadBrowserProjectLocalFirst(pid, docB);
    expect(docB.getMap('pages').has(COMPONENT_EDITOR_PAGE_ID)).toBe(false);
    expect(docB.getArray('rootPages').toArray()).not.toContain(COMPONENT_EDITOR_PAGE_ID);
    r2.handle.destroy();
  });

});
