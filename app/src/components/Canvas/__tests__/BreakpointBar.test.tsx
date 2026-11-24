import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';

const doc = vi.hoisted(() => ({ current: null as unknown as Y.Doc }));
vi.mock('@/store/hooks', () => ({
  useYjsValue: (select: (d: Y.Doc) => unknown) => select(doc.current),
  useDispatch: () => vi.fn(),
  useProjectId: () => 'p',
}));

import { BreakpointBar } from '../BreakpointBar';

const renderBar = () => { doc.current = new Y.Doc(); return render(<BreakpointBar />); };

describe('BreakpointBar', () => {
  // Finding #32: the hover that precedes every click opened the menu, and the click then toggled it shut.
  it('a hover opens a chip menu, and the click that follows keeps it open', () => {
    renderBar();
    const chip = screen.getByRole('button', { name: /^xs/ });
    fireEvent.mouseEnter(chip.parentElement!);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    fireEvent.click(chip);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  // Finding #37: at the 900px minimum window the row was wider than the canvas and clipped Grid and Zoom.
  it('the chip row scrolls instead of clipping when it is wider than the canvas (centered while it fits)', () => {
    const { container } = renderBar();
    const row = (container.firstElementChild as HTMLElement).className.split(' ');
    for (const rule of ['min-w-0', 'overflow-x-auto', 'justify-center-safe', '*:shrink-0']) expect(row).toContain(rule);
  });
});
