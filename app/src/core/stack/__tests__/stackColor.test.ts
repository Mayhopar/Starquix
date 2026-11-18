import { describe, it, expect } from 'vitest';
import { resolveColorClass, autoTextClass, contrastRatio, applyAutoText, withColorClass, colorClassOf } from '../stackColor';

const vars = (name: string) => ({ brand: '#1f3a2e', primary: '#fafafa' } as Record<string, string>)[name] ?? null;

describe('stack color', () => {
  it('resolves hex, var, palette, theme token; unknown → null', () => {
    expect(resolveColorClass('bg-[#abcdef]', vars)).toBe('#abcdef');
    expect(resolveColorClass('bg-[var(--brand)]', vars)).toBe('#1f3a2e');
    expect(resolveColorClass('text-[color:var(--brand)]', vars)).toBe('#1f3a2e'); // the typed form the variable picker writes (task-262)
    expect(resolveColorClass('bg-rose-500', vars)).toMatch(/^#/);
    expect(resolveColorClass('bg-primary', vars)).toBe('#fafafa');
    expect(resolveColorClass('bg-nope', vars)).toBeNull();
    expect(resolveColorClass('bg-[var(--missing)]', vars)).toBeNull();
  });

  it('auto text picks the higher contrast (P9)', () => {
    expect(autoTextClass('#ffffff')).toBe('text-[#111111]');
    expect(autoTextClass('#000000')).toBe('text-white');
    const pick = autoTextClass('#777777');
    const white = contrastRatio('#777777', '#ffffff');
    const dark = contrastRatio('#777777', '#111111');
    expect(pick).toBe(white >= dark ? 'text-white' : 'text-[#111111]');
  });

  it('applyAutoText rewrites only the text class; unresolvable bg → no text class', () => {
    expect(applyAutoText('bg-[var(--brand)] text-[#111111]', vars)).toBe('bg-[var(--brand)] text-white');
    expect(applyAutoText('bg-[var(--missing)] text-white', vars)).toBe('bg-[var(--missing)]');
  });

  it('class helpers', () => {
    expect(colorClassOf('bg-[#000] text-white', 'text')).toBe('text-white');
    expect(withColorClass('bg-[#000] text-white', 'bg', 'bg-[#fff]')).toBe('bg-[#fff] text-white');
    expect(withColorClass('bg-[#000]', 'text', 'text-white')).toBe('bg-[#000] text-white');
    expect(withColorClass('bg-[#000] text-white', 'bg', '')).toBe('text-white');
  });
});
