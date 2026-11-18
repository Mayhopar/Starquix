import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SlashMenu, slashItemsFor, TEXT_ITEMS, type SlashItem } from '../SlashMenu';

const MEDIA = { name: 'Media', path: 'src/components/sq/Media.astro' };
const CREDIT = { name: 'Credit', path: 'src/components/sq/Credit.astro' };
const ALBUM = { name: 'Album', path: 'src/components/sq/Album.astro' };
const THEIRS = { name: 'SingleImage', path: 'src/components/SingleImage.astro' };

const ITEMS: SlashItem[] = slashItemsFor([MEDIA]);

function mount(over: Partial<Parameters<typeof SlashMenu>[0]> = {}) {
  const onPick = vi.fn();
  const onDismiss = vi.fn();
  render(
    <SlashMenu items={ITEMS} left={10} top={20} onPick={onPick} onDismiss={onDismiss} {...over} />,
  );
  return { onPick, onDismiss };
}

/**
 * task-207 D12: the menu lists the sq/ FOLDER, ours first. No registry — that
 * is the whole point: promoting a component is what makes it insertable.
 */
describe('slashItemsFor', () => {
  it('never lists the hidden system Stack (layouts own it), even when scanned', () => {
    const stack = { name: 'Stack', path: 'src/components/sq/Stack.astro' };
    expect(slashItemsFor([MEDIA, stack]).map(i => i.component)).toEqual(['Media']);
  });

  it('lists only components under sq/ — the rest are the user’s own markup', () => {
    expect(slashItemsFor([MEDIA, THEIRS, CREDIT]).map(i => i.component))
      .toEqual(['Media', 'Credit']);
  });

  it('sorts OURS first, then the user’s promoted ones alphabetically', () => {
    expect(slashItemsFor([CREDIT, ALBUM, MEDIA]).map(i => i.component))
      .toEqual(['Media', 'Album', 'Credit']);
  });

  it('captions ours specifically and promoted ones generically', () => {
    const [media, credit] = slashItemsFor([MEDIA, CREDIT]);
    expect(media.caption).toBe('Image, or a row of 2–3');
    expect(credit.caption).toBe('From your components');
  });

  /**
   * REGRESSION: OURS are copied into sq/ by ensure-sq-component on FIRST
   * insert, so they are never in the scan until after one has been inserted.
   * Deriving the menu purely from the scan made Media uninsertable on every
   * fresh project — the menu must always offer ours.
   */
  it('always offers OURS, even before sq/ exists at all', () => {
    expect(slashItemsFor([]).map(i => i.component)).toEqual(['Media']);
    expect(slashItemsFor([THEIRS]).map(i => i.component)).toEqual(['Media']);
  });

  it('does not list ours twice once it HAS been copied into sq/', () => {
    expect(slashItemsFor([MEDIA]).map(i => i.component)).toEqual(['Media']);
  });

  it('de-dupes a name that appears twice in the scan', () => {
    expect(slashItemsFor([MEDIA, MEDIA]).map(i => i.component)).toEqual(['Media']);
  });
});

describe('SlashMenu', () => {
  it('renders the items it is given', () => {
    mount({ items: slashItemsFor([MEDIA, CREDIT]) });
    expect(screen.getByText('Media')).toBeTruthy();
    expect(screen.getByText('Credit')).toBeTruthy();
  });

  it('reports the picked item', () => {
    const { onPick } = mount();
    fireEvent.click(screen.getByText('Media'));
    expect(onPick).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('picks the item when its icon is clicked', () => {
    const { onPick } = mount();
    fireEvent.click(screen.getByRole('option', { name: /Media/ }).querySelector('svg')!);
    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('says how to get components instead of showing a blank panel', () => {
    mount({ items: [] });
    expect(screen.getByText(/Add a component to this menu/)).toBeTruthy();
  });

  it('a .md post gets the writing blocks it CAN insert, and says why components are missing', () => {
    // A .md post cannot render a component; the menu offers what works instead of a dead end.
    mount({ items: [...TEXT_ITEMS], disabledReason: 'Layouts and components need an .mdx post.' });
    expect(screen.queryByText('Media')).toBeNull();
    expect(screen.getByRole('option', { name: /Heading/ })).toBeTruthy();
    expect(screen.getByText(/need an \.mdx post/)).toBeTruthy();
  });

  it('groups rows under labels and moves the highlight on hover', () => {
    const onActivate = vi.fn();
    mount({ items: [...TEXT_ITEMS, ...ITEMS], onActivate });
    expect(screen.getByText('Text')).toBeTruthy();
    expect(screen.getByText('Media & components')).toBeTruthy();
    fireEvent.mouseEnter(screen.getByRole('option', { name: /Quote/ }));
    expect(onActivate).toHaveBeenCalledWith(TEXT_ITEMS.findIndex(i => i.text === 'quote'));
  });

  it('does not steal the selection on mousedown', () => {
    mount();
    const evt = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(screen.getByText('Media'), evt);
    expect(evt.defaultPrevented).toBe(true);
  });
});
