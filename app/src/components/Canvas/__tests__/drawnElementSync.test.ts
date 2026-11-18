/**
 * Regression tests for drawn-element observer-driven sync (task-010).
 *
 * Pins the microtask-coalescing behavior introduced to keep the parent-side
 * diff walk O(1) per tick when N drawn elements are added across N separate
 * Yjs transactions. See systems.json `drawn-elements.knownIssues` and
 * `app/src/components/Canvas/drawnElementSync.ts` for context.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import {
  computeDrawnElementDiff,
  createMicrotaskCoalescer,
} from '../drawnElementSync';

function makeDrawn(
  doc: Y.Doc,
  key: string,
  pageId: string,
  isDrawn = true,
): void {
  const elements = doc.getMap('elements');
  const yEl = new Y.Map<unknown>();
  yEl.set('id', key);
  yEl.set('pageId', pageId);
  yEl.set('isDrawn', isDrawn);
  yEl.set('tag', 'div');
  elements.set(key, yEl);
}

describe('computeDrawnElementDiff', () => {
  it('returns added keys for drawn elements that are new this tick', () => {
    const doc = new Y.Doc();
    makeDrawn(doc, 'drawn-1', 'page-a');
    makeDrawn(doc, 'drawn-2', 'page-a');

    const diff = computeDrawnElementDiff(
      new Set<string>(),
      doc.getMap('elements'),
      'page-a',
    );

    expect(diff.added.sort()).toEqual(['drawn-1', 'drawn-2']);
    expect(diff.removed).toEqual([]);
    expect(diff.currentKeys.has('drawn-1')).toBe(true);
    expect(diff.currentKeys.has('drawn-2')).toBe(true);
  });

  it('returns removed keys for drawn elements that disappeared', () => {
    const doc = new Y.Doc();
    makeDrawn(doc, 'drawn-1', 'page-a');

    const diff = computeDrawnElementDiff(
      new Set(['drawn-1', 'drawn-old']),
      doc.getMap('elements'),
      'page-a',
    );

    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['drawn-old']);
  });

  it('skips elements not flagged isDrawn', () => {
    const doc = new Y.Doc();
    makeDrawn(doc, 'drawn-1', 'page-a');
    makeDrawn(doc, 'src-1', 'page-a', false);

    const diff = computeDrawnElementDiff(
      new Set<string>(),
      doc.getMap('elements'),
      'page-a',
    );

    expect(diff.added).toEqual(['drawn-1']);
    expect(diff.currentKeys.has('src-1')).toBe(false);
  });

  it('filters by current page id', () => {
    const doc = new Y.Doc();
    makeDrawn(doc, 'drawn-a', 'page-a');
    makeDrawn(doc, 'drawn-b', 'page-b');

    const diff = computeDrawnElementDiff(
      new Set<string>(),
      doc.getMap('elements'),
      'page-a',
    );

    expect(diff.added).toEqual(['drawn-a']);
    expect(diff.currentKeys.has('drawn-b')).toBe(false);
  });

  // task-107: pen node edits mutate staticMarkup IN PLACE — the key-set diff
  // alone never re-sends, leaving the iframe stale (and undo/redo dead).
  it('reports keys whose staticMarkup changed in place', () => {
    const doc = new Y.Doc();
    makeDrawn(doc, 'pen-1', 'page-a');
    makeDrawn(doc, 'drawn-2', 'page-a');
    const elements = doc.getMap('elements');
    (elements.get('pen-1') as Y.Map<unknown>).set('staticMarkup', '<svg>v1</svg>');

    const first = computeDrawnElementDiff(new Set<string>(), elements, 'page-a');
    expect(first.changed).toEqual([]); // added keys are not also "changed"

    (elements.get('pen-1') as Y.Map<unknown>).set('staticMarkup', '<svg>v2</svg>');
    const second = computeDrawnElementDiff(first.currentKeys, elements, 'page-a', first.currentMarkup);

    expect(second.added).toEqual([]);
    expect(second.changed).toEqual(['pen-1']); // drawn-2 (no markup) untouched
    expect(second.currentMarkup.get('pen-1')).toBe('<svg>v2</svg>');
  });

  it('does not report unchanged markup and evicts removed keys from the snapshot', () => {
    const doc = new Y.Doc();
    makeDrawn(doc, 'pen-1', 'page-a');
    const elements = doc.getMap('elements');
    (elements.get('pen-1') as Y.Map<unknown>).set('staticMarkup', '<svg>v1</svg>');

    const first = computeDrawnElementDiff(new Set<string>(), elements, 'page-a');
    const second = computeDrawnElementDiff(first.currentKeys, elements, 'page-a', first.currentMarkup);
    expect(second.changed).toEqual([]);

    elements.delete('pen-1');
    const third = computeDrawnElementDiff(second.currentKeys, elements, 'page-a', second.currentMarkup);
    expect(third.removed).toEqual(['pen-1']);
    expect(third.currentMarkup.has('pen-1')).toBe(false); // no snapshot leak
  });
});

describe('createMicrotaskCoalescer', () => {
  it('collapses multiple triggers in one tick into a single fn invocation', async () => {
    const fn = vi.fn();
    const coalescer = createMicrotaskCoalescer(fn);

    coalescer.trigger();
    coalescer.trigger();
    coalescer.trigger();

    // Sync — not yet flushed
    expect(fn).not.toHaveBeenCalled();
    expect(coalescer.isPending()).toBe(true);

    // Wait one microtask flush
    await Promise.resolve();

    expect(fn).toHaveBeenCalledTimes(1);
    expect(coalescer.isPending()).toBe(false);
  });

  it('reschedules after flush so subsequent triggers fire again', async () => {
    const fn = vi.fn();
    const coalescer = createMicrotaskCoalescer(fn);

    coalescer.trigger();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    coalescer.trigger();
    coalescer.trigger();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('flushSync runs pending fn immediately and clears the schedule', () => {
    const fn = vi.fn();
    const coalescer = createMicrotaskCoalescer(fn);

    coalescer.trigger();
    expect(coalescer.isPending()).toBe(true);

    coalescer.flushSync();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(coalescer.isPending()).toBe(false);
  });

  it('flushSync is a no-op when nothing is pending', () => {
    const fn = vi.fn();
    const coalescer = createMicrotaskCoalescer(fn);

    coalescer.flushSync();
    expect(fn).not.toHaveBeenCalled();
  });

  it('coalesces N separate Yjs transactions into a single diff walk', async () => {
    // This is the regression that motivated task-010: each unwrapped
    // ADD_DRAWN_ELEMENT dispatch fires observeDeep individually. Without
    // coalescing, an N-element burst across N transactions = N full doc
    // walks. With coalescing, all N transactions land in the same microtask
    // → one walk → one batched dispatch.
    const doc = new Y.Doc();
    const elements = doc.getMap('elements');

    let prevKeys = new Set<string>();
    const flush = vi.fn(() => {
      const diff = computeDrawnElementDiff(prevKeys, elements, 'page-a');
      prevKeys = diff.currentKeys;
    });

    const coalescer = createMicrotaskCoalescer(flush);
    elements.observeDeep(() => coalescer.trigger());

    // 5 separate transactions (no doc.transact wrapper).
    makeDrawn(doc, 'drawn-1', 'page-a');
    makeDrawn(doc, 'drawn-2', 'page-a');
    makeDrawn(doc, 'drawn-3', 'page-a');
    makeDrawn(doc, 'drawn-4', 'page-a');
    makeDrawn(doc, 'drawn-5', 'page-a');

    // Yjs has fired observeDeep 5 times, but coalescer should have flushed 0.
    expect(flush).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(prevKeys.size).toBe(5);
  });
});
