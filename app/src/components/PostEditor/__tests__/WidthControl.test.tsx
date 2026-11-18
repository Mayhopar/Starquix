import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { WidthModes } from '../WidthControl';

// Width modes button group: 8 (text measure, span null), 12, full.
describe('WidthModes', () => {
  it('reports the picked mode', () => {
    const onChange = vi.fn();
    render(<WidthModes span={null} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Wide'));
    expect(onChange).toHaveBeenCalledWith(12);
    fireEvent.click(screen.getByLabelText('Full width'));
    expect(onChange).toHaveBeenCalledWith('full');
  });

  it('the 8-col mode reports null (unwraps back to the measure)', () => {
    const onChange = vi.fn();
    render(<WidthModes span={'full'} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Text width'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('marks the active mode; explicit span 8 reads as the default', () => {
    render(<WidthModes span={8} onChange={() => {}} />);
    expect(screen.getByLabelText('Text width').classList.contains('bg-btn-ghost-active')).toBe(true);
    expect(screen.getByLabelText('Full width').classList.contains('bg-btn-ghost-active')).toBe(false);
  });
});
