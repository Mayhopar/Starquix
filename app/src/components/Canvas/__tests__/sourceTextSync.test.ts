/**
 * Regression guard for the round-5 defect: a text override re-added by ⌘Z after
 * a Reset did not repaint, because the observer's prev-value cache was pruned
 * ONLY inside the `isUndoing` branch and a Reset is a `'sync'` transaction.
 *
 * Case 1 REPRODUCES the defect end to end (Reset → ⌘Z must yield a repaint).
 * The rest pin the pieces, including the two tiers that never had the bug.
 */
import { describe, it, expect } from 'vitest';
import { diffSourceText } from '../sourceTextSync';

const KEY = 'src/components/Feature.astro:20:5~p4317f4b4863ead18';
const OVERRIDE = '\n1';
const OTHER = 'src/components/Footer.astro:3:1~pdeadbeefdeadbeef';

describe('diffSourceText — the Reset → ⌘Z sequence', () => {
  it('re-adding the SAME text after a non-undo removal still repaints', () => {
    // 1. the user types an override
    const first = diffSourceText({}, { [KEY]: OVERRIDE }, false);
    expect(first.changed).toEqual([{ key: KEY, textContent: OVERRIDE }]);

    // 2. Reset — a 'sync' transaction, NOT an undo. The doc entry is gone.
    const reset = diffSourceText(first.nextPrev, {}, false);
    expect(reset.removed).toEqual([]); // no RESTORE: a Reset reloads the frame itself
    // THE FIX: the cache must not keep the discarded value.
    expect(reset.nextPrev).toEqual({});
    expect(KEY in reset.nextPrev).toBe(false);

    // 3. ⌘Z re-inserts EXACTLY the discarded string. Before the fix the stale
    //    cache entry made this compare equal and the observer emitted nothing.
    const undo = diffSourceText(reset.nextPrev, { [KEY]: OVERRIDE }, true);
    expect(undo.changed).toEqual([{ key: KEY, textContent: OVERRIDE }]);
  });

  it('the cache is rebuilt from the doc, never merged — even when nothing changed', () => {
    const prev = { [KEY]: OVERRIDE, [OTHER]: 'x' };
    const plan = diffSourceText(prev, { [KEY]: OVERRIDE }, false);
    expect(plan.changed).toEqual([]);
    expect(plan.nextPrev).toEqual({ [KEY]: OVERRIDE });
    expect(OTHER in plan.nextPrev).toBe(false);
  });

  it('does not mutate the cache it was given', () => {
    const prev = { [KEY]: OVERRIDE };
    const plan = diffSourceText(prev, {}, true);
    expect(prev).toEqual({ [KEY]: OVERRIDE });
    expect(plan.nextPrev).not.toBe(prev);
  });
});

describe('diffSourceText — removal semantics', () => {
  it('reports a removed key as a RESTORE target during undo', () => {
    const plan = diffSourceText({ [KEY]: OVERRIDE }, {}, true);
    expect(plan.removed).toEqual([KEY]);
    expect(plan.nextPrev).toEqual({});
  });

  it('reports NO restore outside undo, but still prunes', () => {
    const plan = diffSourceText({ [KEY]: OVERRIDE }, {}, false);
    expect(plan.removed).toEqual([]);
    expect(plan.nextPrev).toEqual({});
  });

  it('a value change is reported once, and not again on a repeat run', () => {
    const first = diffSourceText({ [KEY]: 'old' }, { [KEY]: 'new' }, false);
    expect(first.changed).toEqual([{ key: KEY, textContent: 'new' }]);
    const second = diffSourceText(first.nextPrev, { [KEY]: 'new' }, false);
    expect(second.changed).toEqual([]);
  });

  it('an empty string is a real value, not an absence', () => {
    const plan = diffSourceText({ [KEY]: OVERRIDE }, { [KEY]: '' }, true);
    expect(plan.changed).toEqual([{ key: KEY, textContent: '' }]);
    expect(plan.removed).toEqual([]);
  });
});
