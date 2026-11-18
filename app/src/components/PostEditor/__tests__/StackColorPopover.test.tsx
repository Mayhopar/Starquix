import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
// The palette UI is DesignBar's; here only its onChange contract matters.
vi.mock('@/components/DesignBar/ColorPicker', () => ({
  ColorPicker: ({ prefix, onChange }: { prefix: string; onChange: (c: string, hex: string) => void }) => (
    <span>
      {/* ui-lint-line: test stub */}
      <button type="button" onClick={() => onChange(prefix === 'bg' ? 'bg-[#000000]' : 'text-[#ff0000]', '')}>{`pick-${prefix}`}</button>
    </span>
  ),
}));
import { StackColorPopover } from '../StackColorPopover';

const noVars = () => null;
function open(cls: string, textAuto: boolean) {
  const onChange = vi.fn();
  render(<StackColorPopover cls={cls} textAuto={textAuto} lookupVar={noVars} onChange={onChange} />);
  fireEvent.click(screen.getByLabelText('Color'));
  return onChange;
}

describe('StackColorPopover', () => {
  it('background pick with Auto text → text class recomputed, still auto', () => {
    const onChange = open('bg-[#ffffff] text-[#111111]', true);
    fireEvent.click(screen.getByText('pick-bg'));
    expect(onChange).toHaveBeenCalledWith('bg-[#000000] text-white', true);
  });

  it('explicit text → auto off, text kept on a later bg change', () => {
    const onChange = open('bg-[#ffffff]', true);
    fireEvent.click(screen.getByText('pick-text'));
    expect(onChange).toHaveBeenCalledWith('bg-[#ffffff] text-[#ff0000]', false);
  });

  it('bg change with a manual text keeps that text', () => {
    const onChange = open('bg-[#ffffff] text-[#ff0000]', false);
    fireEvent.click(screen.getByText('pick-bg'));
    expect(onChange).toHaveBeenCalledWith('bg-[#000000] text-[#ff0000]', false);
  });

  it('the text picker shows the ACTUAL color even under Auto (one control, no second "Auto")', () => {
    open('bg-[#000000] text-white', true);
    expect(screen.getAllByText('Auto contrast')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Auto' })).toBeNull();
  });

  it('switching Auto contrast off keeps the current class; on recomputes it', () => {
    const off = open('bg-[#000000] text-white', true);
    fireEvent.click(screen.getByLabelText('Auto contrast'));
    expect(off).toHaveBeenCalledWith('bg-[#000000] text-white', false);
  });

  it('Auto resets to the computed text', () => {
    const onChange = open('bg-[#000000] text-[#ff0000]', false);
    fireEvent.click(screen.getByLabelText('Auto contrast'));
    expect(onChange).toHaveBeenCalledWith('bg-[#000000] text-white', true);
  });
});
