/**
 * ContentFieldPicker — post-page mode must NOT offer the 'body' option
 *
 * The blog post page's body zone is now a fixed collection-content slot
 * element (Blog Content Slot Element plan, Task 5), not a re-bindable
 * field — consistent with layout slots. The picker therefore must not
 * render the `body (markdown content)` option in post-page mode
 * (pageId set), while frontmatter-field selection keeps dispatching
 * SET_POST_PAGE_BINDING. Blog-slot mode (no pageId) is unaffected.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';

const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();

type Field = { id: string; name: string; type: string; required: boolean };
let mockPostBinding: { collectionId: string; bindings: Record<string, string> } | null = null;
let mockCollection: { id: string; name: string; fields: Field[] } | undefined = undefined;

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useEditorDoc: () => ({} as unknown),
  useYjsValue: (fn: (doc: unknown) => unknown) => fn({}),
}));

vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollection: () => mockCollection,
  selectContentCollections: () => (mockCollection ? [mockCollection] : []),
}));

vi.mock('@/store/selectors', () => ({
  selectPostPageBinding: () => mockPostBinding,
}));

vi.mock('@/core/collections/yjsAccessors', () => ({
  readBlogSlotBinding: () => null,
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: { writeContentConfig: vi.fn().mockResolvedValue(undefined) },
}));

import { ContentFieldPicker } from '../ContentFieldPicker';

const fields: Field[] = [
  { id: 'f1', name: 'title', type: 'text', required: true },
  { id: 'f2', name: 'description', type: 'text', required: false },
];

function renderPostPagePicker() {
  return render(
    <ContentFieldPicker
      elementKey="el-1"
      slotKey="slot-1"
      filterTypes={['text']}
      autoFieldType="text"
      pageId="post-page-1"
    />
  );
}

describe('ContentFieldPicker — post-page mode body option retired', () => {
  beforeEach(() => {
    mockDispatch.mockReset();
    mockTakeSnapshot.mockReset();
    mockPostBinding = { collectionId: 'col-1', bindings: {} };
    mockCollection = { id: 'col-1', name: 'blog', fields };
  });

  it('does not render a "body" option in post-page mode', () => {
    const { container } = renderPostPagePicker();
    const values = Array.from(container.querySelectorAll('option')).map(
      o => o.getAttribute('value')
    );
    expect(values).not.toContain('body');
    // sanity: frontmatter fields are still offered
    expect(values).toContain('title');
    expect(values).toContain('description');
  });

  it('selecting a frontmatter field still dispatches SET_POST_PAGE_BINDING', () => {
    const { container } = renderPostPagePicker();
    const select = container.querySelector('select')!;
    fireEvent.change(select, { target: { value: 'title' } });

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_POST_PAGE_BINDING',
      pageId: 'post-page-1',
      elementKey: 'el-1',
      fieldName: 'title',
    });
  });
});
