import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GridChip } from '../GridChip';
import { claimHoverMenu } from '../hoverMenu';
import { getGrid, _resetGridCacheForTests, setGrid } from '../gridPreferences';

beforeEach(() => {
  localStorage.removeItem('sq:grid');
  _resetGridCacheForTests();
  Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
});

const chip = () => screen.getByRole('button', { name: /grid options/i });
const renderOpen = () => { render(<GridChip projectId="p" />); fireEvent.click(chip()); };
const field = (name: string) => screen.getByRole('spinbutton', { name }) as HTMLInputElement;
const switchEl = () => screen.getByRole('switch', { name: 'Show grid' });

describe('GridChip', () => {
  it('is a plain "Grid" chip while off, popover closed', () => {
    render(<GridChip projectId="p" />);
    expect(chip().textContent).toContain('Grid');
    expect(chip().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: 'Grid' })).toBeNull();
    expect(chip().textContent).not.toContain('col');
  });

  it('opens the setup on click: on/off with its shortcut, type, and the columns numbers', () => {
    renderOpen();
    expect(chip().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('group', { name: 'Grid' })).toBeTruthy();
    expect(switchEl().getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('⌃G')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Columns' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Square' })).toBeTruthy();
    expect(field('Columns').value).toBe('12');
    expect(field('Gutter').value).toBe('16');
    expect(field('Margin').value).toBe('16');
    expect(screen.queryByRole('spinbutton', { name: 'Size' })).toBeNull();
  });

  it('names the shortcut for a PC', () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    renderOpen();
    expect(screen.getByText('Ctrl+G')).toBeTruthy();
  });

  it('the switch turns the grid on and off; the chip shows it on', () => {
    renderOpen();
    fireEvent.click(switchEl());
    expect(getGrid('p').on).toBe(true);
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
    expect(chip().textContent).toContain('12 col');
    fireEvent.click(switchEl());
    expect(getGrid('p').on).toBe(false);
    expect(chip().textContent).not.toContain('col');
  });

  it('follows a change made elsewhere (the shortcut) while open', () => {
    renderOpen();
    act(() => setGrid('p', { on: true }));
    expect(switchEl().getAttribute('aria-checked')).toBe('true');
  });

  it('Square swaps the numbers for one size field, and the chip says the pitch', () => {
    renderOpen();
    fireEvent.click(screen.getByRole('button', { name: 'Square' }));
    expect(getGrid('p').type).toBe('square');
    expect(field('Size').value).toBe('8');
    expect(screen.queryByRole('spinbutton', { name: 'Columns' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Gutter' })).toBeNull();
    fireEvent.change(field('Size'), { target: { value: '16' } });
    expect(getGrid('p').size).toBe(16);
    act(() => setGrid('p', { on: true }));
    expect(chip().textContent).toContain('16px');
    fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(field('Gutter').value).toBe('16');
  });

  it('a valid number commits as you type', () => {
    renderOpen();
    fireEvent.change(field('Columns'), { target: { value: '8' } });
    expect(getGrid('p').count).toBe(8);
    fireEvent.change(field('Gutter'), { target: { value: '24' } });
    expect(getGrid('p').gutter).toBe(24);
    fireEvent.change(field('Margin'), { target: { value: '0' } });
    expect(getGrid('p').margin).toBe(0);
  });

  it('the field can be cleared and retyped; blur restores the stored value', () => {
    renderOpen();
    fireEvent.change(field('Columns'), { target: { value: '8' } });
    fireEvent.change(field('Columns'), { target: { value: '' } });
    expect(field('Columns').value).toBe(''); // not snapped back while typing
    expect(getGrid('p').count).toBe(8); // nothing half-typed reaches the canvas
    fireEvent.blur(field('Columns'));
    expect(field('Columns').value).toBe('8');
  });

  it('a number past the limit is clamped, and the field shows the clamp on blur', () => {
    renderOpen();
    fireEvent.change(field('Columns'), { target: { value: '99' } });
    expect(getGrid('p').count).toBe(24);
    fireEvent.blur(field('Columns'));
    expect(field('Columns').value).toBe('24');
  });

  it('closes on Escape, with nothing pending (values were live)', () => {
    renderOpen();
    fireEvent.change(field('Columns'), { target: { value: '5' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Grid' })).toBeNull();
    expect(getGrid('p').count).toBe(5);
  });

  it('closes when another top-bar menu opens (never two stacked)', () => {
    renderOpen();
    act(() => claimHoverMenu(() => {}));
    expect(screen.queryByRole('group', { name: 'Grid' })).toBeNull();
  });
});
