import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
const captured = vi.hoisted(() => ({ editor: null as Editor | null }));
vi.mock('@tiptap/react', async original => {
  const actual = await original<typeof import('@tiptap/react')>();
  return { ...actual, useEditor: (...args: Parameters<typeof actual.useEditor>) => {
    const editor = actual.useEditor(...args); captured.editor = editor; return editor;
  } };
});
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [] }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/store/hooks', () => ({
  useDispatch: () => vi.fn(), useEditorDoc: () => ({}),
  useYjsValue: () => [{ id: 'blog', name: 'blog', fields: [{ id: 'title', name: 'title', type: 'text', required: true }] }],
}));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
import { contentOps } from '@/core/collections/content-ops';
import { hasPendingPostWrites } from '@/postmodel/writeQueue';
import { PostEditor } from '../PostEditor';

it.each(['frontmatter', 'body'] as const)('keeps current required-field guidance when an older %s write rejects', async origin => {
  let rejectWrite!: (reason: unknown) => void;
  const write = vi.spyOn(contentOps, 'updatePost').mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectWrite = reject; }));
  const post = { slug: `feedback-${origin}`, filePath: `src/content/blog/feedback-${origin}.mdx`, body: 'Original body.', frontmatter: { title: 'Original title' } };
  const { unmount } = render(<PostEditor collectionName="blog" post={post} onPostUpdate={() => {}} />);
  const title = screen.getByRole('textbox', { name: 'Title' });
  if (origin === 'body') {
    act(() => { captured.editor!.commands.setContent('<p>Body draft.</p>'); });
    fireEvent(window, new Event('pagehide'));
  } else fireEvent.blur(title);
  await vi.waitFor(() => expect(rejectWrite).toBeTypeOf('function'));
  fireEvent.change(title, { target: { value: '' } });
  fireEvent.blur(title);
  expect(screen.getByRole('status')).toHaveTextContent('Complete the required properties');
  await act(async () => { rejectWrite(new Error('Older transport failed')); });
  expect(screen.getByRole('status')).toHaveTextContent('Complete the required properties');
  expect(screen.queryByRole('button', { name: 'Retry save' })).toBeNull();
  expect(title).toHaveValue('');
  expect(hasPendingPostWrites()).toBe(true);
  // Correcting the current draft still uses the retained queue and clears its error.
  write.mockResolvedValue(undefined);
  fireEvent.change(title, { target: { value: 'Corrected title' } });
  fireEvent.blur(title);
  await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  expect(write).toHaveBeenLastCalledWith('blog', post.slug, { title: 'Corrected title' }, origin === 'body' ? 'Body draft.' : 'Original body.', expect.any(Object));
  await act(async () => { unmount(); });
  write.mockRestore();
});
