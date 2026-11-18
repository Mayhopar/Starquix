import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  crossFile: vi.fn(), notifyCrossFile: vi.fn(), markStale: vi.fn(), settle: vi.fn(), current: vi.fn(),
  read: vi.fn(), commit: vi.fn(), acquire: vi.fn(), release: vi.fn(), order: [] as string[],
}));

vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
vi.mock('@/utils/localWriteScope', () => ({
  captureLocalElementOrigin: () => ({ armed: true, pageFile: 'src/pages/index.astro' }),
  isCrossFileAtOrigin: h.crossFile, notifyLocalCrossFileWrite: h.notifyCrossFile,
}));
vi.mock('@/utils/localPageSync', () => ({ markLocalScanStaleAfterWrite: h.markStale }));
vi.mock('@/utils/localElementSource', () => ({ readLocalFile: h.read }));
vi.mock('@/utils/acceptedSource', () => ({ settleAcceptedWrites: h.settle, currentSourceLocation: h.current }));
vi.mock('@/store/structuralWriteGuard', () => ({ acquireStructuralWrite: h.acquire, releaseStructuralWrite: h.release }));
vi.mock('../localBlogBind', () => ({ commitWholeLocalFile: h.commit }));

import { addElementLink } from '../localLinkEdit';

const FILE = 'src/pages/index.astro';
const SOURCE = `<main>\n  <h2>Title</h2>\n</main>\n`;
const H2 = { key: `${FILE}:2:3`, tagName: 'h2', sourceLocation: { file: FILE, line: 2, column: 3 } };

describe('addElementLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.order.length = 0;
    h.crossFile.mockReturnValue(false);
    h.acquire.mockImplementation(async () => { h.order.push('turn'); });
    h.settle.mockImplementation(async () => { h.order.push('settle'); });
    h.current.mockImplementation(async (loc: unknown) => loc);
    h.read.mockImplementation(async () => { h.order.push('read'); return SOURCE; });
    h.commit.mockResolvedValue({ ok: true });
  });

  it('writes the whole file once, with its undo', async () => {
    const pushUndo = vi.fn();
    expect(await addElementLink(H2, pushUndo)).toBe(true);
    expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({
      file: FILE, before: SOURCE, after: `<main>\n  <a href="/"><h2>Title</h2></a>\n</main>\n`, pushUndo,
    }));
    expect(h.markStale).toHaveBeenCalled();
    expect(h.release).toHaveBeenCalled();
  });

  it('a flex or grid parent gets the transparent link box', async () => {
    await addElementLink({ ...H2, parentDisplay: 'inline-flex' }, vi.fn());
    expect(h.commit.mock.calls[0][0].after).toContain('<a href="/" class="contents"><h2>');
  });

  it("a shared component's file is refused with the standard route out, nothing read", async () => {
    h.crossFile.mockReturnValue(true);
    expect(await addElementLink(H2, vi.fn())).toBe(false);
    expect(h.notifyCrossFile).toHaveBeenCalledWith(FILE);
    expect(h.read).not.toHaveBeenCalled();
  });

  // Caught live: the second of two quick edits read its positions from the scan
  // before the first; the element's key was computed wrong and the selection
  // lost. Owner 2026-11-10: no refusal — it waits its turn, disk catches up,
  // and the position is moved through the edit accepted ahead of it.
  it('right behind another write: waits its turn, settles disk, follows the element — no refusal', async () => {
    const AFTER_FIRST = `<main>\n  <p>new</p>\n  <h2>Title</h2>\n</main>\n`;
    h.read.mockImplementation(async () => { h.order.push('read'); return AFTER_FIRST; });
    h.current.mockResolvedValue({ ...H2.sourceLocation, line: 3 }); // the h2 moved one line down
    expect(await addElementLink(H2, vi.fn())).toBe(true);
    expect(h.order).toEqual(['turn', 'settle', 'read']);
    expect(h.commit.mock.calls[0][0].after).toBe(`<main>\n  <p>new</p>\n  <a href="/"><h2>Title</h2></a>\n</main>\n`);
  });

  it('the element is gone by its turn → nothing written, no message', async () => {
    h.current.mockResolvedValue(null);
    expect(await addElementLink(H2, vi.fn())).toBe(false);
    expect(h.commit).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalled();
  });
});
