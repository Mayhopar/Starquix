import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db, renameProject } from '../index';

beforeEach(async () => {
  await db.delete();
  await db.open();
});

describe('renameProject', () => {
  const seed = async (updatedAt = new Date('2026-01-01T00:00:00Z')) => {
    await db.projects.add({
      id: 'proj-1',
      name: 'New Project',
      pagesTree: [],
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt,
    });
  };

  it('updates the name and bumps updatedAt', async () => {
    await seed();
    const before = (await db.projects.get('proj-1'))!.updatedAt.getTime();

    await renameProject('proj-1', 'Portfolio');

    const after = (await db.projects.get('proj-1'))!;
    expect(after.name).toBe('Portfolio');
    expect(after.updatedAt.getTime()).toBeGreaterThan(before);
  });

  it('trims surrounding whitespace', async () => {
    await seed();
    await renameProject('proj-1', '  Portfolio  ');
    expect((await db.projects.get('proj-1'))!.name).toBe('Portfolio');
  });

  it('rejects empty / whitespace-only names and leaves the record untouched', async () => {
    await seed();
    await expect(renameProject('proj-1', '   ')).rejects.toThrow(
      'Project name cannot be empty'
    );
    const after = (await db.projects.get('proj-1'))!;
    expect(after.name).toBe('New Project');
    expect(after.updatedAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not modify other fields', async () => {
    await seed();
    await renameProject('proj-1', 'Portfolio');
    const after = (await db.projects.get('proj-1'))!;
    expect(after.id).toBe('proj-1');
    expect(after.createdAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(after.pagesTree).toEqual([]);
  });
});
