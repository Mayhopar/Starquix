import { useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const mockAddLocal = vi.fn();
const mockRemoveLocal = vi.fn();
vi.mock('@/core/collections/content-ops', () => ({ readRequiredLocalFields: async () => [], contentOps: {
  addLocalCollectionField: (...args: unknown[]) => mockAddLocal(...args),
  removeLocalCollectionField: (...args: unknown[]) => mockRemoveLocal(...args),
} }));
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
const undo = vi.hoisted(() => ({ take: vi.fn(), claim: vi.fn(() => 'undo-entry') }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: undo.take, claimSnapshot: undo.claim }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
import { FrontmatterForm } from '../FrontmatterForm';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import type { CollectionField } from '@/core/collections/types';
const fields: CollectionField[] = [
  { id: 'title', name: 'title', type: 'text', required: false },
  { id: 'date', name: 'date', type: 'date', required: false },
  { id: 'rating', name: 'rating', type: 'text', required: false },
];
const initial = { title: 'X', date: '2026-08-01', rating: '5' };
function mount(localCollection: string | null = 'works', commitResult = true) {
  let latest: Record<string, unknown> = initial;
  const onChange = vi.fn(); const onBlur = vi.fn(async () => commitResult);
  function Form() {
    const [value, setValue] = useState<Record<string, unknown>>(initial);
    return <FrontmatterForm frontmatter={value} fields={fields} collectionId={null} localCollection={localCollection}
      onChange={next => { latest = next; onChange(next); setValue(next); }} onBlur={onBlur} />;
  }
  const view = render(<Form />);
  return { ...view, onChange, onBlur, latest: () => latest };
}
function manage() { fireEvent.click(screen.getByRole('button', { name: 'Manage collection fields' })); }
function add(name = 'score', type = 'text') {
  manage(); fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Field name' }), { target: { value: name } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Field type' }), { target: { value: type } });
}
let project = ''; let projectCounter = 0;
beforeEach(() => { project = `field_management_${++projectCounter}`; setActiveSaveProjectId(project); vi.clearAllMocks(); mockAddLocal.mockResolvedValue(undefined); mockRemoveLocal.mockResolvedValue(undefined); });
afterEach(() => { setActiveSaveProjectId(null); vi.restoreAllMocks(); });
describe('explicit files-truth collection field management', () => {
  it('shows collection scope before enabling an explicit Add action', () => {
    mount(); manage();
    expect(screen.getByText('Changes apply to every post in works.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add field' })).toBeEnabled();
    expect(screen.queryByLabelText('Remove collection field title')).toBeNull();
    expect(screen.queryByLabelText('Remove collection field date')).toBeNull();
  });
  it('disables management without an existing collection capability', () => {
    mount(null); expect(screen.getByRole('button', { name: 'Manage collection fields' })).toBeDisabled();
  });
  it('flushes the current post, adds boolean false and publishes before its final save', async () => {
    const { onChange, onBlur, latest } = mount(); add('draft', 'boolean');
    expect(screen.queryByLabelText('Required')).toBeNull();
    expect(screen.queryByRole('option', { name: 'image', exact: true })).not.toBeNull();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
    expect(mockAddLocal).toHaveBeenCalledWith('works', 'draft', false, 'boolean');
    expect(onBlur.mock.invocationCallOrder[0]).toBeLessThan(mockAddLocal.mock.invocationCallOrder[0]);
    expect(onChange.mock.invocationCallOrder[0]).toBeLessThan(onBlur.mock.invocationCallOrder[1]);
    expect(latest()).toEqual({ ...initial, draft: false });
  });
  it('adds an image field: written as "" everywhere, and THIS form shows the image editor for it at once', async () => {
    const { latest } = mount(); add('coverImage', 'image');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
    expect(mockAddLocal).toHaveBeenCalledWith('works', 'coverImage', '', 'image');
    expect(latest()).toEqual({ ...initial, coverImage: '' });
    // The collection re-read has not landed (fields prop unchanged): the row is
    // still an editable image property, not a read-only extra.
    fireEvent.click(screen.getByRole('button', { name: 'Edit coverImage' }));
    expect(screen.getByLabelText('Image path')).toBeVisible();
  });
  it('keeps the name and draft when a collection write rejects', async () => {
    mockAddLocal.mockRejectedValue(new Error('private parser payload'));
    const { latest } = mount(); add();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
    expect(screen.getByRole('textbox', { name: 'Field name' })).toHaveValue('score');
    expect(screen.getByRole('status')).not.toHaveTextContent('private parser payload');
    expect(latest()).toEqual(initial);
  });
  it('does not start collection changes when the current post cannot flush', async () => {
    mount('works', false); add();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
    expect(mockAddLocal).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Field name' })).toHaveValue('score');
  });
  it('retains the form while adding and preserves a newer title draft when the add finishes', async () => {
    let finish!: () => void; mockAddLocal.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const { latest } = mount(); add();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('textbox', { name: 'Field name' })).toHaveValue('score');
    fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), { target: { value: 'Newer title' } });
    await act(async () => finish());
    expect(latest()).toEqual({ ...initial, title: 'Newer title', score: '' });
  });
  it('removes the draft key only after the collection file operation succeeds', async () => {
    let finish!: () => void; mockRemoveLocal.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const { onChange, latest } = mount(); manage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove collection field rating' })));
    expect(onChange).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(latest()).toEqual({ title: 'X', date: '2026-08-01' });
  });
  it('keeps the original draft when removal fails and never exposes the raw error', async () => {
    mockRemoveLocal.mockRejectedValue(new Error('raw source'));
    const { latest } = mount(); manage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove collection field rating' })));
    expect(latest()).toEqual(initial); expect(screen.getByRole('status')).toHaveTextContent('not fully updated');
    expect(screen.getByRole('status')).not.toHaveTextContent('raw source');
  });
  // Owner 2026-11-10: delete anything AND undo — no question; ⌘Z puts the key back in every post (culture.md Law 6).
  it('removes at once — no question, never a native confirm — and hands ⌘Z the change', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm'); mount(); manage();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove collection field rating' })));
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(undo.take).toHaveBeenCalledTimes(1);
    expect(mockRemoveLocal).toHaveBeenCalledWith('works', 'rating', 'undo-entry');
  });
});


it('retains rejected collection ownership without replaying an ambiguous multi-file write', async () => {
  mockAddLocal.mockRejectedValueOnce(new Error('partial files'));
  const view = mount(); add();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
  expect(mockAddLocal).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  view.unmount(); mount(); manage();
  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
});

it('does not write a collection after a delayed preflush returns to an unmounted form', async () => {
  let finish!: (ok: boolean) => void;
  const view = render(<FrontmatterForm frontmatter={initial} fields={fields} collectionId={null} localCollection="works"
    onChange={() => {}} onBlur={() => new Promise<boolean>(resolve => { finish = resolve; })} />);
  add();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
  view.unmount(); setActiveSaveProjectId('another_project');
  await act(async () => finish(true));
  expect(mockAddLocal).not.toHaveBeenCalled();
});

it('observes a pending add and a late rejection in a form mounted before that rejection', async () => {
  let reject!: (error: Error) => void;
  mockAddLocal.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const original = mount(); add();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
  original.unmount(); mount(); add();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
  expect(mockAddLocal).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('partial write')));
  mockAddLocal.mockResolvedValueOnce(undefined);
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true })));
  expect(mockAddLocal).toHaveBeenCalledTimes(1);
});

it.each(['Field name', 'Field type'])('keeps composing Escape inside Add field: %s', async name => {
  mount(); add(); const input = screen.getByLabelText(name); input.focus();
  fireEvent.compositionStart(input);
  await act(async () => fireEvent.keyDown(input, { key: 'Escape', isComposing: true, keyCode: 229 }));
  expect(input).toHaveFocus(); expect(mockAddLocal).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Field name' })).toBeInTheDocument();
});

it('returns focus to Add after cancellation and Manage after closing, without replacing newer focus', async () => {
  mount(); const trigger = screen.getByRole('button', { name: 'Manage collection fields' }); trigger.focus(); add();
  await act(async () => fireEvent.keyDown(screen.getByRole('textbox', { name: 'Field name' }), { key: 'Escape' }));
  expect(screen.getByRole('button', { name: 'Add field' })).toHaveFocus();
  await act(async () => fireEvent.keyDown(document, { key: 'Escape' }));
  expect(trigger).toHaveFocus();
  add();
  const title = screen.getByRole('textbox', { name: 'Title' });
  await act(async () => { fireEvent.keyDown(screen.getByRole('textbox', { name: 'Field name' }), { key: 'Escape' }); title.focus(); });
  expect(title).toHaveFocus();
});

it('shares a removal rejection with a manager remounted while that removal was pending', async () => {
  let reject!: (error: Error) => void;
  mockRemoveLocal.mockImplementationOnce(() => new Promise<void>((_, fail) => { reject = fail; }));
  const original = mount(); manage();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove collection field rating' })));
  original.unmount(); mount(); manage();
  const remove = screen.getByRole('button', { name: 'Remove collection field rating' });
  expect(remove).toBeDisabled();
  await act(async () => reject(new Error('unknown removal')));
  expect(remove).toBeDisabled(); expect(mockRemoveLocal).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('status')).toHaveTextContent('Some files may have changed');
});
