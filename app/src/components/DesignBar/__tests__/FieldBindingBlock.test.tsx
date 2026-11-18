// FieldBindingBlock (task-240 Phase 2): in the BlogCard MASTER a text/img
// element gets a field picker that rewrites the component file; on a page
// INSTANCE it is read-only ("Bound to title") with a jump to the master.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  field: null as string | null,
  dateFormat: null as string | null,
  slot: null as string | null,
  rewrite: vi.fn(),
  takeSnapshot: vi.fn(),
  snapshot: { commit: () => {} },
  bindable: true,
  bind: vi.fn(),
  goToSource: vi.fn(),
  pushUndo: vi.fn(),
  collections: [{ name: 'works', posts: [] as never[], inferredFields: [{ name: 'title', type: 'text' }, { name: 'image', type: 'image' }, { name: 'date', type: 'date' }, { name: 'my-key', type: 'text' }] }],
}));
vi.mock('@/hooks/useFieldBinding', () => ({ useFieldBinding: () => ({ field: h.field, bindable: h.bindable, slot: h.slot, dateFormat: h.dateFormat }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://p' }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ pushStructuralUndo: h.pushUndo, takeSnapshot: h.takeSnapshot, claimSnapshot: () => h.snapshot }) }));
vi.mock('@/components/Editor/localFieldBind', () => ({ bindLocalField: (...a: unknown[]) => h.bind(...a) }));
vi.mock('@/utils/localElementSource', () => ({ rewriteLocalFile: (...a: unknown[]) => h.rewrite(...a) }));
vi.mock('../HeaderActionButtons', () => ({ goToSource: (...a: unknown[]) => h.goToSource(...a) }));

import { FieldBindingBlock } from '../blocks/FieldBindingBlock';
import { IMPORTED_CARD } from '@/utils/__tests__/fixtures/cards';
import { assignCard, readSetup, type Setup } from '@/utils/cardSetup';
import { _resetCardTitleLocksForTests, setCardSource } from '@/utils/cardTitleLock';
import { _resetCardCollectionViewsForTests } from '@/utils/cardCollectionView';

const LOC = { file: 'src/components/BlogCard.astro', line: 6, column: 3 };

beforeEach(() => { h.bind.mockReset().mockResolvedValue({ ok: true }); h.goToSource.mockReset(); h.field = null; h.dateFormat = null; h.slot = null; h.bindable = true; h.rewrite.mockReset().mockResolvedValue({}); _resetCardTitleLocksForTests(); _resetCardCollectionViewsForTests(); });

describe('FieldBindingBlock', () => {
  it('master: a text element offers text-like fields only (no image, no non-identifier keys) and writes the pick', () => {
    render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="h3" mode="master" />);
    const select = screen.getByLabelText('Field') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['', 'title', 'date']);
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Static text', 'title', 'date']);
    fireEvent.change(select, { target: { value: 'date' } });
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ loc: LOC, tagName: 'h3', field: 'date', fieldType: 'date', pushUndo: h.pushUndo }));
  });

  it('master: a text element bound to a date field picks its format (owner 2026-10-10); other fields have none', () => {
    h.field = 'date'; h.dateFormat = '';
    render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="time" mode="master" />);
    const format = screen.getByLabelText('Date format') as HTMLSelectElement;
    expect(format.value).toBe('');
    expect(Array.from(format.options).map((o) => o.textContent)).toContain('Oct 8, 2026');
    fireEvent.change(format, { target: { value: 'long' } });
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ loc: LOC, tagName: 'time', field: 'date', fieldType: 'date', dateFormat: 'long', pushUndo: h.pushUndo }));
  });

  it('master: no Format for a non-date field', () => {
    h.field = 'subtitle'; h.dateFormat = '';
    render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="p" mode="master" />);
    expect(screen.queryByLabelText('Date format')).toBeNull();
  });

  it('master: the title element is locked — no picker, a lock (owner 2026-10-09)', () => {
    h.field = 'title';
    render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="h3" mode="master" />);
    expect(screen.queryByLabelText('Field')).toBeNull();
    expect(screen.getByText('Bound to title')).toBeTruthy();
    expect(screen.getByLabelText('Blog title cannot be deleted')).toBeTruthy();
  });

  it('master: "Static text" unbinds a text element; an img offers image fields only', () => {
    h.field = 'date';
    render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="h3" mode="master" />);
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: '' } });
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ field: null }));
    const { unmount } = render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="img" mode="master" />);
    const imgSelect = screen.getAllByLabelText('Field').at(-1) as HTMLSelectElement;
    expect(Array.from(imgSelect.options).map((o) => o.value)).toEqual(['image']);
    unmount();
  });

  it('instance: read-only read-back + a jump to the master; unbound renders nothing', () => {
    h.field = 'title';
    render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="h3" mode="instance" />);
    expect(screen.getByText(/Bound to title/)).toBeTruthy();
    expect(screen.queryByLabelText('Field')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Edit in card/ }));
    expect(h.goToSource).toHaveBeenCalledWith('src/components/BlogCard.astro', null);
    h.field = null;
    const { container } = render(<FieldBindingBlock collections={h.collections} sourceLocation={LOC} tagName="h3" mode="instance" />);
    expect(container.textContent).toBe('');
  });
});

describe('FieldBindingBlock — a placeholder box takes an image field', () => {
  const BOX = { file: 'src/components/BlogCard.astro', line: 15, column: 3 };

  it('master: a box lists image fields only (plus None while unbound) and writes the pick as an image', () => {
    render(<FieldBindingBlock collections={h.collections} sourceLocation={BOX} tagName="div" mode="master" />);
    const select = screen.getByLabelText('Field') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['None', 'image']);
    fireEvent.change(select, { target: { value: 'image' } });
    expect(h.bind).toHaveBeenCalledWith(expect.objectContaining({ loc: BOX, tagName: 'div', field: 'image', fieldType: 'image' }));
  });

  it('master: a box with block children (not bindable) or no image field in the schema renders nothing', () => {
    h.bindable = false;
    const a = render(<FieldBindingBlock collections={h.collections} sourceLocation={BOX} tagName="div" mode="master" />);
    expect(a.container.textContent).toBe('');
    a.unmount();
    h.bindable = true;
    const b = render(<FieldBindingBlock collections={[{ inferredFields: [{ name: 'title', type: 'text' }] }]} sourceLocation={BOX} tagName="div" mode="master" />);
    expect(b.container.textContent).toBe('');
  });

  it('instance: a bound box reads back like any bound element', () => {
    h.field = 'image';
    render(<FieldBindingBlock collections={h.collections} sourceLocation={BOX} tagName="div" mode="instance" />);
    expect(screen.getByText(/Bound to image/)).toBeTruthy();
  });
});

describe('FieldBindingBlock — block-form card (per collection)', () => {
  const W = 'src/components/WorkCard.astro';
  const WORKS = { name: 'works', inferredFields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'text' }] };
  const BLOG = { name: 'blog', inferredFields: [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }, { name: 'date', type: 'date' }, { name: 'cover', type: 'image' }] };
  const card = () => assignCard(IMPORTED_CARD, 'blog', BLOG.inferredFields, 'works');
  beforeEach(() => { setCardSource(W, card()); });

  it("the viewed collection's mapping; options = its fields kind-strict + None; a pick writes ONLY that collection", async () => {
    h.slot = 'description';
    render(<FieldBindingBlock collections={[WORKS, BLOG]} sourceLocation={{ file: W, line: 20, column: 13 }} tagName="p" mode="instance" listingCollection="blog" />);
    const select = screen.getByLabelText('Field') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect([...select.options].map((o) => o.value)).toEqual(['', 'title', 'subtitle', 'date']);
    fireEvent.change(select, { target: { value: 'subtitle' } });
    await vi.waitFor(() => expect(h.rewrite).toHaveBeenCalledWith(W, expect.any(Function), h.snapshot));
    const out = (h.rewrite.mock.calls[0][1] as (s: string) => string)(card());
    expect((readSetup(out) as Setup).get('blog')!.get('description')).toBe('subtitle');
    expect((readSetup(out) as Setup).get('works')!.get('description')).toBe('description');
    expect(h.bind).not.toHaveBeenCalled();
  });
  it('the title slot is locked', () => {
    h.slot = 'title';
    render(<FieldBindingBlock collections={[WORKS, BLOG]} sourceLocation={{ file: W, line: 15, column: 13 }} tagName="h1" mode="master" />);
    expect(screen.queryByLabelText('Field')).toBeNull();
    expect(screen.getByLabelText('Blog title cannot be deleted')).toBeTruthy();
  });
});
