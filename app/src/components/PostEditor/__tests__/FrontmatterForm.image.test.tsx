import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn(), claimSnapshot: () => 'snap' }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
const schema = vi.hoisted(() => ({ required: vi.fn(async (): Promise<string[]> => []), makeOptional: vi.fn(async () => {}) }));
vi.mock('@/core/collections/content-ops', async original => {
  const actual = await original<typeof import('@/core/collections/content-ops')>();
  return { ...actual, readRequiredLocalFields: schema.required, contentOps: { ...actual.contentOps, makeLocalCollectionFieldOptional: schema.makeOptional } };
});
vi.mock('@/components/Editor/localFieldBind', () => ({ bindLocalCardImageField: vi.fn(), readLocalCardImageField: async () => null }));
import { FrontmatterForm } from '../FrontmatterForm';
import type { CollectionField } from '@/core/collections/types';
const fields: CollectionField[] = [{ id: 'cover', name: 'cover', type: 'image', required: false }];
function mount(cover = '', upload?: (f: File) => Promise<string>, { commitResult = true, required = false, localCollection = null as string | null } = {}) {
  let latest = { cover };
  const formFields = [{ ...fields[0], required }];
  const onChange = vi.fn();
  const commit = vi.fn(async () => commitResult);
  function Form() {
    const [value, setValue] = useState(latest);
    return <FrontmatterForm frontmatter={value} fields={formFields} collectionId={null} fieldSource={required ? 'schema' : undefined} localCollection={localCollection}
      onChange={next => { latest = next as typeof latest; onChange(next); setValue(latest); }} onBlur={commit} onUploadMedia={upload} />;
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
beforeEach(() => { vi.clearAllMocks(); schema.required.mockResolvedValue([]); });
describe('image property editor', () => {
  it('uses the native media upload and publishes its path before committing', async () => {
    const { onChange, commit, latest } = mount('', async () => './images/x.png');
    await drop();
    expect(latest()).toEqual({ cover: './images/x.png' });
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
  });
  it('deletes an optional image: the key leaves the post (publish, then commit) and its row stays', async () => {
    const { latest, onChange, commit } = mount('https://example.test/a.png', async () => '');
    expect(screen.getByAltText('Current media')).toHaveAttribute('src', 'https://example.test/a.png');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })));
    expect(latest()).toEqual({});
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(commit.mock.invocationCallOrder[0]);
    expect(screen.getByRole('textbox', { name: 'Image path' })).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit cover' })).toBeInTheDocument();
  });
  it('offers no Delete for a required image', () => {
    mount('./images/a.png', async () => '', { required: true });
    expect(screen.queryByRole('button', { name: /delete|remove media/i })).toBeNull();
  });
  it.each([true, false])('files-truth: the collection schema requires the field: %s → Delete hidden, with the way out', async required => {
    schema.required.mockResolvedValue(required ? ['cover'] : []);
    mount('./images/a.png', async () => '', { localCollection: 'works' });
    await act(async () => {});
    expect(schema.required).toHaveBeenCalledWith('works');
    expect(!!screen.queryByRole('button', { name: 'Delete' })).toBe(!required);
    expect(!!screen.queryByText(/Make it optional in Manage collection fields/)).toBe(required);
  });
  it('files-truth: an unreadable schema keeps the image (no Delete)', async () => {
    schema.required.mockRejectedValue(new Error('read failed'));
    mount('./images/a.png', async () => '', { localCollection: 'works' });
    await act(async () => {});
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
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
    const { latest } = mount('', async () => './images/x.png', { commitResult: false });
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

it('files-truth: Manage collection fields makes a schema-required field optional (one undoable change)', async () => {
  schema.required.mockResolvedValue(['cover']);
  render(<FrontmatterForm frontmatter={{ cover: './images/a.png' }} fields={fields} collectionId={null} localCollection="works" onChange={() => {}} onBlur={async () => true} />);
  fireEvent.click(screen.getByRole('button', { name: 'Manage collection fields' }));
  const makeOptional = await screen.findByRole('button', { name: 'Make collection field cover optional' });
  await act(async () => fireEvent.click(makeOptional));
  expect(schema.makeOptional).toHaveBeenCalledWith('works', 'cover', 'snap');
  expect(screen.queryByRole('button', { name: 'Make collection field cover optional' })).toBeNull();
});

it('keeps a deleted image row while the post is open, even when re-inference drops the field (no other post has it)', async () => {
  function Form() {
    const [value, setValue] = useState<Record<string, unknown>>({ cover: './images/a.png' });
    // As the disk inference does after the save: a key no post holds is no longer a field.
    return <FrontmatterForm frontmatter={value} fields={'cover' in value ? fields : []} collectionId={null} onChange={setValue} onBlur={async () => true} onUploadMedia={async () => './images/b.png'} />;
  }
  render(<Form />); fireEvent.click(screen.getByRole('button', { name: 'Edit cover' }));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Done' })));
  expect(screen.getByRole('button', { name: 'Edit cover' })).toBeInTheDocument();
});
