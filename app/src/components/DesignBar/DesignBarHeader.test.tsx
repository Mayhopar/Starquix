import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignBarHeader } from './DesignBarHeader';

describe('DesignBarHeader', () => {
  it('renders the heading and the action slot in one shared shell', () => {
    render(
      <DesignBarHeader
        heading="Section"
        actions={<button type="button">act</button>}
      />,
    );
    expect(screen.getByText('Section')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'act' })).toBeInTheDocument();
  });

  it('renders without an action slot', () => {
    render(<DesignBarHeader heading="Layout" />);
    expect(screen.getByText('Layout')).toBeInTheDocument();
  });
});
