/**
 * PostEditor — save-validation regression test
 *
 * Before fix: handleSave called toast.error on validation issues, then
 * proceeded to contentOps.updatePost regardless — so invalid posts were
 * written to disk. The fix adds `return` after the toast so save is gated.
 *
 * This test mounts PostEditor with a required-field schema and an empty
 * frontmatter, fires the auto-save blur, and asserts:
 * - updatePost is NOT called when required fields are empty.
 * - updatePost IS called when required fields are filled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';

const mockUpdatePost = vi.fn().mockResolvedValue(undefined);
const mockToastError = vi.fn();
const mockOnPostUpdate = vi.fn();

vi.mock('@/core/collections/content-ops', () => ({
  contentOps: { updatePost: (...args: unknown[]) => mockUpdatePost(...args) },
  hasLocalContentSource: () => false,
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ closePost: vi.fn() }),
}));

vi.mock('@/context/PagesContext', () => ({
  usePages: () => ({ setActivePage: vi.fn(), pages: [] }),
}));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => ({} as unknown),
  useYjsValue: () => mockCollections,
}));

vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollections: () => mockCollections,
}));

vi.mock('@/store/selectors', () => ({
  selectPageBlogCollectionIds: () => [],
}));

// Replace heavy child components with minimal blur-triggers.
vi.mock('../FrontmatterForm', () => ({
  FrontmatterForm: ({ frontmatter, onChange, onBlur }: {
    frontmatter: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void; onBlur: () => void;
  }) => <>
    <input data-testid="title-draft" value={typeof frontmatter.title === 'string' ? frontmatter.title : ''}
      onChange={event => onChange({ ...frontmatter, title: event.target.value })} />
    <button data-testid="frontmatter-blur" onClick={onBlur}>frontmatter blur</button>
  </>,
}));

// Tiptap in jsdom is out of scope here — the save gate is what's under test.
vi.mock('../PostBodyEditor', () => ({
  PostBodyEditor: () => <div data-testid="post-body-stub" />,
}));

vi.mock('../MarkdownView', () => ({
  MarkdownView: ({ onBlur }: { onBlur: () => void }) => (
    <button data-testid="markdown-blur" onClick={onBlur}>markdown blur</button>
  ),
}));

let mockCollections: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; required: boolean }> }> = [];

import { PostEditor } from '../PostEditor';

const requiredSchema = [
  { id: 'f-title', name: 'title', type: 'text', required: true },
  { id: 'f-date', name: 'date', type: 'date', required: true },
];

function postWith(frontmatter: Record<string, unknown>) {
  return { slug: 'hello', frontmatter, body: '# hi', filePath: 'src/content/blog/hello.md' };
}

describe('PostEditor — handleSave validation gate', () => {
  beforeEach(() => {
    mockUpdatePost.mockClear();
    mockToastError.mockClear();
    mockOnPostUpdate.mockClear();
    mockCollections = [{ id: 'c1', name: 'blog', fields: requiredSchema }];
  });

  it('does NOT call updatePost when required fields are empty', async () => {
    const { getByTestId } = render(
      <PostEditor collectionName="blog" post={postWith({})} onPostUpdate={mockOnPostUpdate} />
    );

    await fireEvent.click(getByTestId('frontmatter-blur'));

    expect(screen.getByRole('status')).toHaveTextContent('Complete the required properties');
    expect(mockToastError).not.toHaveBeenCalled();
    // Saves ride the async write queue now; give a rejected write every chance
    // to (wrongly) land before asserting it never did.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockUpdatePost).not.toHaveBeenCalled();
    expect(mockOnPostUpdate).not.toHaveBeenCalled();
  });

  it('calls updatePost when all required fields are filled', async () => {
    const { getByTestId } = render(
      <PostEditor
        collectionName="blog"
        post={postWith({ title: 'Hello', date: '2026-05-21' })}
        onPostUpdate={mockOnPostUpdate}
      />
    );

    await fireEvent.click(getByTestId('frontmatter-blur'));

    expect(mockToastError).not.toHaveBeenCalled();
    // The write queue compile-gates before writing, so the write is async.
    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(1));
    expect(mockUpdatePost).toHaveBeenCalledWith('blog', 'hello', { title: 'Hello', date: '2026-05-21' }, '# hi', { baseline: { frontmatter: { title: 'Hello', date: '2026-05-21' }, body: '# hi' } });
  });

  it('still saves under StrictMode (regression: effect-cleanup dispose killed the memoized queue)', async () => {
    // StrictMode mounts → cleans up → remounts. A cleanup that disposed the
    // useMemo'd queue left every later write silently aborted (found live:
    // typing never reached disk, no error anywhere).
    const { getByTestId } = render(
      <React.StrictMode>
        <PostEditor
          collectionName="blog"
          post={postWith({ title: 'Hello', date: '2026-05-21' })}
          onPostUpdate={mockOnPostUpdate}
        />
      </React.StrictMode>
    );

    await fireEvent.click(getByTestId('frontmatter-blur'));

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(1));
    expect(mockUpdatePost).toHaveBeenCalledWith('blog', 'hello', { title: 'Hello', date: '2026-05-21' }, '# hi', { baseline: { frontmatter: { title: 'Hello', date: '2026-05-21' }, body: '# hi' } });
  });

  it('uses the Markdown file format for the first property save with an HTML comment', async () => {
    const body = 'A paragraph.\n\n<!-- Preserve this Markdown comment. -->\n';
    const frontmatter = { title: 'Hello', date: '2026-05-21' };
    const post = { ...postWith(frontmatter), body };
    render(<PostEditor collectionName="blog" post={post} onPostUpdate={mockOnPostUpdate} />);
    fireEvent.change(screen.getByTestId('title-draft'), { target: { value: 'false' } });
    fireEvent.click(screen.getByTestId('frontmatter-blur'));
    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledWith(
      'blog', 'hello', { ...frontmatter, title: 'false' }, body, { baseline: { frontmatter, body } },
    ));
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
  });
});

it('retains failed post feedback locally without exposing transport diagnostics', async () => {
  mockCollections = [{ id: 'c1', name: 'blog', fields: requiredSchema }];
  mockUpdatePost.mockRejectedValueOnce(new Error("Unexpected token '<' at /private/site/src/content/post.mdx"));
  const { getByTestId } = render(<PostEditor collectionName="blog" post={postWith({ title: 'Hello', date: '2026-05-21' })} onPostUpdate={mockOnPostUpdate} />);
  fireEvent.click(getByTestId('frontmatter-blur'));
  await vi.waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  expect(screen.getByRole('status')).not.toHaveTextContent(/Unexpected|private|src\/content/);
  expect(screen.getByRole('button', { name: 'Retry save' })).toBeInTheDocument();
});

it('does not clear a newer invalid property draft when an earlier write finishes', async () => {
  mockCollections = [{ id: 'c1', name: 'blog', fields: requiredSchema }];
  let finish!: () => void;
  mockUpdatePost.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(<PostEditor collectionName="blog" post={postWith({ title: 'Hello', date: '2026-05-21' })} onPostUpdate={mockOnPostUpdate} />);
  fireEvent.click(screen.getByTestId('frontmatter-blur'));
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  fireEvent.change(screen.getByTestId('title-draft'), { target: { value: '' } });
  fireEvent.click(screen.getByTestId('frontmatter-blur'));
  expect(screen.getByRole('status')).toHaveTextContent('Complete the required properties');
  await act(async () => { finish(); });
  expect(screen.getByRole('status')).toHaveTextContent('Complete the required properties');
});

describe('PostEditor — the listing refresh rebases an unwritten queue', () => {
  // Regression (owner 2026-09-13): after "+ Add field" (or the rename's replay) the file moved outside
  // this editor's queue; the first save then refused as an external edit. See PostWriteQueue.rebase().
  it('saves against the refreshed post, not the one it mounted with', async () => {
    mockUpdatePost.mockClear();
    mockCollections = [{ id: 'c1', name: 'blog', fields: requiredSchema }];
    const { getByTestId, rerender } = render(
      <PostEditor collectionName="blog" post={postWith({ title: 'Hello', date: '2026-05-21' })} onPostUpdate={mockOnPostUpdate} />,
    );
    rerender(<PostEditor collectionName="blog" post={postWith({ title: 'Hello', date: '2026-05-21', image: '' })} onPostUpdate={mockOnPostUpdate} />);
    await fireEvent.click(getByTestId('frontmatter-blur'));
    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalled());
    expect(mockUpdatePost.mock.calls[0][4]).toMatchObject({ baseline: { frontmatter: { title: 'Hello', date: '2026-05-21', image: '' }, body: '# hi' } });
  });
});
