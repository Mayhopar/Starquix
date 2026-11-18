import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LayoutGridOverlay } from '../LayoutGridOverlay';
import { _resetGridCacheForTests, setGrid } from '../gridPreferences';

beforeEach(() => { localStorage.removeItem('sq:grid'); _resetGridCacheForTests(); });

const overlay = () => screen.getByTestId('layout-grid-overlay');

describe('LayoutGridOverlay', () => {
  it('draws nothing while the grid is off', () => {
    const { container } = render(<LayoutGridOverlay projectId="p" />);
    expect(container.firstChild).toBeNull();
  });

  it('never takes the pointer and is hidden from assistive tech', () => {
    setGrid('p', { on: true });
    render(<LayoutGridOverlay projectId="p" />);
    expect(overlay().className).toContain('pointer-events-none');
    expect(overlay().className).toContain('absolute');
    expect(overlay().className).toContain('inset-0');
    expect(overlay().getAttribute('aria-hidden')).toBe('true');
    // no z-index: every z-indexed selection/slot chrome must stay above it
    expect(overlay().className).not.toMatch(/\bz-/);
  });

  it('columns: one stripe per column, the margin as padding, the gutter as gap', () => {
    setGrid('p', { on: true, type: 'columns', count: 4, gutter: 20, margin: 32 });
    render(<LayoutGridOverlay projectId="p" />);
    const row = overlay().firstElementChild as HTMLElement;
    expect(row.children).toHaveLength(4);
    expect(row.style.paddingInline).toBe('32px');
    expect(row.style.columnGap).toBe('20px');
    for (const stripe of Array.from(row.children)) expect(stripe.className).toContain('bg-overlay-grid');
  });

  it('square: one gradient pair at the pitch; hairline and fade follow the live zoom variable', () => {
    setGrid('p', { on: true, type: 'square', size: 8 });
    render(<LayoutGridOverlay projectId="p" />);
    expect(overlay().children).toHaveLength(0);
    expect(overlay().style.backgroundSize).toBe('8px 8px');
    const bg = overlay().style.backgroundImage;
    expect(bg).toContain('to right');
    expect(bg).toContain('to bottom');
    expect(bg).toContain('--sq-inv-scale'); // 1 screen px at any zoom
    expect(bg).toContain('--color-overlay-grid'); // the one token for the hue
    expect(overlay().style.opacity).toContain('--sq-inv-scale'); // dense → fades, live in a gesture
  });

  it('follows the store live: on → type → numbers → off', () => {
    render(<LayoutGridOverlay projectId="p" />);
    expect(screen.queryByTestId('layout-grid-overlay')).toBeNull();
    act(() => setGrid('p', { on: true, count: 3 }));
    expect(overlay().firstElementChild!.children).toHaveLength(3);
    act(() => setGrid('p', { count: 6 }));
    expect(overlay().firstElementChild!.children).toHaveLength(6);
    act(() => setGrid('p', { type: 'square', size: 16 }));
    expect(overlay().style.backgroundSize).toBe('16px 16px');
    act(() => setGrid('p', { on: false }));
    expect(screen.queryByTestId('layout-grid-overlay')).toBeNull();
  });
});
