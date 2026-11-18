/**
 * Regression: the page-switch flush must run BEFORE the surface changes.
 *
 * Editor used to flush in a `useEffect` on `currentPageId`, which runs AFTER
 * the React commit — by then ViewportFrame had already pointed the iframe at
 * the new route, so the class queue's flush (a postMessage into the preview)
 * raced the old document's teardown, and its lost-ack recovery then verified
 * against the NEW page's bytes (adversarial finding 16). The fix is a
 * synchronous Yjs observer (`armPageSwitchFlushBoundary`): Yjs update handlers
 * fire at the end of the transaction that changed `currentPageId`, before
 * React re-renders, so the boundary listeners (and with them the class queue's
 * flush) run while the OLD page is still the mounted surface.
 *
 * These tests pin the synchronous contract: with the old effect-based boundary
 * nothing here fires at all without a mounted React tree, and a re-async'd
 * boundary fails the "already fired when transact returns" assertions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  armPageSwitchFlushBoundary,
  subscribeFlushBoundary,
  clearPendingSourceWrites,
  flushPendingSourceWrites,
} from '../pendingSourceWrites';
import { selectCurrentPageId } from '@/store/selectors';

describe('armPageSwitchFlushBoundary', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    clearPendingSourceWrites();
    doc = new Y.Doc();
    doc.getMap('meta').set('currentPageId', 'page-a');
  });

  it('fires the flush boundary SYNCHRONOUSLY inside the page-switch transaction', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFlushBoundary(listener);
    const disarm = armPageSwitchFlushBoundary(doc, () => selectCurrentPageId(doc));

    doc.transact(() => {
      doc.getMap('meta').set('currentPageId', 'page-b');
    });
    // Synchronous: already fired when transact returns — no await, no timers.
    // This is what puts the class queue's postMessage write on the wire while
    // the old page's iframe document is still alive.
    expect(listener).toHaveBeenCalledTimes(1);

    disarm();
    unsubscribe();
  });

  it('does NOT fire on doc changes that leave the page id alone', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFlushBoundary(listener);
    const disarm = armPageSwitchFlushBoundary(doc, () => selectCurrentPageId(doc));

    doc.transact(() => {
      doc.getMap('meta').set('projectName', 'renamed');
    });
    // Re-setting the SAME page id is not a switch either.
    doc.transact(() => {
      doc.getMap('meta').set('currentPageId', 'page-a');
    });
    expect(listener).not.toHaveBeenCalled();

    disarm();
    unsubscribe();
  });

  it('the disarm stops the boundary', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFlushBoundary(listener);
    const disarm = armPageSwitchFlushBoundary(doc, () => selectCurrentPageId(doc));
    disarm();

    doc.transact(() => {
      doc.getMap('meta').set('currentPageId', 'page-b');
    });
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it('tracks across multiple switches (each fires once)', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFlushBoundary(listener);
    const disarm = armPageSwitchFlushBoundary(doc, () => selectCurrentPageId(doc));

    doc.transact(() => { doc.getMap('meta').set('currentPageId', 'page-b'); });
    doc.transact(() => { doc.getMap('meta').set('currentPageId', 'page-c'); });
    expect(listener).toHaveBeenCalledTimes(2);

    disarm();
    unsubscribe();
  });
});

it('awaits asynchronously acknowledged boundary work', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const off = subscribeFlushBoundary(() => pending);
  let settled = false;
  const flush = flushPendingSourceWrites().then(() => { settled = true; });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish();
  await flush;
  expect(settled).toBe(true);
  off();
});
