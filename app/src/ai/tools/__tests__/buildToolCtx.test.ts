import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { buildToolCtx, createBatchGuard } from '../buildToolCtx';
import { generateCommandTools } from '../commandTools';

function deps(over: Partial<Parameters<typeof buildToolCtx>[0]> = {}) {
  return {
    doc: new Y.Doc(), dispatch: vi.fn(async () => true), takeSnapshot: vi.fn(), claimSnapshot: vi.fn(),
    selectedElementKey: null, getScannedElements: () => [], getCurrentPageFile: () => null,
    pushStructuralUndo: vi.fn(), availability: { hasPexelsKey: false, hasImageGen: false },
    componentLibrary: [], layoutLibrary: [], history: { undo: vi.fn(), redo: vi.fn(), canUndo: () => false, canRedo: () => false },
    ...over,
  };
}

describe('buildToolCtx', () => {
  it('takes exactly one snapshot per batch via the shared once-guard', () => {
    const d = deps();
    const { ctx, batch } = buildToolCtx(d);
    ctx.takeSnapshot(); ctx.takeSnapshot();
    expect(d.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(batch.hasMutated()).toBe(true);
    expect(ctx.history.hasMutatedThisBatch()).toBe(true);
    batch.reset();
    ctx.takeSnapshot();
    expect(d.takeSnapshot).toHaveBeenCalledTimes(2);
  });
  it('deferred snapshot commits once via the returned committer', () => {
    const commit = vi.fn();
    const d = deps({ takeSnapshot: vi.fn(() => commit) as never });
    const { ctx, batch } = buildToolCtx(d);
    const c = ctx.takeSnapshot(undefined, undefined, true);
    expect(batch.hasMutated()).toBe(false);
    c?.(); c?.();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(batch.hasMutated()).toBe(true);
  });
  it('dispatch snapshots once then forwards with origin ai', async () => {
    const d = deps();
    const { ctx } = buildToolCtx(d);
    await ctx.dispatch({ type: 'X' } as never); await ctx.dispatch({ type: 'Y' } as never);
    expect(d.takeSnapshot).toHaveBeenCalledTimes(1);
    expect(d.dispatch).toHaveBeenCalledWith({ type: 'X' }, 'ai');
    expect(await ctx.dispatch({ type: 'Z' } as never)).toBe(true);
  });
  it('a shared batch guard survives a ctx rebuild (continue-run keeps one undo unit)', () => {
    const batch = createBatchGuard();
    const d = deps();
    buildToolCtx(d, batch).ctx.takeSnapshot();
    buildToolCtx(d, batch).ctx.takeSnapshot();
    expect(d.takeSnapshot).toHaveBeenCalledTimes(1);
  });
  it('yields the same tool names regardless of caller for equal availability', () => {
    const a = Object.keys(generateCommandTools(buildToolCtx(deps()).ctx)).sort();
    const b = Object.keys(generateCommandTools(buildToolCtx(deps()).ctx)).sort();
    expect(a).toEqual(b);
    expect(a).toContain('push_instance_to_source'); // no runtime gate
    expect(a).not.toContain('search_stock_images');
    expect(Object.keys(generateCommandTools(buildToolCtx(deps({ availability: { hasPexelsKey: true, hasImageGen: false } })).ctx))).toContain('search_stock_images');
  });
});
