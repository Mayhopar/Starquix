/**
 * Imported-adoption phase 0 — the lock-tier badge (design ledger L1–L3).
 * A non-full lock renders a chip naming why edits won't persist; full tier
 * renders nothing. Copy derivation is lockTier.test.ts's job; this suite only
 * covers the rendering contract.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { SelectionOverlay } from '../SelectionOverlay';

const rect = { top: 10, left: 10, width: 100, height: 50 };

function mount(lock?: { tier: 'full' | 'limited' | 'locked'; label?: string | null }) {
  return render(
    <SelectionOverlay
      selectedRect={rect}
      scale={1}
      containerOffset={{ x: 0, y: 0 }}
      lock={lock}
    />
  );
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('SelectionOverlay lock badge', () => {
  it('locked tier renders the badge with its label as tooltip', () => {
    const { getByText } = mount({
      tier: 'locked',
      label: 'Not editable — open in code',
    });
    const badge = getByText('Not editable');
    expect(badge).toBeTruthy();
    const chip = badge.closest('[title]') as HTMLElement;
    expect(chip?.getAttribute('title')).toBe('Not editable — open in code');
  });

  it('full tier renders no badge', () => {
    const { queryByText } = mount({ tier: 'full', label: null });
    expect(queryByText('Not editable')).toBeNull();
    expect(queryByText('Component')).toBeNull();
  });

  it('no lock prop renders no badge (WC default path untouched)', () => {
    const { queryByText } = mount(undefined);
    expect(queryByText('Not editable')).toBeNull();
  });
});
