import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { DEFAULT_CARD } from '@/utils/cardFields';

const h = vi.hoisted(() => ({ src: '', rewrite: vi.fn(), assign: vi.fn(), takeSnapshot: vi.fn(), snapshot: { commit: () => {} },
  select: vi.fn(), selectedKey: null as string | null, scanned: [] as Array<{ key: string; tagName: string; classes: string; sourceLocation?: { file: string; line: number; column: number } }> }));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElements: () => ({ scannedElements: h.scanned, scannedByKey: new Map(h.scanned.map((e) => [e.key, e])) }),
  useSelectionContext: () => ({ selectedKey: h.selectedKey, select: h.select }),
}));
vi.mock('@/utils/cardTitleLock', () => ({ useCardTitleLockVersion: () => 0, cardFieldAt: (loc: { line: number }) => (loc.line === 7 ? 'description' : null) }));
vi.mock('@/utils/localElementSource', () => ({
  readLocalFile: async () => h.src,
  rewriteLocalFile: (...a: unknown[]) => h.rewrite(...a),
}));
vi.mock('@/components/Editor/localCardMove', () => ({ assignCardToCollection: (...a: unknown[]) => h.assign(...a) }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: h.takeSnapshot, claimSnapshot: () => h.snapshot }) }));

import { CardFieldsBlock } from '../CardFieldsBlock';
import { IMPORTED_CARD } from '@/utils/__tests__/fixtures/cards';
import { assignCard, fieldStatesIn, readSetup, setSlotField } from '@/utils/cardSetup';
import { _resetCardCollectionViewsForTests } from '@/utils/cardCollectionView';

const COLLECTIONS = [{ name: 'works', inferredFields: [{ name: 'title', type: 'text' }, { name: 'description', type: 'text' }, { name: 'author', type: 'text' }] }];

beforeEach(() => {
  h.src = DEFAULT_CARD; h.takeSnapshot.mockReset(); h.select.mockReset(); h.selectedKey = null; h.scanned = []; h.assign.mockReset(); _resetCardCollectionViewsForTests();
  h.rewrite.mockReset().mockImplementation(async (_f: string, compute: (s: string) => string) => { h.src = compute(h.src); return { created: false, changed: true }; });
});

describe('CardFieldsBlock — per-collection field eyes', () => {
  it('only fields an element of the card shows are listed; the title has a lock; an absent field is not listed (owner 2026-10-11)', async () => {
    render(<CardFieldsBlock file="src/components/WorksCard.astro" collections={COLLECTIONS} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hide description' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /title/ })).toBeNull();
    expect(screen.getByLabelText('Blog title cannot be deleted')).toBeTruthy();
    expect(screen.queryByText('author')).toBeNull();
    expect(h.rewrite).not.toHaveBeenCalled();
  });

  it('eye off rewrites the card (undoable) with the guard; eye on brings it back', async () => {
    render(<CardFieldsBlock file="src/components/WorksCard.astro" collections={COLLECTIONS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide description' }));
    await waitFor(() => expect(h.src).toContain('const show = { description: false };'));
    expect(h.rewrite).toHaveBeenCalledWith('src/components/WorksCard.astro', expect.any(Function), h.snapshot);
    expect(h.takeSnapshot).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Show description' }));
    await waitFor(() => expect(h.src).toContain('const show = { description: true };'));
    expect(h.src).toContain('{show.description && <p');
  });
});

describe('CardFieldsBlock — Fields ↔ canvas (owner 2026-10-11)', () => {
  it('clicking a field row selects its element (the selected card copy first); the selected element lights its row', async () => {
    const F = 'src/components/WorksCard.astro';
    h.scanned = [
      { key: `${F}:7:5~sA`, tagName: 'p', classes: '', sourceLocation: { file: F, line: 7, column: 5 } },
      { key: `${F}:7:5~sB`, tagName: 'p', classes: '', sourceLocation: { file: F, line: 7, column: 5 } },
      { key: `${F}:2:1~sB`, tagName: 'article', classes: '', sourceLocation: { file: F, line: 2, column: 1 } },
    ];
    h.selectedKey = `${F}:2:1~sB`;
    const { rerender } = render(<CardFieldsBlock file={F} collections={COLLECTIONS} />);
    fireEvent.click(await screen.findByText('description'));
    expect(h.select).toHaveBeenCalledWith(`${F}:7:5~sB`, expect.anything());
    h.selectedKey = `${F}:7:5~sB`;
    rerender(<CardFieldsBlock file={F} collections={COLLECTIONS} />);
    expect(screen.getByText('description').closest('[class*="bg-bg-selected"]')).not.toBeNull();
  });
  it('Remove selects the element and runs the one Delete path', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const F = 'src/components/WorksCard.astro';
    h.scanned = [{ key: `${F}:7:5~sA`, tagName: 'p', classes: '', sourceLocation: { file: F, line: 7, column: 5 } }];
    const keys: string[] = []; const on = (e: KeyboardEvent) => keys.push(e.key); document.addEventListener('keydown', on);
    render(<CardFieldsBlock file={F} collections={COLLECTIONS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove description' }));
    expect(h.select).toHaveBeenCalledWith(`${F}:7:5~sA`, expect.anything());
    await vi.advanceTimersByTimeAsync(60);
    expect(keys).toEqual(['Delete']);
    document.removeEventListener('keydown', on); vi.useRealTimers();
  });
});

describe('CardFieldsBlock — cards × collections', () => {
  const WORKS = { name: 'works', inferredFields: [{ name: 'image', type: 'image' }, { name: 'title', type: 'text' }, { name: 'description', type: 'text' }] };
  const BLOG = { name: 'blog', inferredFields: [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }, { name: 'date', type: 'date' }] };
  const twoCols = () => setSlotField(assignCard(IMPORTED_CARD, 'blog', BLOG.inferredFields, 'works'), 'blog', 'description', 'subtitle');

  it('a card clicked inside a blog listing: NO switcher; rows + eyes are that listing\'s collection only (owner 2026-10-11)', async () => {
    h.src = twoCols();
    render(<CardFieldsBlock file="src/components/WorkCard.astro" collections={[WORKS, BLOG]} listingCollection="blog" />);
    expect(await screen.findByRole('button', { name: 'Hide subtitle' })).toBeTruthy();
    expect(screen.queryByText('date')).toBeNull(); // a blog field no element of this card shows
    expect(screen.queryByRole('button', { name: /description/ })).toBeNull();
    expect(screen.queryByText('works')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide subtitle' }));
    await waitFor(() => expect((readSetup(h.src) as Map<string, Map<string, string | null>>).get('blog')!.get('description')).toBe('!subtitle'));
    expect((readSetup(h.src) as Map<string, Map<string, string | null>>).get('works')!.get('description')).toBe('description');
  });
  it('opened on its own (no listing) there is no switcher either: the card\'s first collection (owner 2026-10-11)', async () => {
    h.src = twoCols();
    render(<CardFieldsBlock file="src/components/WorkCard.astro" collections={[WORKS, BLOG]} />);
    expect(await screen.findByRole('button', { name: 'Hide description' })).toBeTruthy();
    expect(screen.queryByText('blog')).toBeNull();
  });
  it('a card in a listing it is not set up for: lists what its own elements would show there; nothing made up, no "Not set up" row', async () => {
    h.src = IMPORTED_CARD;
    render(<CardFieldsBlock file="src/components/WorkCard.astro" collections={[WORKS]} allCollections={[WORKS, BLOG]} conflict={['blog']} listingCollection="blog" />);
    expect(await screen.findByLabelText('Blog title cannot be deleted')).toBeTruthy();
    expect(screen.queryByText('subtitle')).toBeNull();
    expect(screen.queryByText('date')).toBeNull();
    expect(screen.queryByText('Not set up for blog')).toBeNull();
    expect(h.rewrite).not.toHaveBeenCalled();
  });
  it('a hand-edited fields block → no controls, says so', async () => {
    h.src = twoCols().replace("'blog': {", "'blog': {{");
    render(<CardFieldsBlock file="src/components/WorkCard.astro" collections={[WORKS, BLOG]} />);
    expect(await screen.findByText('Edited by hand — change it in Source')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Hide/ })).toBeNull();
  });
  it('a slot mapped to a field the collection lost is marked missing (L11)', async () => {
    h.src = twoCols();
    render(<CardFieldsBlock file="src/components/WorkCard.astro" collections={[WORKS, { ...BLOG, inferredFields: BLOG.inferredFields.filter((f) => f.name !== 'subtitle') }]} listingCollection="blog" />);
    expect(await screen.findByText('subtitle is missing in blog')).toBeTruthy();
  });
});
