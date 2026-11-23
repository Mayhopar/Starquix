/** task-120 (4.2) — hoveredRect external store: identity-guarded set + subscribe. */
import { describe, it, expect } from 'vitest';
import { hoverRectStore } from '../hoverRectStore';

describe('hoverRectStore', () => {
  it('notifies subscribers on change, skips identical reference', () => {
    let calls = 0;
    const unsub = hoverRectStore.subscribe(() => calls++);
    const info = { rect: { top: 1, left: 2, width: 3, height: 4 }, key: 'k1', tagName: 'img' };
    hoverRectStore.set(info);
    expect(calls).toBe(1);
    expect(hoverRectStore.get()).toBe(info);
    hoverRectStore.set(info); // same reference → no notify
    expect(calls).toBe(1);
    hoverRectStore.set(null);
    expect(calls).toBe(2);
    unsub();
    hoverRectStore.set(info);
    expect(calls).toBe(2);
    hoverRectStore.set(null);
  });
});
