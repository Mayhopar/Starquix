import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
vi.mock('@/store/hooks', () => ({ useDispatch: () => vi.fn(), useEditorDoc: () => ({}), useYjsValue: () => [] }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }), useOptionalUndoContext: () => null }));
vi.mock('@/store/collectionSelectors', () => ({ selectContentCollections: () => [] }));
import { FrontmatterForm } from '../FrontmatterForm';
import type { CollectionField } from '@/core/collections/types';
function mount(values: Record<string, unknown>, fields: CollectionField[]) {
  let latest = values;
  const commit = vi.fn(async () => true);
  function Form() {
    const [value, setValue] = useState(values);
    return <FrontmatterForm frontmatter={value} fields={fields} collectionId="c" onChange={next => { latest = next; setValue(next); }} onBlur={commit} />;
  }
  const view = render(<Form />);
  return { ...view, latest: () => latest, commit };
}
const field = (name: string, type: CollectionField['type'] = 'text'): CollectionField => ({ id: name, name, type, required: false });
it('edits only the active property and publishes a focused draft before blur', () => {
  const { latest, commit } = mount({ author: 'Ada', url: '/notes' }, [field('author'), field('url', 'url')]);
  expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Edit author' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'author' }), { target: { value: 'Grace' } });
  expect(latest()).toEqual({ author: 'Grace', url: '/notes' });
  expect(commit).not.toHaveBeenCalled();
});
it('draws rows as label + value only: sentence-case labels, a switch for booleans, Empty as a placeholder', () => {
  mount({ heroImage: '', draft: false, author: 'Ada' }, [field('heroImage', 'image'), field('draft', 'boolean'), field('author')]);
  // the key stays reachable as the label's tooltip
  expect(screen.getByText('Hero image')).toHaveAttribute('title', 'heroImage');
  expect(screen.queryByText('heroImage')).toBeNull();
  // a boolean is the switch alone — no "false" text next to it
  expect(screen.getByRole('switch', { name: 'draft' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.queryByText('false')).toBeNull();
  // an empty value reads as a placeholder, a real value as text
  expect(screen.getByRole('button', { name: 'Edit heroImage' })).toHaveClass('text-text-secondary');
  expect(screen.getByRole('button', { name: 'Edit author' })).toHaveClass('text-text');
  // the field manager names a field the same way
  fireEvent.click(screen.getByRole('button', { name: 'Manage collection fields' }));
  expect(screen.getAllByText('Hero image')).toHaveLength(2);
});
it('retains a full timestamp when its editor opens and closes', async () => {
  const date = '2026-09-09T14:30:15+02:00';
  const { latest } = mount({ published: date }, [field('published', 'date')]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit published' }));
  const input = screen.getByRole('textbox', { name: 'published' });
  expect(input).toHaveValue(date);
  await act(async () => fireEvent.blur(input));
  expect(latest()).toEqual({ published: date });
});
it('edits string lists as separate entries without splitting commas', () => {
  const { latest } = mount({ tags: ['a, b', 'He said "hi"', '日本語'] }, [field('tags', 'list')]);
  fireEvent.click(screen.getByRole('button', { name: 'Edit tags' }));
  expect(screen.getByRole('textbox', { name: 'Item 1' })).toHaveValue('a, b');
  fireEvent.change(screen.getByRole('textbox', { name: 'Item 2' }), { target: { value: 'Updated, still one item' } });
  expect(latest()).toEqual({ tags: ['a, b', 'Updated, still one item', '日本語'] });
});
it('keeps conflicting values and imported extras read-only under Other properties', () => {
  const values = { views: 12, flags: ['a', false], author: { raw: 'name: Ada\n' } };
  const { latest, commit } = mount(values, [field('views'), field('flags', 'list')]);
  fireEvent.click(screen.getByText('Other properties'));
  expect(screen.queryByRole('button', { name: 'Edit views' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Inspect author' }));
  expect(screen.getByText('name: Ada')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Remove author' })).toBeNull();
  expect(latest()).toEqual(values); expect(commit).not.toHaveBeenCalled();
});

it('does not dismiss a newer focused edit when an older successful save finishes', async () => {
  let finish!: (saved: boolean) => void;
  let latest: Record<string, unknown> = { author: 'Ada' };
  const save = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  function Form() {
    const [value, setValue] = useState(latest);
    return <FrontmatterForm frontmatter={value} fields={[field('author')]} collectionId="c" onChange={next => { latest = next; setValue(next); }} onBlur={save} />;
  }
  render(<Form />); fireEvent.click(screen.getByRole('button', { name: 'Edit author' }));
  const input = screen.getByRole('textbox', { name: 'author' });
  fireEvent.change(input, { target: { value: 'Older edit' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.change(input, { target: { value: 'Newest edit' } });
  await act(async () => finish(true));
  expect(input).toBeInTheDocument(); expect(input).toHaveValue('Newest edit');
  expect(latest.author).toBe('Newest edit');
});

it('commits a list on Escape and returns focus without changing entry values', async () => {
  const { latest } = mount({ tags: ['a, b', 'second'] }, [field('tags', 'list')]);
  const trigger = screen.getByRole('button', { name: 'Edit tags' });
  fireEvent.click(trigger);
  const input = screen.getByRole('textbox', { name: 'Item 1' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'a, b, c' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Escape' }));
  expect(screen.queryByRole('textbox', { name: 'Item 1' })).toBeNull();
  expect(trigger).toHaveFocus(); expect(latest().tags).toEqual(['a, b, c', 'second']);
});

it('does not return focus to an older property after the user has started another editor', async () => {
  let finish!: (saved: boolean) => void;
  function Form() {
    const [value, setValue] = useState({ author: 'Ada', url: '/notes' });
    return <FrontmatterForm frontmatter={value} fields={[field('author'), field('url', 'url')]} collectionId="c"
      onChange={next => setValue(next as typeof value)} onBlur={() => new Promise<boolean>(resolve => { finish = resolve; })} />;
  }
  render(<Form />); fireEvent.click(screen.getByRole('button', { name: 'Edit author' }));
  const author = screen.getByRole('textbox', { name: 'author' });
  fireEvent.change(author, { target: { value: 'Grace' } }); fireEvent.keyDown(author, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit url' }));
  const url = screen.getByRole('textbox', { name: 'url' }); expect(url).toHaveFocus();
  await act(async () => finish(true));
  expect(url).toHaveFocus();
});

it.each([
  { key: 'tags', type: 'list' as const, value: ['before'], inputName: 'Item 1' },
  { key: 'description', type: 'text' as const, value: 'before', inputName: 'description' },
  { key: 'cover', type: 'image' as const, value: './images/before.png', inputName: 'Image path' },
])('keeps IME Escape inside the $key property without saving or dismissing', async ({ key, type, value, inputName }) => {
  const { commit } = mount({ [key]: value }, [field(key, type)]);
  fireEvent.click(screen.getByRole('button', { name: `Edit ${key}` }));
  const input = screen.getByRole('textbox', { name: inputName }); input.focus();
  fireEvent.compositionStart(input); fireEvent.change(input, { target: { value: '変換中' } });
  await act(async () => fireEvent.keyDown(input, { key: 'Escape', isComposing: true, keyCode: 229 }));
  expect(commit).not.toHaveBeenCalled(); expect(input).toBeInTheDocument(); expect(input).toHaveFocus();
});
