// One durable write per edit: SEO fields commit on blur / Enter, never per keystroke.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeoTextField } from '../SeoTextField';

const st = (value: string, extra = {}) => ({ value, editable: true, ...extra });

describe('SeoTextField', () => {
  it('typing saves nothing; blur saves once', () => {
    const save = vi.fn();
    render(<SeoTextField label="Title" field="title" st={st('Home')} save={save} max={60} />);
    const input = screen.getByLabelText('Title');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Home — Acme' } });
    fireEvent.change(input, { target: { value: 'Home — Acme bikes' } });
    expect(save).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('title', 'Home — Acme bikes');
  });

  it('blur without a change saves nothing', () => {
    const save = vi.fn();
    render(<SeoTextField label="Title" field="title" st={st('Home')} save={save} />);
    const input = screen.getByLabelText('Title');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(save).not.toHaveBeenCalled();
  });

  it('a re-read while typing does not overwrite the draft', () => {
    const save = vi.fn();
    const { rerender } = render(<SeoTextField label="Title" field="title" st={st('Home')} save={save} />);
    const input = screen.getByLabelText('Title') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'Draft' } });
    rerender(<SeoTextField label="Title" field="title" st={st('Outside edit')} save={save} />);
    expect(input.value).toBe('Draft');
  });

  it('shows the inherited value as the placeholder and a read-only field disabled with where it is set', () => {
    render(<SeoTextField label="Description" field="description" save={vi.fn()}
      st={st('', { placeholder: 'Layout default', editable: false, setIn: { file: 'src/pages/blog/[slug].astro', line: 9, reason: 'set by code in the page' } })} />);
    const input = screen.getByLabelText('Description') as HTMLInputElement;
    expect(input.placeholder).toBe('Layout default');
    expect(input.disabled).toBe(true);
    expect(screen.getByText('[slug].astro:9')).toBeInTheDocument();
  });
});
