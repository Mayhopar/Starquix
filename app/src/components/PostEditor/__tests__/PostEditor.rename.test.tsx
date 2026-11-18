/**
 * "The MDX file takes the name of the title" — saving a title on a NEW
 * (untitled-*) post renames its saved source, rebinds the open editor via
 * openPost, and drops the OLD local page
 * row from the doc. A non-untitled post, or an empty title, never renames.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { useImperativeHandle } from 'react';
import { parsePostBody, serializePostDoc, type PostDoc } from '@/postmodel/postModel';
import type { PostWriteQueue } from '@/postmodel/writeQueue';

const mockUpdatePost = vi.fn().mockResolvedValue(undefined);
const mockRenamePost = vi.fn().mockResolvedValue(undefined);
const mockFetchCollections = vi.fn();
const mockOpenPost = vi.fn();
const mockApplyCommand = vi.fn();
const mockOnPostUpdate = vi.fn();
const mockToastError = vi.fn();
let mockBodyDoc: PostDoc | null = null;
let mockQueue: PostWriteQueue | null = null;

vi.mock('@/core/collections/content-ops', () => ({
  hasLocalContentSource: () => false,
  contentOps: {
    updatePost: (...args: unknown[]) => mockUpdatePost(...args),
    renamePost: (...args: unknown[]) => mockRenamePost(...args),
    fetchCollections: (...args: unknown[]) => mockFetchCollections(...args),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: (...args: unknown[]) => mockToastError(...args) },
}));

vi.mock('@/context/PostEditorContext', () => ({
  usePostEditor: () => ({ openPost: mockOpenPost, closePost: vi.fn() }),
}));

// Fake Y.Doc: only what the rename path touches — the pages map membership.
const docPageIds = new Set<string>();
const fakeEditorDoc = {
  getMap: (name: string) => ({ has: (id: string) => name === 'pages' && docPageIds.has(id) }),
};

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => fakeEditorDoc,
  useYjsValue: () => mockCollections,
}));

vi.mock('@/store/commands', () => ({
  applyCommand: (...args: unknown[]) => mockApplyCommand(...args),
}));

vi.mock('@/store/collectionSelectors', () => ({
  selectContentCollections: () => mockCollections,
}));

// Heavy children → minimal stubs. The frontmatter stub exposes a title input
// and the blur that triggers the save path under test.
vi.mock('../FrontmatterForm', () => ({
  FrontmatterForm: ({ frontmatter, onChange, onBlur }: {
    frontmatter: Record<string, unknown>;
    onChange: (fm: Record<string, unknown>) => void;
    onBlur: () => void;
  }) => (
    <div>
      <input
        data-testid="title-input"
        value={String(frontmatter.title ?? '')}
        onChange={e => onChange({ ...frontmatter, title: e.target.value })}
      />
      <button data-testid="fm-blur" onClick={onBlur}>blur</button>
    </div>
  ),
}));

vi.mock('../PostBodyEditor', () => ({
  PostBodyEditor: ({ ref, queue }: { ref: React.Ref<unknown>; queue: PostWriteQueue }) => {
    mockQueue = queue;
    useImperativeHandle(ref, () => ({ getDoc: () => mockBodyDoc, refreshPreviews: () => {} }));
    return <div data-testid="post-body-stub" />;
  },
}));

let mockCollections: Array<{ id: string; name: string; fields: Array<{ id: string; name: string; type: string; required: boolean }> }> = [];

import { PostEditor } from '../PostEditor';

const schema = [{ id: 'f-title', name: 'title', type: 'text', required: false }];

const OLD_SLUG = 'untitled-1786224810096';

function untitledPost() {
  return {
    slug: OLD_SLUG,
    frontmatter: {},
    body: '# hi',
    filePath: `src/content/blog/${OLD_SLUG}.mdx`,
  };
}

function renderEditor(post: ReturnType<typeof untitledPost>) {
  return render(
    <PostEditor collectionName="blog" post={post} onPostUpdate={mockOnPostUpdate} />,
  );
}

async function typeTitleAndBlur(utils: ReturnType<typeof renderEditor>, title: string) {
  fireEvent.change(utils.getByTestId('title-input'), { target: { value: title } });
  await act(async () => { fireEvent.click(utils.getByTestId('fm-blur')); });
}

describe('PostEditor — auto-rename untitled post to its title', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    docPageIds.clear();
    mockBodyDoc = null;
    mockCollections = [{ id: 'c1', name: 'blog', fields: schema }];
    mockFetchCollections.mockResolvedValue([
      { name: 'blog', posts: [{ slug: OLD_SLUG, frontmatter: {}, body: '# hi' }], inferredFields: [] },
    ]);
  });

  it('renames on first title save: move saved bytes to new slug, rebind editor', async () => {
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledTimes(1));

    expect(mockRenamePost).toHaveBeenCalledWith(
      'blog', OLD_SLUG, 'my-first-post',
      expect.objectContaining({ title: 'My First Post' }),
      expect.any(String),
    );
    expect(mockOpenPost).toHaveBeenCalledWith('blog', 'my-first-post');

    // Ordering: save is acknowledged before the source-preserving rename.
    const [updOrder] = mockUpdatePost.mock.invocationCallOrder;
    const [creOrder] = mockRenamePost.mock.invocationCallOrder;
    expect(updOrder).toBeLessThan(creOrder);
  });

  it('keystrokes held since the save began: no rename, no "could not be stored" (owner 2026-11-03)', async () => {
    // The editor holds a keystroke typed while the title save is in flight; the
    // rename's flush writes it, so the doc this save captured is already stale.
    const typed = parsePostBody('first and typed');
    mockBodyDoc = parsePostBody('first');
    mockUpdatePost.mockImplementationOnce(async () => {
      mockBodyDoc = typed;
      mockQueue!.holdInput(() => { void mockQueue!.enqueue(typed, { title: 'My First Post' }); });
    });
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockRenamePost).not.toHaveBeenCalled();
    expect(mockOpenPost).not.toHaveBeenCalled();
    expect(utils.queryByRole('status')).toBeNull();

    // Idle at the next save: nothing is ahead, so the rename goes through on the flushed bytes.
    await act(async () => { fireEvent.click(utils.getByTestId('fm-blur')); });
    await vi.waitFor(() => expect(mockRenamePost).toHaveBeenCalledTimes(1));
    expect(mockRenamePost.mock.calls[0][4]).toBe(serializePostDoc(typed));
  });

  it('keystrokes landing while the flush writes: no rename, no error', async () => {
    mockBodyDoc = parsePostBody('first');
    mockUpdatePost.mockImplementationOnce(async () => {
      mockBodyDoc = parsePostBody('first and typed');
      mockQueue!.holdInput(() => { void mockQueue!.enqueue(mockBodyDoc!, { title: 'My First Post' }); });
    });
    mockUpdatePost.mockImplementationOnce(async () => { mockBodyDoc = parsePostBody('first and typed more'); });
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(2));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockRenamePost).not.toHaveBeenCalled();
    expect(utils.queryByRole('status')).toBeNull();
  });

  it('appends -2 when the slug is taken in the collection', async () => {
    mockFetchCollections.mockResolvedValue([
      {
        name: 'blog',
        posts: [
          { slug: OLD_SLUG, frontmatter: {}, body: '' },
          { slug: 'my-first-post', frontmatter: {}, body: '' },
        ],
        inferredFields: [],
      },
    ]);
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockRenamePost).toHaveBeenCalledTimes(1));
    expect(mockRenamePost.mock.calls[0][2]).toBe('my-first-post-2');
    expect(mockOpenPost).toHaveBeenCalledWith('blog', 'my-first-post-2');
  });

  it('drops the OLD local page row from the doc when present', async () => {
    const oldPageId = `blog-${OLD_SLUG}`; // localPageId('/blog/' + slugify(oldSlug))
    docPageIds.add(oldPageId);
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledTimes(1));
    expect(mockApplyCommand).toHaveBeenCalledWith(
      fakeEditorDoc,
      { type: 'DELETE_PAGE', pageId: oldPageId },
    );
  });

  it('no page row in the doc → no DELETE_PAGE dispatch', async () => {
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledTimes(1));
    expect(mockApplyCommand).not.toHaveBeenCalled();
  });

  it('a NON-untitled post never renames', async () => {
    const utils = renderEditor({
      slug: 'hello',
      frontmatter: {},
      body: '# hi',
      filePath: 'src/content/blog/hello.mdx',
    });
    await typeTitleAndBlur(utils, 'A Whole New Name');

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockRenamePost).not.toHaveBeenCalled();
    expect(mockOpenPost).not.toHaveBeenCalled();
  });

  it('an empty title never renames', async () => {
    const utils = renderEditor(untitledPost());
    await act(async () => { fireEvent.click(utils.getByTestId('fm-blur')); });

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalledTimes(1));
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockRenamePost).not.toHaveBeenCalled();
    expect(mockOpenPost).not.toHaveBeenCalled();
  });

  it('rename failure retains the editor and shows scoped recovery', async () => {
    mockRenamePost.mockRejectedValueOnce(new Error('disk full'));
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(utils.getByRole('status')).toBeInTheDocument());
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockOpenPost).not.toHaveBeenCalled();
  });

  it('aborts (and does not overwrite) when discovery fails — fail-closed collision set', async () => {
    // Verifier finding 1: [] on fetch failure emptied the collision set and
    // createPost silently overwrote an existing post.
    mockFetchCollections.mockRejectedValue(new Error('host hiccup'));
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');

    await vi.waitFor(() => expect(mockUpdatePost).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 50));
    expect(mockRenamePost).not.toHaveBeenCalled();
  });

  it('retains a failed edit arriving during rename and retries it on the new path', async () => {
    let release!: () => void;
    mockRenamePost.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    let fail = true;
    mockUpdatePost.mockImplementation(async (_collection: string, slug: string) => {
      if (slug === 'my-first-post' && fail) throw new Error('connection lost');
    });
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');
    await vi.waitFor(() => expect(mockRenamePost).toHaveBeenCalledTimes(1));
    await typeTitleAndBlur(utils, 'Another Title');
    await act(async () => { release(); });
    await vi.waitFor(() => expect(utils.getByRole('status')).toBeInTheDocument());
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockOpenPost).not.toHaveBeenCalled();
    expect((utils.getByTestId('title-input') as HTMLInputElement).value).toBe('Another Title');
    fail = false;
    await act(async () => { fireEvent.click(utils.getByTestId('fm-blur')); });
    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledWith('blog', 'my-first-post'));
    expect(mockUpdatePost).toHaveBeenLastCalledWith('blog', 'my-first-post', { title: 'Another Title' }, '# hi', expect.any(Object));
  });

  it.each([false, true])('drains newer input during failed rename retry before remount, body changed=%s', async bodyChanged => {
    let releaseRename!: () => void;
    let releaseRetry!: () => void;
    mockRenamePost.mockImplementationOnce(() => new Promise<void>(r => { releaseRename = r; }));
    let newPathWrites = 0;
    mockUpdatePost.mockImplementation(async (_collection: string, slug: string) => {
      if (slug !== 'my-first-post') return;
      newPathWrites++;
      if (newPathWrites === 1) throw new Error('replay failed');
      if (newPathWrites === 2) await new Promise<void>(r => { releaseRetry = r; });
    });
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');
    await vi.waitFor(() => expect(mockRenamePost).toHaveBeenCalledTimes(1));
    await typeTitleAndBlur(utils, 'Second title');
    await act(async () => { releaseRename(); });
    await vi.waitFor(() => expect(utils.getByRole('status')).toBeInTheDocument());
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockOpenPost).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(utils.getByTestId('fm-blur')); });
    await vi.waitFor(() => expect(newPathWrites).toBe(2));
    fireEvent.change(utils.getByTestId('title-input'), { target: { value: 'Third title' } });
    if (bodyChanged) mockBodyDoc = parsePostBody('Third body.');
    await act(async () => { releaseRetry(); });
    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledWith('blog', 'my-first-post'));
    expect(mockUpdatePost).toHaveBeenLastCalledWith('blog', 'my-first-post', { title: 'Third title' }, bodyChanged ? 'Third body.' : '# hi', expect.any(Object));
  });

  it('a second blur mid-rename does not rename twice (re-entrancy guard)', async () => {
    let releaseCreate!: () => void;
    mockRenamePost.mockImplementation(() => new Promise<void>(r => { releaseCreate = r; }));
    const utils = renderEditor(untitledPost());
    await typeTitleAndBlur(utils, 'My First Post');
    await vi.waitFor(() => expect(mockRenamePost).toHaveBeenCalledTimes(1));
    // rename in flight — blur again with a different title
    await typeTitleAndBlur(utils, 'Another Title');
    await act(async () => { releaseCreate(); });
    await vi.waitFor(() => expect(mockOpenPost).toHaveBeenCalledTimes(1));
    expect(mockRenamePost).toHaveBeenCalledTimes(1);
    expect(mockUpdatePost).toHaveBeenLastCalledWith('blog', 'my-first-post', { title: 'Another Title' }, '# hi', expect.objectContaining({ baseline: expect.any(Object) }));
  });
});
