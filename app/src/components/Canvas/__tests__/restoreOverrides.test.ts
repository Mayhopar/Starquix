/**
 * task-151 — "put this element back the way the source renders it", in place.
 *
 * The undo observers ask for this when an overlay entry is REMOVED. Two halves
 * have to happen together, and the second one is the half a preview reload used
 * to do by accident:
 *
 * 1. tell the iframe to restore its captured pre-override baseline, and
 * 2. EVICT the key from ViewportFrame's pending class-update queue.
 *
 * Skipping (2) reproduces the round-4 defect exactly (see reloadPreview.ts):
 * every class edit is filed into those queues unconditionally, nothing drains
 * them until the next ELEMENTS_SCANNED, and that scan replays the queued payload
 * as UPDATE_CLASSES *before* the doc re-apply — resurrecting the value the undo
 * just discarded, minutes later, on an unrelated rescan.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestClassRestore,
  requestImageAttrRestore,
  applyClassRestore,
  applyImageAttrRestore,
  RESTORE_CLASSES_RELAY,
  RESTORE_IMAGE_ATTRS_RELAY,
} from '../restoreOverrides';

const KEY = 'src/components/Feature.astro:20:5~p4317f4b4863ead18';
const LOC = { file: 'src/components/Feature.astro', line: 20, column: 5 };

function fakeIframe() {
  const posted: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const iframe = {
    contentWindow: { postMessage: (m: unknown) => posted.push(m as never) },
  } as unknown as HTMLIFrameElement;
  return { iframe, posted };
}

describe('applyClassRestore', () => {
  it('posts RESTORE_ORIGINAL_CLASSES with the parent fallback', () => {
    const { iframe, posted } = fakeIframe();
    applyClassRestore(
      { iframe, pendingKeyUpdates: new Map() },
      { key: KEY, fallbackClasses: 'text-2xl font-bold', sourceLocation: LOC },
    );
    expect(posted).toEqual([
      { type: 'RESTORE_ORIGINAL_CLASSES', payload: { key: KEY, fallbackClasses: 'text-2xl font-bold' } },
    ]);
  });

  // task-181: there is ONE retry queue now, keyed by the full element key. The
  // `file:line` sibling map is gone, and with it the eviction that had to guess
  // which line-keyed entry belonged to this element — the sibling placement
  // `…#1` below is exactly what that guess used to take out by accident.
  it('evicts the discarded value by key, leaving other elements alone', () => {
    const { iframe } = fakeIframe();
    const pendingKeyUpdates = new Map<string, unknown>([
      [KEY, { key: KEY, classes: 'text-red-500' }],
      [`${KEY}#1`, { key: `${KEY}#1`, classes: 'text-violet-500' }],
      ['other', { key: 'other', classes: 'text-violet-500' }],
    ]);

    applyClassRestore(
      { iframe, pendingKeyUpdates },
      { key: KEY, fallbackClasses: '', sourceLocation: LOC },
    );

    expect([...pendingKeyUpdates.keys()]).toEqual([`${KEY}#1`, 'other']);
  });

  it('evicts by key even when the entry has no sourceLocation (dynamic elements)', () => {
    const { iframe } = fakeIframe();
    const pendingKeyUpdates = new Map<string, unknown>([[KEY, { key: KEY, classes: 'x' }]]);
    applyClassRestore(
      { iframe, pendingKeyUpdates },
      { key: KEY, fallbackClasses: '' },
    );
    expect(pendingKeyUpdates.size).toBe(0);
  });

  it('still clears the queues when no iframe is mounted', () => {
    const pendingKeyUpdates = new Map<string, unknown>([[KEY, { key: KEY, classes: 'x' }]]);
    applyClassRestore(
      { iframe: null, pendingKeyUpdates },
      { key: KEY, fallbackClasses: '' },
    );
    expect(pendingKeyUpdates.size).toBe(0);
  });
});

describe('applyImageAttrRestore', () => {
  it('posts RESTORE_ORIGINAL_IMAGE_ATTRIBUTES with the attributes the override touched', () => {
    const { iframe, posted } = fakeIframe();
    applyImageAttrRestore(iframe, { key: 'el-x:img-0', attributes: ['src', 'alt'] });
    expect(posted).toEqual([
      { type: 'RESTORE_ORIGINAL_IMAGE_ATTRIBUTES', payload: { key: 'el-x:img-0', attributes: ['src', 'alt'] } },
    ]);
  });
});

describe('the request side is a same-window relay, like every other *_TO_IFRAME', () => {
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {}); });
  afterEach(() => spy.mockRestore());

  it('requestClassRestore posts the relay type', () => {
    requestClassRestore({ key: KEY, fallbackClasses: 'a b', sourceLocation: LOC });
    expect(spy).toHaveBeenCalledWith(
      { type: RESTORE_CLASSES_RELAY, payload: { key: KEY, fallbackClasses: 'a b', sourceLocation: LOC } },
      '*',
    );
  });

  it('requestImageAttrRestore posts the relay type', () => {
    requestImageAttrRestore({ key: 'el-x:img-0', attributes: ['src'] });
    expect(spy).toHaveBeenCalledWith(
      { type: RESTORE_IMAGE_ATTRS_RELAY, payload: { key: 'el-x:img-0', attributes: ['src'] } },
      '*',
    );
  });
});
