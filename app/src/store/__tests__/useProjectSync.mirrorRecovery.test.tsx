import * as React from 'react';
import 'fake-indexeddb/auto';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
// A filesTruth row must load from its files even when the localStorage mirror
// is unwritable — never fall into the retired doc-truth path (which now errors
// with 'made with an older version', so errors: 0 pins it).
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetModules(); });
it.each(['browser_mirror-recovery', 'legacy-file-based-id'])('seeds %s from files in two fresh sessions despite an unwritable mirror', async projectId => {
  const reload = vi.fn();
  const browser = Object.create(window);
  Object.defineProperty(browser, 'location', { value: { reload } });
  vi.stubGlobal('window', browser);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } });
  const sessions: unknown[] = [];
  for (let session = 0; session < 2; session++) {
    vi.resetModules(); vi.doMock('react', () => React);
    const { db } = await import('@/db');
    const { putProjectFiles, readProjectFiles } = await import('@/db/projectFiles');
    const { useFilesTruthMirror } = await import('@/hooks/useFilesTruthMirror');
    const { useProjectSync, autoMigration } = await import('../useProjectSync');
    const { isLocalProjectId, findLocalProjectEntry } = await import('@/utils/localMode');
    const Y = await import('yjs');
    autoMigration.enabled = true;
    if (session === 0) {
      await db.projects.put({ id: projectId, name: 'Files project', filesTruth: true, pagesTree: [{ id: 'obsolete', children: [] }], createdAt: new Date(), updatedAt: new Date() });
      await db.pages.put({ id: 'obsolete', projectId, name: 'Obsolete legacy page', components: [], metadata: null });
      await putProjectFiles(projectId, [
        { path: 'package.json', content: new TextEncoder().encode('{}') },
        { path: 'src/pages/sentinel.astro', content: new TextEncoder().encode('<h1>Keep this real source</h1>') },
      ]);
    }
    expect(isLocalProjectId(projectId)).toBe(false);
    const doc = new Y.Doc(); const onLoaded = vi.fn(); const onError = vi.fn(); const beforeReload = reload.mock.calls.length;
    const hook = renderHook(() => {
      const mode = useFilesTruthMirror(projectId);
      useProjectSync({ projectId, doc, onLoaded, onError });
      return React.useMemo(() => ({ mode, path: findLocalProjectEntry(projectId)?.path }), [mode]);
    });
    try {
      await waitFor(() => expect(onLoaded.mock.calls.length + onError.mock.calls.length + reload.mock.calls.length - beforeReload).toBeGreaterThan(0));
      await waitFor(() => expect(hook.result.current.mode).toBe(true));
      sessions.push({ reloads: reload.mock.calls.length - beforeReload,
        errors: onError.mock.calls.length, mode: hook.result.current, pages: [...doc.getMap('pages').keys()],
        sentinel: (await readProjectFiles(projectId))['src/pages/sentinel.astro'] });
    } finally { hook.unmount(); doc.destroy(); db.close(); }
  }
  expect(sessions).toEqual([0, 1].map(() => ({ reloads: 0, errors: 0,
    mode: { mode: true, path: `wc://${projectId}` }, pages: ['sentinel'], sentinel: '<h1>Keep this real source</h1>' })));
});
