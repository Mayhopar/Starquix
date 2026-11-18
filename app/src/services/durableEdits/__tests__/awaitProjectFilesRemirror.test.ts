// @vitest-environment node
// Audit 2026-10-18 (f): Export/deploy/git read the Dexie rows after
// awaitProjectFiles. A journal entry the mirror never saw (restart, lost tail)
// left those rows stale, so the last step re-reads the disk.
import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';

const h = vi.hoisted(() => ({ order: [] as string[] }));
vi.mock('@/services/desktopDriver', () => ({
  isDesktop: () => true,
  desktopDriver: { remirror: vi.fn(async (id: string) => { h.order.push(`remirror:${id}`); }) },
}));
vi.mock('@/services/filesTruthSync', () => ({ syncChangedFiles: vi.fn(async () => { h.order.push('journal'); }) }));
import { awaitProjectFiles } from '../sourceMaterialization';

beforeEach(async () => { await db.delete(); await db.open(); h.order = []; });

it('re-reads the disk into the rows after accepted edits and the journal have landed', async () => {
  await awaitProjectFiles('browser_remirror');
  expect(h.order).toEqual(['journal', 'remirror:browser_remirror']);
});
