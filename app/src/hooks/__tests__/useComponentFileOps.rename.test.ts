/**
 * A rename the project refuses (409, e.g. other files import the component —
 * #11) says why: a ComponentFileError's text is written for the user.
 */
import { it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import toast from 'react-hot-toast';
import { useComponentFileOps } from '../useComponentFileOps';

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://browser_site' }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

it('shows the refusal and reports no new path', async () => {
  const error = "Can't rename Hero: imported by src/pages/index.astro";
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ error }), { status: 409 }));
  const { result } = renderHook(() => useComponentFileOps());
  expect(await result.current.rename('src/components/Hero.astro', 'Banner')).toBeNull();
  expect(toast.error).toHaveBeenCalledWith(error);
});
