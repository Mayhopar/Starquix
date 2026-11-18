/**
 * task-118 — useOrphanToast origin gate. Found in live verify: y-indexeddb
 * hydration re-adds persisted orphan keys on every project open (provider
 * OBJECT as transaction origin), and undo re-adds discarded records
 * ('undo' origin) — neither is a new orphaning and neither may toast.
 * Live command paths DO toast: bare applyCommand (origin null, the task-117
 * live-sync path) and useDispatch (origin 'user').
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { useOrphanToast } from './useOrphanToast';
import { getOrphansMap } from '@/store/overrideOrphans';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, toast: vi.fn() }));

vi.mock('react-hot-toast', () => ({ default: h.toast }));
vi.mock('@/store/hooks', () => ({ useEditorDoc: () => h.doc }));

const orphan = (sel: string) => ({
  astroSource: 'library/CTA.astro',
  instanceId: 'el-1',
  oldSelector: sel,
  fingerprint: { tag: 'div', text: '', className: '' },
  entries: [{ store: 'classOverrides', key: sel, value: {} }],
});

describe('useOrphanToast', () => {
  beforeEach(() => {
    h.doc = new Y.Doc();
    h.toast.mockClear();
  });

  it('toasts on a live orphaning (null origin — the live-sync applyCommand path)', () => {
    renderHook(() => useOrphanToast());
    h.doc.transact(() => getOrphansMap(h.doc).set('o-1', orphan('div-0')));
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0]).toContain('orphaned in CTA');
  });

  it('toasts on a user-dispatched orphaning (string origin)', () => {
    renderHook(() => useOrphanToast());
    h.doc.transact(() => getOrphansMap(h.doc).set('o-1', orphan('div-0')), 'user');
    expect(h.toast).toHaveBeenCalledTimes(1);
  });

  it('stays silent on hydration (provider object origin) — no stale-orphan toast on project open', () => {
    renderHook(() => useOrphanToast());
    const provider = { name: 'y-indexeddb' };
    h.doc.transact(() => getOrphansMap(h.doc).set('o-1', orphan('div-0')), provider);
    expect(h.toast).not.toHaveBeenCalled();
  });

  it("stays silent on undo restore ('undo' origin)", () => {
    renderHook(() => useOrphanToast());
    h.doc.transact(() => getOrphansMap(h.doc).set('o-1', orphan('div-0')), 'undo');
    expect(h.toast).not.toHaveBeenCalled();
  });

  it('one toast per component with the count, not one per orphan', () => {
    renderHook(() => useOrphanToast());
    h.doc.transact(() => {
      getOrphansMap(h.doc).set('o-1', orphan('div-0'));
      getOrphansMap(h.doc).set('o-2', orphan('p-0'));
    });
    expect(h.toast).toHaveBeenCalledTimes(1);
    expect(h.toast.mock.calls[0][0]).toContain('2 overrides orphaned in CTA');
  });

  it('deletes (discard) never toast', () => {
    renderHook(() => useOrphanToast());
    h.doc.transact(() => getOrphansMap(h.doc).set('o-1', orphan('div-0')));
    h.toast.mockClear();
    h.doc.transact(() => getOrphansMap(h.doc).delete('o-1'));
    expect(h.toast).not.toHaveBeenCalled();
  });
});
