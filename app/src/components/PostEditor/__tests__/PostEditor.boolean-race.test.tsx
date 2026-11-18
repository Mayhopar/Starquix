/**
 * Regression test for the boolean-checkbox stale-ref race in PostEditor.
 *
 * Bug: FrontmatterForm.tsx:195 fires `onChange(e.target.checked)` and `onBlur()`
 * synchronously in the same event handler. `onChange` queues a setState; React
 * does NOT re-render in the middle of an event handler, so PostEditor's
 * frontmatterRef.current (synced inline during render at lines 27-28) still
 * holds the OLD frontmatter when onBlur → handleSave → persistIfValid reads it.
 * Result: contentOps.updatePost writes the OLD frontmatter to disk.
 *
 * This test uses the REAL FrontmatterForm so the race is observable end-to-end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';

const mockUpdatePost = vi.fn().mockResolvedValue(undefined);
const mockOnPostUpdate = vi.fn();

vi.mock('@/core/collections/content-ops', () => ({
  hasLocalContentSource: () => false,
  contentOps: {
    updatePost: (...args: unknown[]) => mockUpdatePost(...args),
    writeContentConfig: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn() },
}));

vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ closePost: vi.fn() }),
}));

vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({ setActivePage: vi.fn(), pages: [] }),
}));

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: vi.fn() }),
  // The post body pushes undo steps when a provider exists; null here means
  // "no undo step", which is the same thing this test asserts nothing about.
  useOptionalUndoContext: () => null,
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => ({} as unknown),
  useDispatch: () => vi.fn(),
  useYjsValue: () => mockCollections,
}));

vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollections: () => mockCollections,
}));

vi.mock('@/store/selectors', () => ({
  selectPageBlogCollectionIds: () => [],
}));

// MarkdownView is heavy (Prism). Stub it out — we only need FrontmatterForm.
vi.mock('../MarkdownView', () => ({
  MarkdownView: () => <div data-testid="markdown-stub" />,
}));

// Tiptap in jsdom is out of scope here — the frontmatter race is what's under test.
vi.mock('../PostBodyEditor', () => ({
  PostBodyEditor: () => <div data-testid="post-body-stub" />,
}));

let mockCollections: Array<{
  id: string;
  name: string;
  fields: Array<{ id: string; name: string; type: string; required: boolean }>;
}> = [];

import { PostEditor } from '../PostEditor';

const schemaWithDraft = [
  { id: 'f-title', name: 'title', type: 'text', required: true },
  { id: 'f-date', name: 'date', type: 'date', required: true },
  { id: 'f-draft', name: 'draft', type: 'boolean', required: false },
];

function postWith(frontmatter: Record<string, unknown>) {
  return { slug: 'hello', frontmatter, body: '# hi', filePath: 'src/content/blog/hello.md' };
}

describe('PostEditor — toggling boolean writes the NEW value (not stale)', () => {
  beforeEach(() => {
    mockUpdatePost.mockClear();
    mockOnPostUpdate.mockClear();
    mockCollections = [{ id: 'c1', name: 'blog', fields: schemaWithDraft }];
  });

  it('clicking the draft switch saves draft=true (not the stale false)', async () => {
    const { container } = render(
      <PostEditor
        collectionName="blog"
        post={postWith({ title: 'Hello', date: '2026-05-21', draft: false })}
        onPostUpdate={mockOnPostUpdate}
      />
    );

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);

    // The race: onChange queues setFrontmatter({...fm, draft: true}); onBlur
    // synchronously reads frontmatterRef.current which still holds the OLD
    // frontmatter (draft: false) because React hasn't re-rendered yet.
    // (The write itself is async now — it rides the compile-gated queue — but
    // the frontmatter value is captured synchronously at save time.)
    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(1));
    const [, , frontmatterArg] = mockUpdatePost.mock.calls[0];
    expect(frontmatterArg).toEqual({ title: 'Hello', date: '2026-05-21', draft: true });
  });

  it('clicking the draft switch saves draft=false when toggling off', async () => {
    const { container } = render(
      <PostEditor
        collectionName="blog"
        post={postWith({ title: 'Hello', date: '2026-05-21', draft: true })}
        onPostUpdate={mockOnPostUpdate}
      />
    );

    const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(1));
    const [, , frontmatterArg] = mockUpdatePost.mock.calls[0];
    expect(frontmatterArg).toEqual({ title: 'Hello', date: '2026-05-21', draft: false });
  });
});
