/**
 * DesignBarHeader tags slot (task-004). The header gains an optional `tags` slot
 * (the state-pill cluster), rendered after the heading in the left flex group.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignBarHeader } from '../DesignBarHeader';

describe('DesignBarHeader', () => {
  it('renders the tags slot after the heading', () => {
    render(<DesignBarHeader heading={<span>Div</span>} tags={<span>TAGS</span>} />);
    expect(screen.getByText('TAGS')).toBeInTheDocument();
  });
});
