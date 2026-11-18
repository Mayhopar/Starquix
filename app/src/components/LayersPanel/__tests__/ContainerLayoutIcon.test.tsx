import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContainerLayoutIcon } from '../ContainerLayoutIcon';
import type { ContainerLayout } from '@/bridge/types';

describe('container layout icons', () => {
  it('uses plain four corners when no flex/grid layout was reported', () => {
    const { container } = render(<ContainerLayoutIcon className="w-4 h-4" />);
    expect(container.querySelector('svg')?.getAttribute('data-sq-icon')).toBe('container');
  });

  it.each<ContainerLayout>(['flex-row', 'flex-column', 'flex-row-reverse', 'flex-column-reverse', 'grid-row', 'grid-column'])('reflects %s and returns to plain flow after a change', layout => {
    const { container, rerender } = render(<ContainerLayoutIcon layout={layout} className="w-4 h-4" />);
    expect(container.querySelector('svg')?.getAttribute('data-sq-icon')).toBe(`container-${layout}`);
    rerender(<ContainerLayoutIcon className="w-4 h-4" />);
    expect(container.querySelector('svg')?.getAttribute('data-sq-icon')).toBe('container');
  });
});
