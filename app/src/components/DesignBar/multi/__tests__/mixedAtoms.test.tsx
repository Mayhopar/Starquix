/** "Mixed" on the kit atoms (design C6, C10): real text a screen reader reads, never a value that writes. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field, SegmentedControl, UnitField } from '@/components/ui';
import { ColorPicker } from '../../ColorPicker';
import { FontFamilySelect } from '../../blocks/FontFamilySelect';

describe('mixed atoms', () => {
  it('Field number: empty with placeholder "Mixed"', () => {
    render(<Field type="number" aria-label="Opacity" value={40} onChange={() => {}} mixed />);
    const input = screen.getByLabelText('Opacity') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Mixed');
  });

  it('UnitField forwards mixed', () => {
    render(<UnitField aria-label="Top" value={4} onChange={() => {}} mixed />);
    const input = screen.getByLabelText('Top') as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Mixed');
  });

  it('Field select: shows "Mixed", which cannot be picked; a real option applies', () => {
    const onChange = vi.fn();
    render(<Field as="select" aria-label="Weight" value="bold" placeholder="Regular" onChange={onChange} mixed
      options={[{ value: 'bold', label: 'Bold' }, { value: 'medium', label: 'Medium' }]} />);
    const select = screen.getByLabelText('Weight') as HTMLSelectElement;
    expect(select.selectedOptions[0].textContent).toBe('Mixed');
    expect(select.selectedOptions[0].disabled).toBe(true);
    expect([...select.options].filter(o => o.value === '' && !o.disabled)).toHaveLength(0);
    fireEvent.change(select, { target: { value: 'medium' } });
    expect(onChange).toHaveBeenCalledWith('medium');
  });

  it('Field select not mixed: unchanged (placeholder option still there)', () => {
    render(<Field as="select" aria-label="Weight" value="" placeholder="Regular" onChange={() => {}}
      options={[{ value: 'bold', label: 'Bold' }]} />);
    expect((screen.getByLabelText('Weight') as HTMLSelectElement).selectedOptions[0].textContent).toBe('Regular');
  });

  it('SegmentedControl: the picked segment is pressed; mixed → no segment pressed', () => {
    const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];
    const { container, rerender } = render(<SegmentedControl value="a" onChange={() => {}} options={options} />);
    expect(screen.getByRole('button', { name: 'A' }).getAttribute('aria-pressed')).toBe('true');
    rerender(<SegmentedControl value="a" mixed onChange={() => {}} options={options} />);
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
  });

  it('ColorPicker and FontFamilySelect read "Mixed"', () => {
    render(<ColorPicker prefix="text" value="text-red-500" onChange={() => {}} computedHex="#123456" mixed />);
    expect(screen.getByText('Mixed')).toBeTruthy();
    expect(screen.queryByTestId('color-inherited-swatch')).toBeNull();
    render(<FontFamilySelect value="serif" projectFonts={{}} onChange={() => {}} onUploadClick={() => {}} mixed />);
    expect(screen.getAllByText('Mixed')).toHaveLength(2);
  });
});
