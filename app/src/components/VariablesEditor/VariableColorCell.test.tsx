/**
 * VariableColorCell — Tailwind palette selection
 *
 * The color cell popover offers the Tailwind palette grid (hex-only, no
 * transparent swatch) plus the existing custom picker. Selecting a palette
 * swatch emits the swatch hex and preserves opacity.
 */

import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : Stub), has: () => true });
});

import { VariableColorCell } from './VariableColorCell';

const value = { type: 'color' as const, hex: '#112233', opacity: 80 };

function openPicker(onChange = vi.fn()) {
  render(<VariableColorCell value={value} onChange={onChange} />);
  fireEvent.click(screen.getByTitle('Pick color')); // swatch trigger
  return onChange;
}

describe('VariableColorCell palette', () => {
  it('selecting a Tailwind swatch emits its hex and keeps opacity', () => {
    const onChange = openPicker();
    fireEvent.click(screen.getByTitle('red-500'));
    expect(onChange).toHaveBeenCalledWith({ type: 'color', hex: '#ef4444', opacity: 80 });
  });

  it('offers no transparent swatch (variables store hex + opacity)', () => {
    openPicker();
    expect(screen.getByTitle('black')).toBeInTheDocument();
    expect(screen.queryByTitle('transparent')).not.toBeInTheDocument();
  });

  it('Custom Color switches to the custom picker', () => {
    openPicker();
    fireEvent.click(screen.getByText('Custom Color'));
    expect(screen.queryByTitle('red-500')).not.toBeInTheDocument();
    // CustomColorPicker renders its own hex input alongside the cell's one
    expect(screen.getAllByDisplayValue('#112233')).toHaveLength(2);
  });
});
