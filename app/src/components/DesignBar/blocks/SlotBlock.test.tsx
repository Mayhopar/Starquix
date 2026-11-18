/**
 * SlotBlock Tests (task-006)
 *
 * Regression tests for the DesignBar SlotBlock — the UI that lets a user edit
 * an Astro <slot /> element's `name` attribute without hand-editing source.
 * Covers:
 * - Populating the input from the Yjs attributes.name value
 * - Commit on Enter (blur) -> takeSnapshot + SET_SLOT_NAME dispatch (trimmed)
 * - Commit on blur -> SET_SLOT_NAME
 * - No dispatch when the value is unchanged
 * - Escape reverts the edit without dispatching
 * - Clearing the name dispatches SET_SLOT_NAME with ''
 *
 * Mocks the store hooks + Undo context so dispatch/takeSnapshot can be asserted
 * in isolation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockDispatch = vi.fn();
const mockTakeSnapshot = vi.fn();
let mockSlotName = '';

vi.mock('@/context/UndoContext', () => ({
  useUndoContext: () => ({ takeSnapshot: mockTakeSnapshot }),
}));

vi.mock('@/store/hooks', () => ({
  useDispatch: () => mockDispatch,
  useYjsValue: () => mockSlotName,
}));

// Import LAST so mocks are wired up first
import { SlotBlock } from './SlotBlock';

beforeEach(() => {
  mockDispatch.mockClear();
  mockTakeSnapshot.mockClear();
  mockSlotName = '';
});

describe('SlotBlock', () => {
  it('populates the input from the Yjs slot name', () => {
    mockSlotName = 'header';
    render(<SlotBlock elementKey="slot-1" />);
    expect(screen.getByPlaceholderText('default')).toHaveValue('header');
    expect(screen.getByText('Targeted as slot="header"')).toBeInTheDocument();
  });

  it('shows "Default slot" hint when empty', () => {
    render(<SlotBlock elementKey="slot-1" />);
    expect(screen.getByText('Default slot')).toBeInTheDocument();
  });

  it('commits a trimmed name on Enter via SET_SLOT_NAME', () => {
    render(<SlotBlock elementKey="slot-1" />);
    const input = screen.getByPlaceholderText('default');
    fireEvent.change(input, { target: { value: '  footer  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);

    expect(mockTakeSnapshot).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_SLOT_NAME',
      elementId: 'slot-1',
      name: 'footer',
    });
  });

  it('commits on blur', () => {
    render(<SlotBlock elementKey="slot-1" />);
    const input = screen.getByPlaceholderText('default');
    fireEvent.change(input, { target: { value: 'aside' } });
    fireEvent.blur(input);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_SLOT_NAME',
      elementId: 'slot-1',
      name: 'aside',
    });
  });

  it('does not dispatch when the value is unchanged', () => {
    mockSlotName = 'header';
    render(<SlotBlock elementKey="slot-1" />);
    const input = screen.getByPlaceholderText('default');
    fireEvent.blur(input);

    expect(mockDispatch).not.toHaveBeenCalled();
    expect(mockTakeSnapshot).not.toHaveBeenCalled();
  });

  it('Escape reverts the edit without dispatching', () => {
    mockSlotName = 'header';
    render(<SlotBlock elementKey="slot-1" />);
    const input = screen.getByPlaceholderText('default');
    fireEvent.change(input, { target: { value: 'changed' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.blur(input);

    expect(input).toHaveValue('header');
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('dispatches an empty name when the user clears it', () => {
    mockSlotName = 'header';
    render(<SlotBlock elementKey="slot-1" />);
    const input = screen.getByPlaceholderText('default');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'SET_SLOT_NAME',
      elementId: 'slot-1',
      name: '',
    });
  });
});
