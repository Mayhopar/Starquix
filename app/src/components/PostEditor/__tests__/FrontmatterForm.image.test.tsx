import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
import { FrontmatterForm } from '../FrontmatterForm';
import type { CollectionField } from '@/core/collections/types';
const fields: CollectionField[] = [{ id: 'cover', name: 'cover', type: 'image', required: false }];
function mount(cover = '', upload?: (f: File) => Promise<string>, commitResult = true) {
  let latest = { cover };
  const onChange = vi.fn();
  const commit = vi.fn(async () => commitResult);
  function Form() {
    const [value, setValue] = useState(latest);
    return <FrontmatterForm frontmatter={value} fields={fields} collectionId={null} onChange={next => { latest = next as typeof latest; onChange(next); setValue(latest); }} onBlur={commit} onUploadMedia={upload} />;
  }
  const view = render(<Form />);
  fireEvent.click(screen.getByRole('button', { name: 'Edit cover' }));
  return { ...view, onChange, commit, latest: () => latest };
}
async function drop() {
  await act(async () => fireEvent.drop(screen.getByText(/Drop an image/i), {
    dataTransfer: { files: [new File(['x'], 'x.png', { type: 'image/png' })], types: ['Files'] },
  }));
}
beforeEach(() => vi.clearAllMocks());
describe('image property editor', () => {
  it('uses the native media upload and publishes its path before committing', async () => {
    const { onChange, commit, latest } = mount('', async () => './images/x.png');
    await drop();
    expect(latest()).toEqual({ cover: './images/x.png' });
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
  });
  it('shows remote images and omits Clear without a proven optional image schema deletion', () => {
    mount('https://example.test/a.png', async () => '');
    expect(screen.getByAltText('Current media')).toHaveAttribute('src', 'https://example.test/a.png');
    expect(screen.queryByRole('button', { name: /delete|clear/i })).toBeNull();
  });
  it('publishes a manually typed post-relative path without rewriting it', () => {
    const { latest } = mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Image path' }), { target: { value: './images/a.png' } });
    expect(latest()).toEqual({ cover: './images/a.png' });
    expect(screen.queryByText('Upload')).toBeNull();
  });
  it.each(['', 'blob:preview'])('rejects a non-durable upload result %s and keeps the original value', async src => {
    const { latest, commit } = mount('./images/original.png', async () => src);
    await drop();
    expect(latest()).toEqual({ cover: './images/original.png' });
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('The image could not be added');
  });
  it('keeps the image draft visible after a refused save', async () => {
    const { latest } = mount('', async () => './images/x.png', false);
    await drop();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
    expect(screen.getByRole('textbox', { name: 'Image path' })).toHaveValue('./images/x.png');
    expect(latest()).toEqual({ cover: './images/x.png' });
  });
  it('does not publish a completed upload after the post editor unmounts', async () => {
    let finish!: (src: string) => void;
    const { unmount, onChange, commit } = mount('', () => new Promise(resolve => { finish = resolve; }));
    await drop(); unmount();
    await act(async () => finish('./images/late.png'));
    expect(onChange).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });
});

it.each(['', '   ', 'blob:temporary'])('retains the accepted image while an invalid manual draft stays visible: %j', async draft => {
  const { latest, onChange, commit } = mount('./images/existing.png');
  const input = screen.getByRole('textbox', { name: 'Image path' });
  fireEvent.change(input, { target: { value: draft } });
  expect(input).toHaveValue(draft);
  expect(latest()).toEqual({ cover: './images/existing.png' });
  expect(onChange).not.toHaveBeenCalled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
  expect(input).toBeInTheDocument(); expect(commit).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: './images/replacement.png' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
  expect(latest()).toEqual({ cover: './images/replacement.png' });
  expect(commit).toHaveBeenCalledTimes(1);
});

it('does not dismiss an invalid path draft when an earlier valid image save finishes', async () => {
  let finish!: (ok: boolean) => void;
  function Form() {
    const [value, setValue] = useState<Record<string, unknown>>({ cover: './images/original.png' });
    return <FrontmatterForm frontmatter={value} fields={fields} collectionId={null} onChange={setValue}
      onBlur={() => new Promise<boolean>(resolve => { finish = resolve; })} />;
  }
  render(<Form />); fireEvent.click(screen.getByRole('button', { name: 'Edit cover' }));
  const input = screen.getByRole('textbox', { name: 'Image path' });
  fireEvent.change(input, { target: { value: './images/new.png' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  fireEvent.change(input, { target: { value: '' } });
  await act(async () => finish(true));
  expect(input).toBeInTheDocument(); expect(input).toHaveValue('');
});

it('can dismiss a reopened image editor that shows the accepted path', async () => {
  function Form() {
    const [value, setValue] = useState<Record<string, unknown>>({ cover: './images/original.png', description: 'Text' });
    return <FrontmatterForm frontmatter={value} fields={[...fields, { id: 'description', name: 'description', type: 'text', required: false }]}
      collectionId={null} onChange={setValue} onBlur={async () => true} />;
  }
  render(<Form />); fireEvent.click(screen.getByRole('button', { name: 'Edit cover' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Image path' }), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit description' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit cover' }));
  expect(screen.getByRole('textbox', { name: 'Image path' })).toHaveValue('./images/original.png');
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
  expect(screen.queryByRole('textbox', { name: 'Image path' })).toBeNull();
});
