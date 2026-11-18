/**
 * Content editor — the whole-body undo op.
 *
 * A post-body edit rewrites the whole body through contentOps.updatePost, so the
 * inverse is the previous body verbatim. That makes it immune to the splice
 * asymmetry that makes a mid-line insert's inverse dangerous (task-133), which
 * is exactly why it is NOT modelled as insert/restore-region.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updatePost = vi.fn();
vi.mock('@/core/collections/content-ops', () => ({
  contentOps: { updatePost: (...args: unknown[]) => updatePost(...args) },
}));

import { replayStructuralOps, type StructuralOp, type StructuralReplayWriter } from '../structuralUndo';

/** Every writer method must go UNUSED — a content-body op is not a span inside
 *  a page, so it must not reach the structural write channel. */
const writer = {
  writeInsert: vi.fn(), writeAppendPage: vi.fn(), writeRemove: vi.fn(), writeMove: vi.fn(),
  writeImport: vi.fn(), writeRestore: vi.fn(), writeRestoreRegion: vi.fn(),
} as unknown as StructuralReplayWriter;

const op = (body: string): StructuralOp => ({ kind: 'content-body', collection: 'works', slug: 'post', body });

beforeEach(() => {
  updatePost.mockReset().mockResolvedValue(undefined);
  for (const fn of Object.values(writer as unknown as Record<string, ReturnType<typeof vi.fn>>)) fn.mockReset();
});

describe('content-body replay', () => {
  it('writes the body through contentOps, never through the structural writer', async () => {
    expect(await replayStructuralOps([op('new body')], writer)).toBe('ok');
    expect(updatePost).toHaveBeenCalledWith('works', 'post', {}, 'new body');
    for (const fn of Object.values(writer as unknown as Record<string, ReturnType<typeof vi.fn>>)) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it('sends an EMPTY frontmatter so every original frontmatter line survives', async () => {
    // The host merge keeps any key not present in the incoming object; omitting
    // the key entirely instead truncates the file.
    await replayStructuralOps([op('b')], writer);
    expect(updatePost.mock.calls[0][2]).toEqual({});
  });

  it('an undo→redo round trip restores each body exactly', async () => {
    await replayStructuralOps([op('before')], writer);   // undo
    await replayStructuralOps([op('after')], writer);    // redo
    expect(updatePost.mock.calls.map(c => c[3])).toEqual(['before', 'after']);
  });

  it('reports failure when the write throws, instead of claiming success', async () => {
    updatePost.mockRejectedValue(new Error('EACCES'));
    expect(await replayStructuralOps([op('x')], writer)).toBe('failed');
  });
});
