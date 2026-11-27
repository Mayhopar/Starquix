import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { setSiteFonts, siteFontFamilies } from '../siteFonts';
import { FontFamilySelect } from '@/components/DesignBar/blocks/FontFamilySelect';

beforeEach(() => setSiteFonts('', []));

describe('siteFonts store', () => {
  it('keeps sorted unique names the font class round-trips', () => {
    setSiteFonts('p1', ['Roboto', 'Open Sans', 'Roboto', 'My_Font', 'Bad"Name', 'Font, Two', 42]);
    expect(siteFontFamilies('p1')).toEqual(['Open Sans', 'Roboto']);
  });

  it('another project reads nothing; malformed payload keeps the list', () => {
    setSiteFonts('p1', ['Inter']);
    expect(siteFontFamilies('p2')).toEqual([]);
    setSiteFonts('p1', undefined);
    expect(siteFontFamilies('p1')).toEqual(['Inter']);
  });

  it('same list again keeps the same array (no re-render on every scan)', () => {
    setSiteFonts('p1', ['Inter', 'Lora']);
    const first = siteFontFamilies('p1');
    setSiteFonts('p1', ['Lora', 'Inter']);
    expect(siteFontFamilies('p1')).toBe(first);
  });
});

describe('FontFamilySelect site fonts', () => {
  it('lists site fonts under Project fonts, once, and picks them', () => {
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
    const onChange = vi.fn();
    render(<FontFamilySelect value="" projectFonts={{}} siteFonts={['My Brand', 'Open Sans']}
      onChange={onChange} onUploadClick={() => {}} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Project fonts')).toBeTruthy();
    expect(screen.getAllByText('Open Sans')).toHaveLength(1);
    fireEvent.click(screen.getByText('My Brand'));
    expect(onChange).toHaveBeenCalledWith('My Brand');
    vi.unstubAllGlobals();
  });
});

describe('FontFamilySelect inherited family', () => {
  it('no family class: the trigger names the inherited family, dimmed; a set class wins', () => {
    const { rerender } = render(<FontFamilySelect value="" inherited="Brand Sans" projectFonts={{}}
      onChange={() => {}} onUploadClick={() => {}} />);
    expect(screen.getByText('Brand Sans').className).toContain('text-text-secondary');
    rerender(<FontFamilySelect value="Inter" inherited="Brand Sans" projectFonts={{}}
      onChange={() => {}} onUploadClick={() => {}} />);
    expect(screen.getByText('Inter').className).not.toContain('text-text-secondary');
    rerender(<FontFamilySelect value="" projectFonts={{}} onChange={() => {}} onUploadClick={() => {}} />);
    expect(screen.getByText('Default Font')).toBeTruthy();
  });
});
