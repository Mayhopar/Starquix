import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ZoomChip } from '../ZoomChip';

function listenZoom(): { actions: string[]; stop: () => void } {
  const actions: string[] = [];
  const handler = (e: Event) => actions.push((e as CustomEvent).detail.action);
  window.addEventListener('sq:zoom-command', handler);
  return { actions, stop: () => window.removeEventListener('sq:zoom-command', handler) };
}

describe('ZoomChip', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
  });
  afterEach(cleanup);

  it('renders the rounded zoom percentage', () => {
    render(<ZoomChip scale={0.499} />);
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('opens the menu on click and lists all four actions', () => {
    render(<ZoomChip scale={1} />);
    fireEvent.click(screen.getByRole('button', { name: /zoom options/i }));
    expect(screen.getByText('Zoom in')).toBeTruthy();
    expect(screen.getByText('Zoom out')).toBeTruthy();
    expect(screen.getByText('Zoom to 100%')).toBeTruthy();
    expect(screen.getByText('Zoom to fit')).toBeTruthy();
  });

  it('menu items dispatch the matching sq:zoom-command and close the menu', () => {
    const zoom = listenZoom();
    render(<ZoomChip scale={1} />);
    fireEvent.click(screen.getByRole('button', { name: /zoom options/i }));
    fireEvent.click(screen.getByText('Zoom to fit'));
    expect(zoom.actions).toEqual(['fit']);
    expect(screen.queryByText('Zoom in')).toBeNull(); // closed
    zoom.stop();
  });

  it('forwards labelRef to the percentage span (live rAF updates from Canvas)', () => {
    const ref = { current: null as HTMLSpanElement | null };
    render(<ZoomChip scale={1} labelRef={ref} />);
    expect(ref.current?.textContent).toBe('100%');
  });
});
