/**
 * SlotTargetBlock Tests
 *
 * Per-element control: when a content root is selected and the page's layout
 * declares named slots, a dropdown places the element into a named slot (or the
 * default slot) via SET_ELEMENT_SLOT_NAME (takeSnapshot first).
 *
 * NOT to be confused with SlotBlock, which names a <slot/> while editing a layout.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
let mockState: { slotName: string; layoutName: string | null } = { slotName: '', layoutName: null };
let mockLayouts: Array<{ name: string; slots: string[] }> = [];

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => mockState,
}));

vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: mockLayouts, isLoading: false, error: null, refresh: vi.fn() }),
}));

import { SlotTargetBlock } from './SlotTargetBlock';

beforeEach(() => {
  mockDispatch.mockClear();
  mockTakeSnapshot.mockClear();
  mockState = { slotName: '', layoutName: null };
  mockLayouts = [];
});

describe('SlotTargetBlock', () => {
  it('renders nothing when the page has no layout', () => {
    const { container } = render(<SlotTargetBlock elementKey="el-a" pageId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the layout has only the default slot', () => {
    mockState = { slotName: '', layoutName: 'Marketing' };
    mockLayouts = [{ name: 'Marketing', slots: ['default'] }];
    const { container } = render(<SlotTargetBlock elementKey="el-a" pageId="p1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a dropdown with default + named slots when the layout declares them', () => {
    mockState = { slotName: 'sidebar', layoutName: 'Marketing' };
    mockLayouts = [{ name: 'Marketing', slots: ['default', 'sidebar', 'footer'] }];
    render(<SlotTargetBlock elementKey="el-a" pageId="p1" />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('sidebar');
    const optionLabels = Array.from(select.options).map((o) => o.value);
    expect(optionLabels).toEqual(['default', 'sidebar', 'footer']);
  });

  it('selecting a named slot dispatches SET_ELEMENT_SLOT_NAME + takeSnapshot', () => {
    mockState = { slotName: '', layoutName: 'Marketing' };
    mockLayouts = [{ name: 'Marketing', slots: ['default', 'sidebar'] }];
    render(<SlotTargetBlock elementKey="el-a" pageId="p1" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'sidebar' } });

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_ELEMENT_SLOT_NAME',
      elementId: 'el-a',
      slotName: 'sidebar',
    });
  });

  it('selecting default dispatches a null slotName', () => {
    mockState = { slotName: 'sidebar', layoutName: 'Marketing' };
    mockLayouts = [{ name: 'Marketing', slots: ['default', 'sidebar'] }];
    render(<SlotTargetBlock elementKey="el-a" pageId="p1" />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'default' } });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_ELEMENT_SLOT_NAME',
      elementId: 'el-a',
      slotName: null,
    });
  });
});
