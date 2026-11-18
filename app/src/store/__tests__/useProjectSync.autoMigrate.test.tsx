import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { renderHook, waitFor } from '@testing-library/react';
import { db } from '@/db';
import { useProjectSync, autoMigration, ProjectNotFoundError } from '../useProjectSync';

beforeEach(async () => { await db.delete(); await db.open(); autoMigration.enabled = true; });

// The desktop app cannot convert a doc-truth project in place (the converter
// ran in the retired browser runtime): opening one surfaces an actionable
// error that leaves the editor for Projects (a ProjectNotFoundError, never the
// recovery boundary — that dead-ended in a retry loop) and names the way in.
describe('a doc-truth browser_ project from the retired browser runtime', () => {
  it('surfaces the Export-then-Import error; onLoaded never fires and the page does not reload', async () => {
    await db.projects.add({ id: 'browser_a', name: 'A', pagesTree: [], createdAt: new Date(), updatedAt: new Date() });
    const reload = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, 'location', { value: { ...orig, reload }, writable: true });
    const onLoaded = vi.fn();
    const onError = vi.fn();
    try {
      renderHook(() => useProjectSync({ projectId: 'browser_a', doc: new Y.Doc(), onLoaded, onError }));
      await waitFor(() => expect(onError).toHaveBeenCalled());
      const err = onError.mock.calls[0][0];
      expect(err).toBeInstanceOf(ProjectNotFoundError);
      expect(err.notice).toMatch(/older version of Starquix/);
      expect(onLoaded).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'location', { value: orig, writable: true });
    }
  });

  it('with auto-migration disabled the legacy load path still loads the project', async () => {
    autoMigration.enabled = false;
    await db.projects.add({ id: 'browser_a', name: 'A', pagesTree: [], createdAt: new Date(), updatedAt: new Date() });
    const onLoaded = vi.fn();
    const onError = vi.fn();
    renderHook(() => useProjectSync({ projectId: 'browser_a', doc: new Y.Doc(), onLoaded, onError }));
    await waitFor(() => expect(onLoaded).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
  });
});
