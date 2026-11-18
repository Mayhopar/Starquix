import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/hooks/useComponentLibrary', () => ({ useComponentLibrary: () => ({ userProject: [] }) }));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [] }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn() }) }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
import { FrontmatterForm } from '../FrontmatterForm';
import { PostEditor } from '../PostEditor';
import { contentOps } from '@/core/collections/content-ops';
import type { CollectionField } from '@/core/collections/types';
const fields: CollectionField[] = ['title', 'subtitle', 'description'].map(name => ({ id: name, name, type: 'text', required: false }));
function mount(frontmatter: Record<string, unknown>, extra = {}) {
  const onChange = vi.fn(); const onBlur = vi.fn(); const onFocusBody = vi.fn();
  render(<FrontmatterForm frontmatter={frontmatter} fields={fields} collectionId={null} onChange={onChange} onBlur={onBlur} {...{ onFocusBody, fileName: 'article.mdx' }} {...extra} />);
  return { onChange, onBlur, onFocusBody };
}
describe('editorial title fields', () => {
  it('uses the exact subtitle and retains description as a named property', () => {
    const { onChange } = mount({ title: 'Article', subtitle: 'Deck', description: 'Search summary' });
    expect(screen.getByRole('textbox', { name: 'Subtitle' })).toHaveValue('Deck');
    expect(screen.getByText('Description')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'New title' } });
    expect(onChange).toHaveBeenLastCalledWith({ title: 'New title', subtitle: 'Deck', description: 'Search summary' });
  });
  it('does not promote unsupported title values; without a subtitle field the page\'s subtitle (description) is edited in place', () => {
    const { onChange } = mount({ title: 12, description: 'Summary' }, { fields: fields.filter(f => f.name !== 'subtitle') });
    expect(screen.queryByPlaceholderText('Title')).toBeNull();
    expect(screen.getByRole('heading', { name: 'article.mdx' })).toBeInTheDocument();
    const sub = screen.getByRole('textbox', { name: 'Subtitle' });
    expect(sub).toHaveValue('Summary');
    fireEvent.change(sub, { target: { value: 'New summary' } });
    expect(onChange).toHaveBeenLastCalledWith({ title: 12, description: 'New summary' });
  });
  it('keeps IME Enter in the title and transfers explicit Enter through subtitle to body', () => {
    const { onFocusBody } = mount({ title: 'Article', subtitle: 'Deck' });
    const title = screen.getByRole('textbox', { name: 'Title' });
    title.focus();
    fireEvent.keyDown(title, { key: 'Enter', isComposing: true });
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(title, { key: 'Enter' });
    const subtitle = screen.getByRole('textbox', { name: 'Subtitle' });
    expect(document.activeElement).toBe(subtitle);
    fireEvent.keyDown(subtitle, { key: 'Enter' });
    expect(onFocusBody).toHaveBeenCalledTimes(1);
  });
  it('collapses longer property lists without committing when toggled', () => {
    const many = ['title', 'one', 'two', 'three', 'four', 'five'].map(name => ({ id: name, name, type: 'text' as const, required: false }));
    const { onChange, onBlur } = mount({ title: 'Article' }, { fields: many });
    expect(screen.queryByText('Five')).toBeNull();
    fireEvent.click(screen.getByText('Properties'));
    expect(screen.getByText('Five')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled(); expect(onBlur).not.toHaveBeenCalled();
  });
});

it('keeps the live body editor and text selection through property toggles and save echoes', () => {
  const write = vi.spyOn(contentOps, 'updatePost');
  const post = { slug: 'article', filePath: 'src/content/blog/article.mdx', frontmatter: { title: 'Article' }, body: 'Article text.' };
  const onPostUpdate = vi.fn();
  const { rerender, unmount } = render(<PostEditor collectionName="blog" post={post} onPostUpdate={onPostUpdate} />);
  const body = screen.getByRole('textbox', { name: 'Post body' });
  const text = body.querySelector('p')!.firstChild!;
  const range = document.createRange(); range.setStart(text, 1); range.setEnd(text, 5);
  window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
  const properties = screen.getByText('Properties');
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  fireEvent(properties, down); expect(down.defaultPrevented).toBe(true);
  fireEvent.click(properties);
  act(() => rerender(<PostEditor collectionName="blog" post={{ ...post, body: 'Disk echo.' }} onPostUpdate={onPostUpdate} />));
  expect(screen.getByRole('textbox', { name: 'Post body' })).toBe(body);
  expect(body).toHaveTextContent('Article text.');
  expect(window.getSelection()!.toString()).toBe('rtic');
  expect(write).not.toHaveBeenCalled();
  unmount(); write.mockRestore();
});

it('does not synthesize title or subtitle fields when no collection shape is available', () => {
  render(<PostEditor collectionName="unmapped" post={{ slug: 'entry', filePath: 'src/content/unmapped/entry.md', body: 'Text.', frontmatter: { description: 'Summary' } }} onPostUpdate={() => {}} />);
  expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Subtitle' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'entry.md' })).toBeInTheDocument();
});
