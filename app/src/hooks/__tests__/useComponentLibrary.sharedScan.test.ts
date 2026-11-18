/** Perf (docs/plans/2026-10-04-desktop-perf-climb.md): every mounted library hook
 *  used to run its own project scan — 6 scan-components per editor open, each
 *  rendering every component server-side. Concurrent reads now share one.
 *
 *  Desktop disk changes: the library refreshed only on a Vite HMR event the desktop
 *  app never gets, so every mounted hook kept the scan from project open (live probe
 *  2026-11-17: a library copy, an outside write and an outside delete reached all ~9
 *  hooks as `sq:files-changed` and rescanned none). Every disk change now reaches them. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useComponentLibrary, affectsComponentScan } from '../useComponentLibrary';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p1' }));
const comp = (name: string) => ({ name, path: `src/components/${name}.astro`, source: 'user-project', html: '<p/>', category: '', props: [], slots: [], dependencies: [] });
let disk = [comp('Own')];
const scans = () => vi.mocked(globalThis.fetch).mock.calls.filter(([u]) => String(u).includes('/__sq/local/scan-components')).length;
const change = (files: string[], gone: string[] = [], projectId = 'p1') =>
  act(() => { window.dispatchEvent(new CustomEvent('sq:files-changed', { detail: { projectId, files, gone } })); });

beforeEach(() => {
  disk = [comp('Own')];
  vi.restoreAllMocks();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => Response.json(String(url).includes('/__sq/local/') ? disk : []));
});

it('hooks mounted together share ONE project scan; refresh() reads again', async () => {
  const { hooks } = await mountThree();
  expect(scans()).toBe(1);
  await act(async () => { await hooks[0].current.refresh(); });
  expect(scans()).toBe(2);
});

async function mountThree() {
  let loadingAfterReady = false;
  const hooks = [0, 1, 2].map(() => renderHook(() => {
    const lib = useComponentLibrary();
    if (lib.isLoading && lib.userProject.length === 0 && scans() > 1) loadingAfterReady = true;
    return lib;
  }).result);
  for (const h of hooks) await waitFor(() => expect(h.current.userProject.map(c => c.name)).toEqual(['Own']));
  return { hooks, loadingAfterReady: () => loadingAfterReady };
}

describe('useComponentLibrary — disk changes (desktop)', () => {
  it('a component written to disk reaches every hook through ONE shared rescan, never blanking the list', async () => {
    const { hooks, loadingAfterReady } = await mountThree();
    const before = scans();
    disk = [comp('Own'), comp('Hero2')];
    await change(['src/components/Hero2.astro'], ['src/components/Hero2.astro.sq-stamp-tmp']);
    for (const h of hooks) await waitFor(() => expect(h.current.userProject.map(c => c.name)).toEqual(['Own', 'Hero2']));
    expect(scans() - before).toBe(1);
    expect(loadingAfterReady()).toBe(false);
  });

  it('a component removed from disk leaves every hook', async () => {
    const { hooks } = await mountThree();
    disk = [];
    await change([], ['src/components/Own.astro']);
    for (const h of hooks) await waitFor(() => expect(h.current.userProject).toEqual([]));
  });

  it('a page edit, another project or an unchanged scan costs nothing', async () => {
    const { hooks } = await mountThree();
    const before = scans();
    await change(['src/pages/index.astro'], ['src/pages/index.astro.sq-stamp-tmp']);
    await change(['src/components/Other.astro'], [], 'p2');
    expect(scans()).toBe(before);
    const list = hooks[0].current.userProject;
    await change(['src/components/Own.astro']); // content save, same scan result
    await waitFor(() => expect(scans()).toBe(before + 1));
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    expect(hooks[0].current.userProject).toBe(list); // same object: consumers do not re-render
  });

  it('a burst of disk changes (an agent writing five files) costs ONE rescan', async () => {
    const { hooks } = await mountThree();
    const before = scans();
    disk = [comp('Own'), ...[0, 1, 2, 3, 4].map(i => comp(`Burst${i}`))];
    for (let i = 0; i < 5; i++) {
      await change([`src/components/Burst${i}.astro`]);
      await act(() => new Promise(r => setTimeout(r, 40)));
    }
    for (const h of hooks) await waitFor(() => expect(h.current.userProject).toHaveLength(6));
    await act(() => new Promise(r => setTimeout(r, 400)));
    expect(scans() - before).toBe(1);
  });
});

describe('affectsComponentScan', () => {
  const listed = [{ path: 'src/components/ui/Card.astro' }];
  it.each([
    [['src/components/New.astro'], [], true],
    [['src/pages/blog/[slug].astro'], [], true],
    [['src/pages/about.astro'], [], false],
    [['src/styles/global.css'], ['src/styles/global.css.sq-stamp-tmp'], false],
    [[], ['src/components/ui/Card.astro'], true],
    [[], ['src/components/ui'], true],
    [[], ['src/components/Gone.astro.sq-stamp-tmp'], false],
  ] as const)('%j / gone %j → %s', (files, gone, expected) => {
    expect(affectsComponentScan(files, gone, listed)).toBe(expected);
  });
});
