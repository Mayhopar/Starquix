/**
 * Owner, 2026-08-10: "+ New post" created the file but left the canvas on
 * "Select a post to edit" — a created post the user then has to find is a dead
 * end, and the still-focused button minted extra posts on Space/Enter. The
 * create must OPEN the post (whose empty title the editor autofocuses).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const mockCreatePost = vi.fn().mockResolvedValue(undefined);
const mockOpenPost = vi.fn();
const mockSetActiveCollectionId = vi.fn();

vi.mock('@/core/collections/content-ops', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  contentOps: {
    createPost: (...a: unknown[]) => mockCreatePost(...a),
    deletePost: vi.fn(),
    deleteCollection: vi.fn(),
  },
}));
vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ openPost: mockOpenPost, closePost: vi.fn(), editingPost: null }),
}));
vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(),
  useEditorDoc: () => ({}),
}));
vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
}));
vi.mock('@/context/VariablesContext', () => ({
  useVariables: () => ({ setActiveCollectionId: mockSetActiveCollectionId }),
}));

import { CollectionTree } from '../CollectionTree';

describe('CollectionTree — new post', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates with an EMPTY title and immediately opens the post', async () => {
    const { getByTitle } = render(
      <CollectionTree
        collection={{ id: 'local:works', name: 'works', fields: [], posts: [] } as never}
        diskPosts={[]}
      />,
    );
    fireEvent.click(getByTitle('New post'));

    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledTimes(1));
    const [collection, slug] = mockOpenPost.mock.calls[0];
    expect(collection).toBe('works');
    expect(slug).toMatch(/^untitled-\d+$/);
    expect(mockCreatePost).toHaveBeenCalledWith(
      'works', slug,
      expect.objectContaining({ title: '' }),
      '',
    );
  });
});
