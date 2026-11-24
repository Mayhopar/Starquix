import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SelectionProvider, useSelectionContext } from '@/context/SelectionContext';
import { LayerContextMenu } from '../LayerContextMenu';
import { layerMenu } from '../layerMenuStore';

const { wrap } = vi.hoisted(() => ({ wrap: vi.fn() }));
vi.mock('@/hooks/useWrapSelection', () => ({ useWrapSelection: () => wrap }));

let selection: ReturnType<typeof useSelectionContext>;
function Grab() { selection = useSelectionContext(); return null; }

function mount() {
  render(<SelectionProvider><Grab /><LayerContextMenu /></SelectionProvider>);
}

describe('LayerContextMenu', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    wrap.mockClear();
  });
  afterEach(() => { act(() => layerMenu.open(null)); });

  it('shows "Create container" with the shortcut at the point; picking it closes and wraps', () => {
    mount();
    act(() => { selection.select('a:1:1'); layerMenu.open({ x: 40, y: 50 }); });
    const item = screen.getByRole('menuitem', { name: /Create container/ });
    expect(item.textContent).toContain('⌘G');
    fireEvent.click(item);
    expect(wrap).toHaveBeenCalledTimes(1);
    expect(layerMenu.get()).toBeNull();
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('names Ctrl+Alt+G off a Mac', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    mount();
    act(() => { selection.select('a:1:1'); layerMenu.open({ x: 1, y: 1 }); });
    expect(screen.getByRole('menuitem').textContent).toContain('Ctrl+Alt+G');
  });

  it('never opens without a selection, and closes when the selection empties', () => {
    mount();
    act(() => layerMenu.open({ x: 1, y: 1 }));
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(layerMenu.get()).toBeNull();

    act(() => { selection.select('a:1:1'); layerMenu.open({ x: 1, y: 1 }); });
    expect(screen.getByRole('menuitem')).toBeTruthy();
    act(() => selection.select(null));
    expect(screen.queryByRole('menuitem')).toBeNull();
    expect(layerMenu.get()).toBeNull();
  });

  it('Escape closes without wrapping', () => {
    mount();
    act(() => { selection.select('a:1:1'); layerMenu.open({ x: 1, y: 1 }); });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(layerMenu.get()).toBeNull();
    expect(wrap).not.toHaveBeenCalled();
  });

  it('an armed point is dropped by the next mousedown and by open()', () => {
    mount();
    layerMenu.arm({ x: 1, y: 1 });
    fireEvent.mouseDown(document.body);
    expect(layerMenu.takeArmed()).toBeNull();
    layerMenu.arm({ x: 1, y: 1 });
    act(() => layerMenu.open(null));
    expect(layerMenu.takeArmed()).toBeNull();
    layerMenu.arm({ x: 2, y: 3 });
    expect(layerMenu.takeArmed()).toEqual({ x: 2, y: 3 });
    expect(layerMenu.takeArmed()).toBeNull();
  });
});
