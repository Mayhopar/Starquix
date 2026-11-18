// BlogBindingBlock (task-240): Blog Settings over the page CODE. Every control
// change = ONE bindLocalBlogSlot call with the whole next binding; a
// hand-written fetch shows "wired by hand" and no controls; Unbind writes
// UNBOUND. Nothing here touches Yjs.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UNBOUND, type BlogBinding } from '@/utils/blogBinding';

const h = vi.hoisted(() => ({
  binding: null as BlogBinding | null,
  collections: [] as Array<{ name: string; posts: never[]; inferredFields: Array<{ name: string; type: string }> }>,
  pushUndo: vi.fn(),
  bind: vi.fn(),
  move: vi.fn(),
  assignments: new Map<string, { card: boolean; collections: string[]; typed: string | null; conflict: string[] }>(),
  current: null as string | null,
  builtIn: [
    { name: 'BlogPaginationNumbered', path: 'src/components/library/BlogPaginationNumbered.astro', source: 'built-in' },
    { name: 'BlogPaginationLoadMore', path: 'src/components/library/BlogPaginationLoadMore.astro', source: 'built-in' },
  ],
}));

vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p' }));
vi.mock('@/components/Editor/localBlogBind', () => ({ bindLocalBlogSlot: (...a: unknown[]) => h.bind(...a), assignedCardFor: () => h.current, renderedCardOf: () => null }));
vi.mock('@/components/Editor/localCardMove', () => ({ pickListingCard: (...a: unknown[]) => h.move(...a) }));
vi.mock('@/utils/cardTitleLock', () => ({ allCardAssignments: () => h.assignments, projectSourcesSnapshot: () => ({}), useCardTitleLockVersion: () => 0 }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ pushStructuralUndo: h.pushUndo, takeSnapshot: vi.fn(), claimSnapshot: vi.fn() }) }));
vi.mock('@/utils/localPageSync', () => ({ getLocalPageFile: () => 'src/pages/blog.astro' }));

import { BlogBindingBlock } from '../blocks/BlogBindingBlock';

const WORKS = { name: 'works', posts: [] as never[], inferredFields: [{ name: 'date', type: 'date' }, { name: 'featured', type: 'boolean' }, { name: 'title', type: 'text' }] };
const NOTES = { name: 'notes', posts: [] as never[], inferredFields: [{ name: 'title', type: 'text' }] };

const lastBinding = () => (h.bind.mock.calls.at(-1)![0] as { binding: BlogBinding }).binding;

beforeEach(() => {
  h.bind.mockReset().mockResolvedValue({ ok: true });
  h.pushUndo.mockReset();
  h.collections = [WORKS, NOTES];
  h.binding = UNBOUND;
  h.move.mockReset().mockResolvedValue(true);
  h.assignments.clear();
  h.current = null;
});

describe('BlogBindingBlock — Card (owner 2026-10-09: assign a card to a content collection)', () => {
  const bound = { ...UNBOUND, hasSlot: true, collection: 'works', sort: 'date-desc' as const, href: '/works/' };
  it('shows the collection\'s current card; picking another makes it that collection\'s card (the Assets move)', () => {
    h.assignments.set('src/components/WorksCard.astro', { card: true, collections: ['works'], typed: null, conflict: [] });
    h.assignments.set('src/components/WorkCard.astro', { card: true, collections: ['works'], typed: 'works', conflict: [] });
    h.assignments.set('src/components/WorkList.astro', { card: false, collections: ['works'], typed: 'works', conflict: [] });
    h.current = 'src/components/WorksCard.astro';
    render(<BlogBindingBlock binding={bound} collections={h.collections} builtIn={h.builtIn as never} />);
    const select = screen.getByLabelText('Card') as HTMLSelectElement;
    expect(select.value).toBe('src/components/WorksCard.astro');
    expect([...select.options].map((o) => o.textContent)).toEqual(['WorkCard', 'WorksCard']); // cards only, no lists
    fireEvent.change(select, { target: { value: 'src/components/WorkCard.astro' } });
    expect(h.move).toHaveBeenCalledWith(expect.objectContaining({ pageFile: 'src/pages/blog.astro', cardFile: 'src/components/WorkCard.astro', collection: 'works', fields: WORKS.inferredFields, current: 'works' }));
    expect(h.bind).not.toHaveBeenCalled();
  });
  it('a card not set up for the collection is labelled so; picking it assigns it in the same gesture', () => {
    h.assignments.set('src/components/WorksCard.astro', { card: true, collections: ['works'], typed: null, conflict: [] });
    h.assignments.set('src/components/NoteCard.astro', { card: true, collections: ['notes'], typed: 'notes', conflict: [] });
    h.current = 'src/components/WorksCard.astro';
    render(<BlogBindingBlock binding={bound} collections={h.collections} builtIn={h.builtIn as never} />);
    const select = screen.getByLabelText('Card') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['NoteCard', 'WorksCard']);
    fireEvent.change(select, { target: { value: 'src/components/NoteCard.astro' } });
    expect(h.move).toHaveBeenCalledWith(expect.objectContaining({ cardFile: 'src/components/NoteCard.astro', collection: 'works', current: 'notes' }));
  });
  it('no cards in the project → no Card row', () => {
    render(<BlogBindingBlock binding={bound} collections={h.collections} builtIn={h.builtIn as never} />);
    expect(screen.queryByLabelText('Card')).toBeNull();
  });
});

describe('BlogBindingBlock', () => {
  it('binding to a collection writes the page: default sort date-desc (the post link is the writer\'s to resolve)', async () => {
    render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    await waitFor(() => expect(screen.getByLabelText('Collection')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'works' } });
    await waitFor(() => expect(h.bind).toHaveBeenCalledTimes(1));
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({
      pageFile: 'src/pages/blog.astro', localProjectPath: 'wc://p', pushUndo: h.pushUndo,
      binding: { ...UNBOUND, collection: 'works', sort: 'date-desc', href: null },
    }));
  });

  it('a collection with no date sorts by title', async () => {
    render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'notes' } });
    await waitFor(() => expect(h.bind).toHaveBeenCalledTimes(1));
    expect(lastBinding()).toEqual({ ...UNBOUND, collection: 'notes', sort: 'title-asc', href: null });
  });

  it('a custom binding shows "wired by hand" and no controls', () => {
    h.binding = { ...UNBOUND, collection: 'works', custom: true };
    render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    expect(screen.getByText(/wired by hand/i)).toBeTruthy();
    expect(screen.queryByLabelText('Collection')).toBeNull();
  });

  it('bound: sort / filter / limit each rewrite the whole binding; options follow the schema', async () => {
    h.binding = { ...UNBOUND, collection: 'works', sort: 'date-desc', href: '/works/' };
    const { rerender } = render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    const sort = screen.getByLabelText('Sort') as HTMLSelectElement;
    expect(Array.from(sort.options).map((o) => o.value)).toEqual(['date-desc', 'date-asc', 'title-asc', 'title-desc']);
    fireEvent.change(sort, { target: { value: 'title-asc' } });
    expect(lastBinding().sort).toBe('title-asc');

    const filter = screen.getByLabelText('Filter') as HTMLSelectElement;
    expect(Array.from(filter.options).map((o) => o.value)).toEqual(['', 'featured', '!featured']);
    expect(Array.from(filter.options).map((o) => o.text)).toEqual(['All posts', 'Only featured', 'Only not featured']);
    fireEvent.change(filter, { target: { value: 'featured' } });
    expect(lastBinding().filter).toEqual({ field: 'featured' });
    fireEvent.change(filter, { target: { value: '!featured' } });
    expect(lastBinding().filter).toEqual({ field: 'featured', not: true });

    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '6' } });
    expect(lastBinding().limit).toBe(6);
    h.binding = { ...h.binding, limit: 6 }; // the write landed; the file re-read shows 6
    rerender(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '' } });
    expect(lastBinding().limit).toBeNull();

    expect(screen.getByText('/works/[slug]')).toBeTruthy();
  });

  it('re-binding drops a sort/filter the new schema lacks', async () => {
    h.binding = { ...UNBOUND, collection: 'works', sort: 'date-desc', filter: { field: 'featured' }, limit: 6, href: '/works/' };
    render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    fireEvent.change(screen.getByLabelText('Collection'), { target: { value: 'notes' } });
    await waitFor(() => expect(h.bind).toHaveBeenCalledTimes(1));
    expect(lastBinding()).toEqual({ ...UNBOUND, collection: 'notes', sort: 'title-asc', filter: null, limit: 6, href: null });
  });

  it('Unbind writes the UNBOUND binding', () => {
    h.binding = { ...UNBOUND, collection: 'works', sort: 'date-desc' };
    render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unbind' }));
    expect(lastBinding()).toEqual(UNBOUND);
  });

  it('a page without a slot / no binding yet renders nothing', () => {
    h.binding = null;
    const { container } = render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    expect(container.textContent).toBe('');
  });

  it('pagination: picking a kind writes it with page size 3 and the chrome component; per-page rewrites; none drops it', () => {
    h.binding = { ...UNBOUND, collection: 'works', sort: 'date-desc', href: '/works/' };
    const { rerender } = render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    expect(screen.queryByLabelText('Per page')).toBeNull();
    fireEvent.change(screen.getByLabelText('Pagination'), { target: { value: 'numbered' } });
    expect(h.bind).toHaveBeenLastCalledWith(expect.objectContaining({
      binding: { ...h.binding, pagination: { kind: 'numbered', pageSize: 3 } },
      chromeComponent: expect.objectContaining({ name: 'BlogPaginationNumbered' }),
    }));
    h.binding = { ...h.binding, pagination: { kind: 'numbered', pageSize: 3 } };
    rerender(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    fireEvent.change(screen.getByLabelText('Per page'), { target: { value: '5' } });
    expect(lastBinding().pagination).toEqual({ kind: 'numbered', pageSize: 5 });
    fireEvent.change(screen.getByLabelText('Pagination'), { target: { value: 'load-more' } });
    expect(lastBinding().pagination).toEqual({ kind: 'load-more', pageSize: 3 });
    expect((h.bind.mock.calls.at(-1)![0] as { chromeComponent: { name: string } }).chromeComponent.name).toBe('BlogPaginationLoadMore');
    fireEvent.change(screen.getByLabelText('Pagination'), { target: { value: 'none' } });
    expect(lastBinding().pagination).toEqual({ kind: 'none' });
    expect((h.bind.mock.calls.at(-1)![0] as { chromeComponent: unknown }).chromeComponent).toBeNull();
  });

  it('with no collections in the project it says so instead of a dead select', () => {
    h.collections = [];
    h.binding = UNBOUND;
    render(<BlogBindingBlock binding={h.binding} collections={h.collections} builtIn={h.builtIn as never} />);
    expect(screen.getByText(/No content collections found/)).toBeTruthy();
    expect(screen.queryByLabelText('Collection')).toBeNull();
  });
});

describe('BlogBindingBlock — the selected slot of a multi-slot page (task-244 L17/L18/L19)', () => {
  const second = { ...UNBOUND, hasSlot: true, collection: 'works', sort: 'date-desc' as const, slot: 1, postsVar: 'posts2', slotCount: 2 };
  it('writes and picks cards for THAT slot; Numbered is not offered with two slots', () => {
    h.assignments.set('src/components/WorkCard.astro', { card: true, collections: ['works'], typed: 'works', conflict: [] });
    h.assignments.set('src/components/FeaturedWork.astro', { card: true, collections: ['works'], typed: 'works', conflict: [] });
    h.current = 'src/components/WorkCard.astro';
    render(<BlogBindingBlock binding={second} collections={h.collections} builtIn={h.builtIn as never} />);
    expect([...(screen.getByLabelText('Pagination') as HTMLSelectElement).options].map((o) => o.value)).toEqual(['none', 'load-more']);
    fireEvent.change(screen.getByLabelText('Sort'), { target: { value: 'title-asc' } });
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ slot: 1, binding: expect.objectContaining({ sort: 'title-asc' }) }));
    fireEvent.change(screen.getByLabelText('Card'), { target: { value: 'src/components/FeaturedWork.astro' } });
    expect(h.move).toHaveBeenCalledWith(expect.objectContaining({ slot: 1, cardFile: 'src/components/FeaturedWork.astro' }));
  });
});

