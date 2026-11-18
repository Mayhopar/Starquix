import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Field } from '@/components/ui';

describe('Field onBlur', () => {
  it('forwards onBlur from the input element', () => {
    const onBlur = vi.fn();
    render(<Field value="hi" onChange={() => {}} onBlur={onBlur} />);
    fireEvent.blur(screen.getByRole('textbox'));
    expect(onBlur).toHaveBeenCalledOnce();
  });

  it('forwards aria-label so the input has an accessible name', () => {
    render(<Field value="hi" onChange={() => {}} aria-label="heading" />);
    expect(screen.getByLabelText('heading')).toBeInTheDocument();
  });
});
