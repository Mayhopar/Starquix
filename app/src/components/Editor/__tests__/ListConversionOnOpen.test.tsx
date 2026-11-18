// The open pass waits for the collections READ, not for fields: a project
// whose collections have no fields (or none at all) still gets its lists
// converted; a failed read never runs it (the heal would map blind).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  convert: vi.fn(),
  collections: { collections: [] as unknown[], isLoading: false, error: null as string | null },
  files: { 'src/pages/index.astro': '<p />' },
}));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p' }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn(), claimSnapshot: vi.fn() }) }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [{ path: 'src/components/BlogCard.astro' }], isLoading: false }) }));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => h.collections }));
vi.mock('@/utils/cardTitleLock', () => ({
  allCardAssignments: () => new Map(), projectSourcesPath: () => 'wc://p', projectSourcesSnapshot: () => h.files, useCardTitleLockVersion: () => 0,
}));
vi.mock('@/services/listConversion', () => ({
  convertListsOnOpen: (...a: unknown[]) => h.convert(...a), librarySource: async () => '<BlogSlot />', sourcesComplete: () => true,
}));

import { ListConversionOnOpen } from '../ListConversionOnOpen';

beforeEach(() => { h.convert.mockReset().mockResolvedValue(true); h.collections = { collections: [], isLoading: false, error: null }; });

describe('ListConversionOnOpen', () => {
  it('collections read, none with fields → the pass runs', async () => {
    render(<ListConversionOnOpen />);
    await waitFor(() => expect(h.convert).toHaveBeenCalledTimes(1));
  });

  it('collections still loading, or the read failed → never runs', async () => {
    h.collections = { collections: [], isLoading: true, error: null };
    const { unmount } = render(<ListConversionOnOpen />);
    h.collections = { collections: [], isLoading: false, error: 'down' };
    render(<ListConversionOnOpen />);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.convert).not.toHaveBeenCalled();
    unmount();
  });
});
