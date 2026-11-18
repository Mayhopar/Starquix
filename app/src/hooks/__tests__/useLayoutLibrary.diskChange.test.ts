/** Desktop disk changes (task: layouts blind spot, 2026-11-17): the layout library revalidated only
 *  on our own durable-edit acceptance and a Vite HMR event the desktop app never gets — a layout an
 *  agent, git or another app wrote or deleted arrived as `sq:files-changed` (live probe: the event
 *  reached the editor, 0 reads followed, the Assets row never showed). */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLayoutLibrary, type ScannedLayout } from '../useLayoutLibrary';
import { readAcceptedLayouts } from '@/services/durableEdits/layoutFileAcceptance';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p1' }));
vi.mock('@/services/durableEdits/layoutFileAcceptance', () => ({ readAcceptedLayouts: vi.fn() }));
const layout = (name: string): ScannedLayout => ({ name, path: `${name}.astro`, absolutePath: `/x/${name}.astro`, props: [], slots: [], frontmatter: '', body: '<slot />' });
let disk: ScannedLayout[] = [];
const reads = () => vi.mocked(readAcceptedLayouts).mock.calls.length;
const change = (files: string[], gone: string[] = [], projectId = 'p1') =>
  act(() => { window.dispatchEvent(new CustomEvent('sq:files-changed', { detail: { projectId, files, gone } })); });
const names = (h: { current: { layouts: ScannedLayout[] } }) => h.current.layouts.map(l => l.name);

beforeEach(() => {
  disk = [layout('Base')];
  vi.mocked(readAcceptedLayouts).mockReset().mockImplementation(async () => disk);
});

async function mountThree() {
  const hooks = [0, 1, 2].map(() => renderHook(() => useLayoutLibrary()).result);
  for (const h of hooks) await waitFor(() => expect(names(h)).toEqual(['Base']));
  return hooks;
}

it('an outside layout write reaches every mounted hook through ONE read', async () => {
  const hooks = await mountThree();
  const before = reads();
  disk = [layout('Base'), layout('Probe')];
  await change(['src/layouts/Probe.astro']);
  for (const h of hooks) await waitFor(() => expect(names(h)).toEqual(['Base', 'Probe']));
  expect(reads() - before).toBe(1);
});

it('an outside delete of a listed layout (or its folder) leaves every hook', async () => {
  const hooks = await mountThree();
  disk = [];
  await change([], ['src/layouts']);
  for (const h of hooks) await waitFor(() => expect(h.current.layouts).toEqual([]));
});

it('a page, a component, a save temp file or another project costs no read', async () => {
  await mountThree();
  const before = reads();
  await change(['src/pages/index.astro', 'src/components/Hero.astro'], ['src/pages/index.astro.sq-stamp-tmp', 'src/layouts/Base.astro.sq-stamp-tmp']);
  await change(['src/layouts/Other.astro'], [], 'p2');
  await act(() => new Promise(r => setTimeout(r, 500)));
  expect(reads()).toBe(before);
});

it('a burst of layout writes costs ONE read', async () => {
  const hooks = await mountThree();
  const before = reads();
  disk = [layout('Base'), layout('A'), layout('B'), layout('C')];
  for (const name of ['A', 'B', 'C']) { await change([`src/layouts/${name}.astro`]); await act(() => new Promise(r => setTimeout(r, 40))); }
  for (const h of hooks) await waitFor(() => expect(h.current.layouts).toHaveLength(4));
  await act(() => new Promise(r => setTimeout(r, 400)));
  expect(reads() - before).toBe(1);
});
