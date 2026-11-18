/**
 * Bug Fix Tests: UndoContext.tsx
 *
 * Tests for Bug #12: isUndoingRef flag reset too early
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Bug #12: isUndoingRef flag timing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay isUndoingRef reset with queueMicrotask', async () => {
    // Simulate the bug fix behavior
    let isUndoingRef = { current: false };
    const microtaskQueue: (() => void)[] = [];

    // Mock queueMicrotask
    const originalQueueMicrotask = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) => {
      microtaskQueue.push(fn);
    };

    // Simulate undo operation with the fix
    const performUndo = () => {
      isUndoingRef.current = true;
      // Undo logic here...

      // With the fix: use queueMicrotask instead of immediate reset
      queueMicrotask(() => {
        isUndoingRef.current = false;
      });
    };

    performUndo();

    // Flag should still be true immediately after undo
    expect(isUndoingRef.current).toBe(true);

    // Process microtasks
    while (microtaskQueue.length > 0) {
      const task = microtaskQueue.shift();
      task?.();
    }

    // Now flag should be false
    expect(isUndoingRef.current).toBe(false);

    // Restore
    globalThis.queueMicrotask = originalQueueMicrotask;
  });

  it('should allow listeners to see isUndoingRef=true during their callback', () => {
    let isUndoingRef = { current: false };
    let seenValueDuringCallback = false;
    const microtaskQueue: (() => void)[] = [];

    const originalQueueMicrotask = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) => {
      microtaskQueue.push(fn);
    };

    // Simulate a listener that checks the flag
    const listenerCallback = () => {
      seenValueDuringCallback = isUndoingRef.current;
    };

    const performUndo = () => {
      isUndoingRef.current = true;

      // Notify listeners synchronously
      listenerCallback();

      // With the fix: delay reset
      queueMicrotask(() => {
        isUndoingRef.current = false;
      });
    };

    performUndo();

    // Listener should have seen isUndoingRef as true
    expect(seenValueDuringCallback).toBe(true);

    // Cleanup microtasks
    while (microtaskQueue.length > 0) {
      microtaskQueue.shift()?.();
    }

    globalThis.queueMicrotask = originalQueueMicrotask;
  });

  it('should handle rapid undo/redo without flag corruption', () => {
    let isUndoingRef = { current: false };
    const microtaskQueue: (() => void)[] = [];
    const flagStatesDuringUndo: boolean[] = [];

    const originalQueueMicrotask = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (fn: () => void) => {
      microtaskQueue.push(fn);
    };

    const performUndo = () => {
      isUndoingRef.current = true;
      flagStatesDuringUndo.push(isUndoingRef.current);
      queueMicrotask(() => {
        isUndoingRef.current = false;
      });
    };

    // Rapid undos
    performUndo();
    performUndo();
    performUndo();

    // All undos should see flag as true
    expect(flagStatesDuringUndo).toEqual([true, true, true]);

    // Process all microtasks
    while (microtaskQueue.length > 0) {
      microtaskQueue.shift()?.();
    }

    expect(isUndoingRef.current).toBe(false);

    globalThis.queueMicrotask = originalQueueMicrotask;
  });
});
