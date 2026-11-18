/** Perf (docs/plans/2026-10-04-desktop-perf-climb.md): every accepted edit refetched the
 *  layout library in each of ~7 mounted hooks, flipping to 'loading' and back with new
 *  objects — a re-render of Canvas, sidebar, Design Bar and pickers per keystroke. */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useLayoutLibrary } from '../useLayoutLibrary';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
const SCAN = [{ name: 'Base', path: 'src/layouts/Base.astro', absolutePath: '/x/src/layouts/Base.astro', frontmatter: '', body: '<slot />', slots: [], props: [] }];
const reads = () => vi.mocked(globalThis.fetch).mock.calls.filter(([u]) => String(u).includes('scan-layouts')).length;
beforeEach(() => { vi.restoreAllMocks(); vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(SCAN)); });

it('hooks mounted together share one read; an unchanged revalidation keeps identity and never shows loading', async () => {
  let renders = 0;
  const a = renderHook(() => { renders++; return useLayoutLibrary(); }).result;
  const b = renderHook(() => useLayoutLibrary()).result;
  await waitFor(() => expect(a.current.layouts).toHaveLength(1));
  await waitFor(() => expect(b.current.layouts).toHaveLength(1));
  expect(reads()).toBe(1);
  const layouts = a.current.layouts; const before = renders;
  await act(async () => { a.current.refresh(); await new Promise(r => setTimeout(r, 20)); });
  expect(reads()).toBe(2);
  expect(a.current.layouts).toBe(layouts);
  expect(renders - before).toBeLessThanOrEqual(1); // React may render once more to bail out; the old flip was +2
});
