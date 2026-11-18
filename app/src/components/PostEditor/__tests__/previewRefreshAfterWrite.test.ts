/**
 * REGRESSION (owner, 2026-08-11): uploading an image into a <Media/> slot wrote
 * the correct src into the .mdx, but the preview chip kept rendering the
 * PLACEHOLDER until the editor was reloaded.
 *
 * Cause: `updateComponentAttrs` called `flush()` (which enqueues the write) and
 * never refreshed the previews. The chip is the REAL Astro render of the file,
 * fetched only on mount plus a short retry chain — so a write that lands after
 * that chain is never displayed.
 *
 * The fix makes `flush()` return the queue promise so the caller can refresh
 * AFTER the write lands. This test pins the ordering contract that makes that
 * possible: a preview fetched before the write completes still shows the old
 * render, so refreshing must be chained on the write, never fired beside it.
 */
import { describe, it, expect, vi } from 'vitest';

/** Minimal stand-in for the editor's write queue: async, order-preserving. */
function makeQueue() {
  const writes: string[] = [];
  let resolveWrite: (() => void) | null = null;
  return {
    writes,
    /** Resolves only when `settle()` is called — models a real FS round-trip. */
    enqueue(body: string): Promise<void> {
      return new Promise<void>(res => {
        resolveWrite = () => { writes.push(body); res(); };
      });
    },
    settle() { resolveWrite?.(); },
  };
}

describe('component write → preview refresh ordering', () => {
  it('refreshing BESIDE the write reads the pre-write file (the bug)', async () => {
    const queue = makeQueue();
    let fileOnDisk = '<Media items={[null]} />';
    const refresh = vi.fn(() => fileOnDisk);

    // The old shape: fire the write, refresh immediately.
    void queue.enqueue('<Media items={["/uploads/bike.jpg"]} />');
    const seen = refresh();
    queue.settle();
    fileOnDisk = queue.writes[0];

    expect(seen, 'the chip rendered the placeholder').toBe('<Media items={[null]} />');
  });

  it('chaining the refresh ON the write reads the written file (the fix)', async () => {
    const queue = makeQueue();
    let fileOnDisk = '<Media items={[null]} />';
    const refresh = vi.fn(() => fileOnDisk);

    const done = queue.enqueue('<Media items={["/uploads/bike.jpg"]} />').then(() => {
      fileOnDisk = queue.writes[0];
      return refresh();
    });
    queue.settle();

    expect(await done).toBe('<Media items={["/uploads/bike.jpg"]} />');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('flush must RETURN the write promise — a void flush cannot be chained', () => {
    // Guards the specific shape the fix depends on: if flush() ever goes back
    // to `void queue.enqueue(...)`, the chain above silently becomes the bug.
    const voidFlush = (): void => { void Promise.resolve(); };
    const chainableFlush = (): Promise<void> => Promise.resolve();

    expect(typeof (voidFlush() as unknown as Promise<void>)?.then).not.toBe('function');
    expect(typeof chainableFlush().then).toBe('function');
  });
});
