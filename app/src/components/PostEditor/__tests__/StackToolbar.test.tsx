import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StackToolbar } from '../StackToolbar';

const base = { direction: 'row' as const, ratio: '1:1' as const, width: 'reading' as const, nested: false, colored: true };

describe('StackToolbar', () => {
  it('each control dispatches its action', () => {
    const onAction = vi.fn();
    render(<StackToolbar {...base} onAction={onAction} />);
    fireEvent.click(screen.getByLabelText('Stacked'));
    fireEvent.click(screen.getByLabelText('Wider first column'));
    fireEvent.click(screen.getByLabelText('Swap sides'));
    fireEvent.click(screen.getByLabelText('Full width'));
    fireEvent.click(screen.getByLabelText('More layout actions'));
    fireEvent.click(screen.getByText('Remove color'));
    expect(onAction.mock.calls.map(c => c[0])).toEqual([
      { type: 'direction', direction: 'column' },
      { type: 'ratio', ratio: '2:1' },
      { type: 'swap' },
      { type: 'width', width: 'edge' },
      { type: 'remove-color' },
    ]);
  });

  it('nested rows have no width group; columns have no ratio/swap', () => {
    const { rerender } = render(<StackToolbar {...base} nested onAction={() => {}} />);
    expect(screen.queryByLabelText('Wide')).toBeNull();
    rerender(<StackToolbar {...base} direction="column" onAction={() => {}} />);
    expect(screen.queryByLabelText('Swap sides')).toBeNull();
    expect(screen.getByLabelText('Wide')).toBeInTheDocument();
  });

  it('a column holding a row cannot switch to side by side', () => {
    render(<StackToolbar {...base} direction="column" canRow={false} onAction={() => {}} />);
    expect(screen.getByLabelText('Side by side')).toBeDisabled();
  });

  it('Remove color only when colored', () => {
    render(<StackToolbar {...base} colored={false} onAction={() => {}} />);
    fireEvent.click(screen.getByLabelText('More layout actions'));
    expect(screen.queryByText('Remove color')).toBeNull();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
});
