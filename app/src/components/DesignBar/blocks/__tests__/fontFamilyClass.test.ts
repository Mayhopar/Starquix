import { describe, it, expect } from 'vitest';
import { familyToClass, classesToFamily, stripFontFamilyClasses } from '../fontFamilyClass';

describe('fontFamilyClass helpers', () => {
  it('familyToClass underscores spaces and quotes the family', () => {
    expect(familyToClass('Inter')).toBe('font-["Inter"]');
    expect(familyToClass('Open Sans')).toBe('font-["Open_Sans"]');
  });
  it('classesToFamily reads system + arbitrary tokens', () => {
    expect(classesToFamily('p-4 font-sans')).toEqual({ kind: 'system', value: 'sans' });
    expect(classesToFamily('font-["Open_Sans"] font-bold')).toEqual({ kind: 'family', value: 'Open Sans' });
    expect(classesToFamily('font-bold')).toBeNull();
  });
  it('stripFontFamilyClasses removes both forms, keeps weight', () => {
    expect(stripFontFamilyClasses('font-sans font-["Inter"] font-bold p-2'))
      .toBe('font-bold p-2');
  });
  it('stripFontFamilyClasses follows the registry grammar — var() tokens strip too', () => {
    expect(stripFontFamilyClasses('font-[family-name:var(--heading)] font-bold')).toBe('font-bold');
    expect(classesToFamily('font-[family-name:var(--heading)]')).toBeNull(); // no extractable name
    // a bare var() is a WEIGHT in Tailwind 3.4 (task-264): a font pick must not strip it
    expect(stripFontFamilyClasses('font-[var(--weight)] font-sans')).toBe('font-[var(--weight)]');
  });
  it('a stack reads as its first family; a pick replaces the whole stack', () => {
    const stack = 'font-["KTF_Rublena","Arial_Black","Arial"]';
    expect(classesToFamily(`m-0 ${stack} font-black`)).toEqual({ kind: 'family', value: 'KTF Rublena' });
    expect(classesToFamily("font-['Open_Sans',sans-serif]")).toEqual({ kind: 'family', value: 'Open Sans' });
    expect(stripFontFamilyClasses(`m-0 ${stack} font-black`)).toBe('m-0 font-black');
  });
  it('an unquoted family is a family: read by name, stripped by a pick', () => {
    expect(classesToFamily('font-[Inter] font-bold')).toEqual({ kind: 'family', value: 'Inter' });
    expect(stripFontFamilyClasses('font-[Inter] font-[650] p-2')).toBe('font-[650] p-2');
    expect(classesToFamily('font-[650] font-[var(--w)]')).toBeNull(); // weights, not names
  });
});
