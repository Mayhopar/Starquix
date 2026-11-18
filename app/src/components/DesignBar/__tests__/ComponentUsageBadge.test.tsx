/**
 * Verbatim from the critic: "there is **no affordance that leads back to a
 * placement that has diverged** — no list of instances, no '3 uses', nothing."
 * And worse: after a Push, one placement flipped to the new value while another
 * silently kept its own override — the same click produced two outcomes and the
 * editor said nothing.
 *
 * `ComponentUsageBadge` is the master view's answer: how many pages use this
 * component, how many placements currently override it, and a click that
 * navigates back to one. Shared — WC/server count doc placements, local counts
 * the host's reverse-import walk; the component sees one struct either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  usage: { pages: [] as Array<{ pageId: string; label: string }>, overriddenPlacements: 0 },
}));

vi.mock('@/hooks/useComponentUsage', () => ({
  useComponentUsage: () => h.usage,
}));

import { ComponentUsageBadge } from '../ComponentUsageBadge';

describe('ComponentUsageBadge — the master view is no longer a dead end', () => {
  beforeEach(() => {
    h.usage = { pages: [], overriddenPlacements: 0 };
  });

  it('renders nothing when the component is used nowhere', () => {
    const { container } = render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing without a source (not a master view)', () => {
    h.usage = { pages: [{ pageId: 'p1', label: 'Home' }], overriddenPlacements: 0 };
    const { container } = render(<ComponentUsageBadge source={null} onOpenPage={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('shows the use count', () => {
    h.usage = {
      pages: [{ pageId: 'p1', label: 'Home' }, { pageId: 'p2', label: 'About' }],
      overriddenPlacements: 0,
    };
    render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={vi.fn()} />);
    expect(screen.getByText('2 uses')).toBeTruthy();
  });

  it('calls out placements that OVERRIDE it — the silent-divergence case', () => {
    h.usage = {
      pages: [{ pageId: 'p1', label: 'Home' }, { pageId: 'p2', label: 'About' }],
      overriddenPlacements: 1,
    };
    render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={vi.fn()} />);
    expect(screen.getByText('2 uses · 1 overriding')).toBeTruthy();
  });

  it('lists the pages and navigates back to one', () => {
    const onOpenPage = vi.fn();
    h.usage = {
      pages: [{ pageId: 'p1', label: 'Home' }, { pageId: 'p2', label: 'About' }],
      overriddenPlacements: 1,
    };
    render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={onOpenPage} />);
    fireEvent.click(screen.getByTitle('Where this component is used'));

    expect(screen.getByText('About')).toBeTruthy();
    fireEvent.click(screen.getByText('About'));
    expect(onOpenPage).toHaveBeenCalledWith('p2');
  });

  /**
   * Blind review 2026-08-04 item 3, verbatim: "`1 placement override` … —
   * singular/plural agreement." The noun-only `plural` helper this file used
   * could not fix it: the noun drops its `-s` at 1 while the verb GAINS one.
   * Agreement now comes from utils/plural (`plural` + `verb`), shared by every
   * counted string in both runtimes.
   */
  it('agrees in number at ONE — `1 placement overrides`, not `1 placement override`', () => {
    h.usage = { pages: [{ pageId: 'p1', label: 'Home' }], overriddenPlacements: 1 };
    render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Where this component is used'));
    expect(screen.getByText(
      '1 placement overrides this component — a push will not visibly change it',
    )).toBeTruthy();
  });

  it('and still agrees at TWO', () => {
    h.usage = { pages: [{ pageId: 'p1', label: 'Home' }], overriddenPlacements: 2 };
    render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={vi.fn()} />);
    fireEvent.click(screen.getByTitle('Where this component is used'));
    expect(screen.getByText(
      '2 placements override this component — a push will not visibly change them',
    )).toBeTruthy();
  });

  it('a component with overrides but no known pages still reports the overrides', () => {
    h.usage = { pages: [], overriddenPlacements: 2 };
    render(<ComponentUsageBadge source="src/components/Header.astro" onOpenPage={vi.fn()} />);
    expect(screen.getByText('2 overriding')).toBeTruthy();
  });
});
