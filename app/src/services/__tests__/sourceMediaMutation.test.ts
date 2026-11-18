import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceMediaMutation } from '../sourceMediaMutation';
import { tryAcquireStructuralWrite, releaseStructuralWrite, _resetStructuralWriteInFlightForTests } from '@/store/structuralWriteGuard';

const location = { file: 'src/pages/index.astro', line: 2, column: 3 };
const origin = { armed: true, pageFile: location.file };
const imageFill = { expectedTag: '<img src="/a.png" class="h-24 w-24">', change: { type: 'fit' as const, value: 'contain' as const } };
const receipt = { changed: true, replacedLine: 2, originalLineCount: 1, replacedLineCount: 1, originalSegment: '  <img src="/a.png">\n', replacementSegment: '  <div></div>\n' };
const request = { location, kind: 'image-fill' as const, src: '', imageFill, origin, isCurrent: () => true };

beforeEach(() => _resetStructuralWriteInFlightForTests());

describe('sourceMediaMutation owner', () => {
  it('holds the shared structural guard and records exact inverse only after ACK', async () => {
    let acknowledge!: (value: typeof receipt) => void;
    const writeTagSwap = vi.fn(() => new Promise<typeof receipt>(resolve => { acknowledge = resolve; }));
    const pushUndo = vi.fn();
    const pending = sourceMediaMutation(request, pushUndo, { writeTagSwap });
    await new Promise((r) => setTimeout(r, 0)); // its turn (the guard was free)
    expect(tryAcquireStructuralWrite()).toBe(false);
    expect(pushUndo).not.toHaveBeenCalled();
    expect(writeTagSwap).toHaveBeenCalledWith(location, 'image-fill', '', imageFill, origin, undefined);
    acknowledge(receipt);
    expect(await pending).toEqual(receipt);
    const loc = { ...location, line: 2, column: 1 };
    expect(pushUndo).toHaveBeenCalledExactlyOnceWith({ structuralOp: {
      inverse: [{ kind: 'restore-region', loc, lineCount: 1, segment: receipt.originalSegment }],
      forward: [{ kind: 'restore-region', loc, lineCount: 1, segment: receipt.replacementSegment }],
    } });
    expect(tryAcquireStructuralWrite()).toBe(true); releaseStructuralWrite();
  });

  it.each([false, { changed: false }])('records no Undo for a refused or unchanged response', async value => {
    const pushUndo = vi.fn();
    await sourceMediaMutation(request, pushUndo, { writeTagSwap: vi.fn().mockResolvedValue(value) });
    expect(pushUndo).not.toHaveBeenCalled();
    expect(tryAcquireStructuralWrite()).toBe(true); releaseStructuralWrite();
  });

  it('releases the guard on failure with no Undo entry', async () => {
    const pushUndo = vi.fn();
    await expect(sourceMediaMutation(request, pushUndo, { writeTagSwap: vi.fn().mockRejectedValue(new Error('source changed')) })).rejects.toThrow('source changed');
    expect(pushUndo).not.toHaveBeenCalled();
    expect(tryAcquireStructuralWrite()).toBe(true); releaseStructuralWrite();
  });

  it('refuses a stale upload owner before starting the source write', async () => {
    const writeTagSwap = vi.fn();
    await expect(sourceMediaMutation({ ...request, isCurrent: () => false }, vi.fn(), { writeTagSwap })).rejects.toThrow(/selection changed/i);
    expect(writeTagSwap).not.toHaveBeenCalled();
  });

  // Owner 2026-11-10: no refusal — it waits its turn, never touching the other owner's guard.
  it('a concurrent structural gesture waits its turn without releasing another owner’s guard', async () => {
    expect(tryAcquireStructuralWrite()).toBe(true);
    const writeTagSwap = vi.fn(async () => receipt);
    const pending = sourceMediaMutation(request, vi.fn(), { writeTagSwap });
    await new Promise((r) => setTimeout(r, 0));
    expect(writeTagSwap).not.toHaveBeenCalled();
    expect(tryAcquireStructuralWrite()).toBe(false); // still the other owner's
    releaseStructuralWrite(); // the other owner finishes
    expect(await pending).toEqual(receipt);
    expect(tryAcquireStructuralWrite()).toBe(true); releaseStructuralWrite();
  });
});
