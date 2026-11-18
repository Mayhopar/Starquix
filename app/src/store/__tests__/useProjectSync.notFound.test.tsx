/**
 * An id with no Dexie row is not a project on this device — a stale bookmark
 * (the removed host-folder disk's `local_…` urls), a wiped browser, a typo.
 * That is a redirect to the Projects page, never the recovery banner: the
 * user cannot "retry" a project that does not exist. Ledger case 1 in
 * docs/plans/2026-09-10-remove-open-local-folder-design.md.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createEditorDoc } from '../createEditorDoc';
import { useProjectSync, ProjectNotFoundError } from '../useProjectSync';

describe.each(['local_1abc2', 'browser_nope', 'legacy-typo'])('useProjectSync with unknown id %s', (projectId) => {
  it('reports ProjectNotFoundError instead of a generic load failure', async () => {
    const onError = vi.fn();
    const onLoaded = vi.fn();
    renderHook(() => useProjectSync({ projectId, doc: createEditorDoc(), onLoaded, onError }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    const err = onError.mock.calls[0][0] as Error;
    expect(err).toBeInstanceOf(ProjectNotFoundError);
    expect(err.message).not.toMatch(/IndexedDB/);
    expect(onLoaded).not.toHaveBeenCalled();
  });
});
