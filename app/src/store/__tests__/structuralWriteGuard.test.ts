/**
 * Owner 2026-11-10: "there should be no refusals … nothing should be lost".
 * A second edit made while a file write is in flight used to be refused
 * ("Still saving the last change — try again in a moment", "Undo is busy").
 * It now waits its turn: first come, first served, never dropped.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  acquireStructuralWrite,
  tryAcquireStructuralWrite,
  releaseStructuralWrite,
  _resetStructuralWriteInFlightForTests,
} from '../structuralWriteGuard';

beforeEach(() => _resetStructuralWriteInFlightForTests());

describe('structural write guard', () => {
  it('free → a gesture gets it at once', async () => {
    await acquireStructuralWrite();
    expect(tryAcquireStructuralWrite()).toBe(false);
    releaseStructuralWrite();
    expect(tryAcquireStructuralWrite()).toBe(true);
  });

  it('busy → each gesture waits its turn, first come first served', async () => {
    await acquireStructuralWrite();
    const order: string[] = [];
    const a = acquireStructuralWrite().then(() => { order.push('a'); });
    const b = acquireStructuralWrite().then(() => { order.push('b'); });
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseStructuralWrite();
    await a;
    expect(order).toEqual(['a']);
    releaseStructuralWrite();
    await b;
    expect(order).toEqual(['a', 'b']);
    releaseStructuralWrite();
    expect(tryAcquireStructuralWrite()).toBe(true);
  });

  it('automatic background work (try) never jumps a waiting gesture', async () => {
    await acquireStructuralWrite();
    const waiting = acquireStructuralWrite();
    releaseStructuralWrite(); // handed straight to the waiting gesture
    expect(tryAcquireStructuralWrite()).toBe(false);
    await waiting;
    releaseStructuralWrite();
    expect(tryAcquireStructuralWrite()).toBe(true);
  });
});
