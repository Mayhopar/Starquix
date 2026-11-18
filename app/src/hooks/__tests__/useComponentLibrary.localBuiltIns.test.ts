/**
 * Materialize-on-insert reachability (gaps 11/36): local mode must list the
 * built-in/theme library in the ⌘K picker — the SAME built-in scan WC uses —
 * so localComponentInsert.materializeLibraryComponent is reachable. Before the
 * fix the local branch hard-set builtIn=[] (old ledger L3), so the committed
 * materialize path could never be triggered from the picker or the AI tool.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import builtInFallback from 'virtual:built-in-components';
import { useComponentLibrary } from '../useComponentLibrary';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => mockLocalPath }));
let mockLocalPath: string | null = null;

const BUILT_IN_SCAN = [
  { name: 'Hero', path: 'library/Hero.astro', source: 'built-in', html: '<div/>', category: 'Hero', props: [], slots: [], dependencies: [] },
  { name: 'Footer', path: 'library/Footer.astro', source: 'built-in', html: '<div/>', category: 'Footer', props: [], slots: [], dependencies: [] },
];
const LOCAL_SCAN = [
  { name: 'Own', path: 'src/components/Own.astro', source: 'user-project', html: '<p/>', category: '', props: [], slots: [], dependencies: [] },
];

const LOCAL_URL = `/__sq/local/scan-components?path=${encodeURIComponent('/tmp/site')}`;
const BUILT_IN_URL = '/__sq/scan-components?source=built-in';

beforeEach(() => {
  mockLocalPath = '/tmp/site';
  vi.restoreAllMocks();
});

describe('useComponentLibrary — built-ins in local mode (gaps 11/36)', () => {
  it('fetches BOTH scans and fills builtIn from the built-in scan', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      Response.json(String(url).includes('/__sq/local/') ? LOCAL_SCAN : BUILT_IN_SCAN),
    );
    const { result } = renderHook(() => useComponentLibrary());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(fetchSpy).toHaveBeenCalledWith(LOCAL_URL, expect.anything());
    expect(fetchSpy).toHaveBeenCalledWith(BUILT_IN_URL, expect.anything());
    // User's own components stay primary in userProject...
    expect(result.current.userProject.map((c) => c.path)).toEqual(['src/components/Own.astro']);
    expect(result.current.userProject.every((c) => c.source === 'user-project')).toBe(true);
    // ...and the built-in library is no longer hidden.
    expect(result.current.builtIn.map((c) => c.path)).toEqual([
      'library/Hero.astro',
      'library/Footer.astro',
    ]);
    expect(result.current.builtIn.every((c) => c.source === 'built-in')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('built-in scan failure falls back to the bundled list, not to hiding', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/__sq/local/')
        ? Response.json(LOCAL_SCAN)
        : new Response('nope', { status: 500 }),
    );
    const { result } = renderHook(() => useComponentLibrary());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.builtIn).toEqual(builtInFallback);
    // Built-in fallback never masquerades as a user-scan error.
    expect(result.current.error).toBeNull();
    expect(result.current.userProject.map((c) => c.path)).toEqual(['src/components/Own.astro']);
  });

  it('user-scan failure still reports the error while the library stays listed', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/__sq/local/')
        ? new Response('nope', { status: 500 })
        : Response.json(BUILT_IN_SCAN),
    );
    const { result } = renderHook(() => useComponentLibrary());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Project components are unavailable.');
    expect(result.current.userProject).toEqual([]);
    expect(result.current.builtIn.map((c) => c.path)).toEqual([
      'library/Hero.astro',
      'library/Footer.astro',
    ]);
  });
});
