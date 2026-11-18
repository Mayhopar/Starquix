/** P0a M1 (instant-edit): every accepted revision refetched the layout library through the acceptance
 * lane (+ a layout-plan POST). A layout-neutral edit (a class edit) must not. */
import { it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const read = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://browser_scope-project' }));
vi.mock('@/services/durableEdits/layoutFileAcceptance', () => ({ readAcceptedLayouts: read }));

import { useLayoutLibrary } from '../useLayoutLibrary';
import { publishDurableEditStatus } from '@/services/durableEdits/status';

const PROJECT = 'browser_scope-project';
const accepted = (revision: number, layoutNeutral?: boolean) => act(async () => {
  publishDurableEditStatus(PROJECT, { phase: 'accepted', operationId: `op-${revision}`, acceptedRevision: revision, layoutNeutral });
  await new Promise(r => setTimeout(r, 30));
});
beforeEach(() => { read.mockClear(); });

it('skips the refetch for a layout-neutral accepted revision and keeps refetching for any other', async () => {
  const hook = renderHook(() => useLayoutLibrary()).result;
  await waitFor(() => expect(hook.current.isLoading).toBe(false));
  expect(read).toHaveBeenCalledTimes(1);
  await accepted(1, true);
  await accepted(2, true);
  expect(read).toHaveBeenCalledTimes(1);          // two class edits: no lane job, no POST
  await accepted(3, false);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));   // a possible layout change still refreshes
  await accepted(4);                               // legacy status without the flag
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
});
