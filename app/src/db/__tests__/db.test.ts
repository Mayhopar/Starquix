import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../index';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('db', () => {
  it('should create and read a project', async () => {
    const project = {
      id: 'test-1',
      name: 'My Project',
      pagesTree: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.projects.add(project);
    const result = await db.projects.get('test-1');
    expect(result?.name).toBe('My Project');
  });

  it('should query pages by projectId', async () => {
    await db.pages.bulkAdd([
      { id: 'p1', projectId: 'proj-1', name: 'Home', components: [], metadata: { fonts: [] } },
      { id: 'p2', projectId: 'proj-1', name: 'About', components: [], metadata: { fonts: [] } },
      { id: 'p3', projectId: 'proj-2', name: 'Other', components: [], metadata: { fonts: [] } },
    ]);
    const pages = await db.pages.where('projectId').equals('proj-1').toArray();
    expect(pages).toHaveLength(2);
  });

  it('should store and retrieve assets', async () => {
    await db.assets.add({
      id: 'a1',
      projectId: 'proj-1',
      name: 'test.txt',
      mimeType: 'text/plain',
      blob: new Blob(['hello'], { type: 'text/plain' }),
      createdAt: new Date(),
    });
    const asset = await db.assets.get('a1');
    expect(asset).toBeDefined();
    expect(asset!.name).toBe('test.txt');
    expect(asset!.mimeType).toBe('text/plain');
  });
});
