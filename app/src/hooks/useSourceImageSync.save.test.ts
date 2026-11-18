import 'fake-indexeddb/auto';
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
vi.mock('@/services/ViteImageWriter', () => ({ viteImageWriter: { isAvailable: () => true, writeImageUpdate: vi.fn(async () => true) } }));
import { useSourceImageSync } from './useSourceImageSync';
import { viteImageWriter } from '@/services/ViteImageWriter';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { setLocalExpectedRoute, setLocalPageFile } from '@/utils/localPageSync';
afterEach(() => { vi.clearAllMocks(); setLocalExpectedRoute(null); setLocalPageFile(null); setActiveSaveProjectId(null); });
function edit(doc: Y.Doc, value: string) {
  const attrs = new Y.Map<string>(); attrs.set('alt', value);
  doc.getMap('sourceImageAttributes').set('src/pages/index.astro:1:1', attrs);
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
it('an image edit is written immediately, with no idle delay and no save step', async () => {
  setActiveSaveProjectId('browser_images');
  const doc = new Y.Doc();
  const hook = renderHook(() => useSourceImageSync(doc, () => false));
  act(() => edit(doc, 'Fresh alt'));
  expect(viteImageWriter.writeImageUpdate).toHaveBeenCalledTimes(1);
  expect(vi.mocked(viteImageWriter.writeImageUpdate).mock.calls[0].slice(0, 3)).toEqual([{ file: 'src/pages/index.astro', line: 1, column: 1 }, 'alt', 'Fresh alt']);
  hook.unmount(); doc.destroy();
});
it('a refused image edit is retained across unmount and retried with its gesture-time destination', async () => {
  setActiveSaveProjectId('browser_images');
  setLocalExpectedRoute('/'); setLocalPageFile('src/pages/index.astro');
  vi.mocked(viteImageWriter.writeImageUpdate).mockRejectedValueOnce(new Error('image refused'));
  const doc = new Y.Doc(); const hook = renderHook(() => useSourceImageSync(doc, () => false));
  act(() => edit(doc, 'Retained alt'));
  await settle();
  setLocalPageFile('src/components/Hero.astro');
  hook.unmount();
  const fresh = new Y.Doc(); edit(fresh, 'old disk bytes');
  const remounted = renderHook(() => useSourceImageSync(fresh, () => false));
  await settle();
  expect(viteImageWriter.writeImageUpdate).toHaveBeenLastCalledWith(
    { file: 'src/pages/index.astro', line: 1, column: 1 }, 'alt', 'Retained alt', false,
    { armed: true, pageFile: 'src/pages/index.astro' }, true, expect.any(String),
  );
  remounted.unmount(); doc.destroy(); fresh.destroy();
});
