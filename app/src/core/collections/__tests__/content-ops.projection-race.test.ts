// Files-truth collection discovery vs the durable journal (2026-09-16).
// A post accepted by the journal is written into the container ~100ms later
// by the materializer. Reading the container BEFORE the projection window
// froze the journal rows left that post invisible: the disk read predated the
// write, and by the time the rows were frozen the row was already
// materialized, so it was not projected either. Live symptom: the auto-bound
// BlogSlot's Collection dropdown showed "None" (its list never held `blog`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { contentOps, setLocalContentSource } from '../content-ops';

const h = vi.hoisted(() => ({ disk: {} as Record<string, string> }));
vi.mock('@/utils/sqLocalBase', () => ({
  localFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ files: { ...h.disk } }) })),
}));
// The worker lands the accepted post while the rows are being frozen (the
// Dexie reads inside the window) — the row is materialized by the time `read`
// runs, so the projection has nothing to overlay.
vi.mock('@/services/durableEdits/acceptance', () => ({
  inspectAcceptedProject: async (_id: string, read: (rev: number) => Promise<unknown>) => {
    h.disk['src/content/blog/hello-world.mdx'] = '---\ntitle: "Hello world"\ndate: 2026-09-16\n---\nbody\n';
    return read(3);
  },
}));
vi.mock('@/services/durableEdits/projectedSource', () => ({
  withProjectedSource: async (_id: string, _rev: number, run: () => Promise<unknown>) => run(),
  projectedSourceFiles: () => [],
}));

beforeEach(() => { h.disk = {}; setLocalContentSource('wc://p'); });
afterEach(() => setLocalContentSource(null));

describe('files-truth collection discovery', () => {
  it('sees a post the worker materialized while the journal rows were being frozen', async () => {
    const cols = await contentOps.fetchCollections();
    expect(cols.map((c) => c.name)).toEqual(['blog']);
    expect(cols[0].inferredFields.map((f) => f.name)).toContain('date');
  });
});
