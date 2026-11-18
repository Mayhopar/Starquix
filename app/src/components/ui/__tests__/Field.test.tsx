/**
 * ui/Field + presets — input/select modes, error/mono/caption, SearchField
 * clear, UnitField stepping, InlineEdit commit/cancel.
 */
import React from 'react';
import { vi } from 'vitest';

// svg?react imports resolve to data-URL strings under vitest — stub all icons.
// (Proxy mocks need then→undefined + has trap; see task-065 notes.)
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, {
    get: (_t, prop) => (prop === 'then' ? undefined : Stub),
    has: () => true,
  });
});

import { describe, it, expect } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { Field } from '../Field';
import { SearchField, UnitField, InlineEdit } from '../FieldPresets';
import { Labeled } from '../Labeled';

describe('ui/Field', () => {
  it('input mode emits onChange with the raw value', () => {
    const onChange = vi.fn();
    render(<Field value="a" onChange={onChange} aria-label="Name" />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ab' } });
    expect(onChange).toHaveBeenCalledWith('ab');
  });

  it('select mode renders options and chevron', () => {
    const onChange = vi.fn();
    render(
      <Field as="select" value="x" onChange={onChange} aria-label="Pick" options={[{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }]} />,
    );
    fireEvent.change(screen.getByLabelText('Pick'), { target: { value: 'y' } });
    expect(onChange).toHaveBeenCalledWith('y');
  });

  it('error string renders border + message', () => {
    const { container } = render(<Field value="v" onChange={() => {}} error="Taken" />);
    expect(screen.getByText('Taken')).toBeInTheDocument();
    expect(container.innerHTML).toContain('border-error');
  });

  it('mono applies font-mono to the value', () => {
    render(<Field value="v" onChange={() => {}} mono aria-label="Slug" />);
    expect((screen.getByLabelText('Slug') as HTMLElement).className).toContain('font-mono');
  });

  it('caption renders under the field', () => {
    render(<Field value="v" onChange={() => {}} caption="hint" />);
    expect(screen.getByText('hint')).toBeInTheDocument();
  });

  it('numeric stepping reads its own running value: two presses before a re-render emit n+1 then n+2 (key repeat outruns React)', () => {
    const onChange = vi.fn();
    render(<Field type="number" value="10" onChange={onChange} aria-label="Run" />);
    const input = screen.getByLabelText('Run');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp', shiftKey: true });
    expect(onChange.mock.calls.map(c => c[0])).toEqual(['11', '12', '22']);
  });

  it('the running value is dropped when the rendered value catches up and on blur', () => {
    const onChange = vi.fn();
    const { rerender } = render(<Field type="number" value="10" onChange={onChange} aria-label="Run" />);
    const input = screen.getByLabelText('Run');
    fireEvent.keyDown(input, { key: 'ArrowUp' });             // 11
    rerender(<Field type="number" value="11" onChange={onChange} aria-label="Run" />);
    fireEvent.keyDown(input, { key: 'ArrowUp' });             // 12 from the caught-up value
    rerender(<Field type="number" value="40" onChange={onChange} aria-label="Run" />);   // changed by someone else
    fireEvent.blur(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(onChange.mock.calls.map(c => c[0])).toEqual(['11', '12', '39']);
  });

  it('numeric stepping: ArrowUp +1, Shift+ArrowDown -10, clamped at min', () => {
    const onChange = vi.fn();
    render(<Field type="number" value="5" min={0} onChange={onChange} aria-label="N" />);
    const input = screen.getByLabelText('N');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('6');
    fireEvent.keyDown(input, { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('0');
  });
});

describe('ui/SearchField', () => {
  it('shows clear button only when non-empty; clearing empties value', () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchField value="" onChange={onChange} />);
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull();
    rerender(<SearchField value="hero" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChange).toHaveBeenCalledWith('');
  });
});

describe('ui/UnitField', () => {
  it('is a numeric field with unit suffix', () => {
    const onChange = vi.fn();
    render(<UnitField value={4} onChange={onChange} unit="px" aria-label="Gap" />);
    expect(screen.getByText('px')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText('Gap'), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('5');
  });
});

describe('ui/InlineEdit', () => {
  it('renders text when not editing; commits on Enter', () => {
    const onCommit = vi.fn();
    const onEditingChange = vi.fn();
    const { rerender } = render(
      <InlineEdit value="Home" onCommit={onCommit} editing={false} onEditingChange={onEditingChange} />,
    );
    expect(screen.getByText('Home')).toBeInTheDocument();
    rerender(<InlineEdit value="Home" onCommit={onCommit} editing onEditingChange={onEditingChange} />);
    const input = screen.getByLabelText('Rename');
    fireEvent.change(input, { target: { value: 'About' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('About');
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it('Escape cancels without committing', () => {
    const onCommit = vi.fn();
    const onEditingChange = vi.fn();
    render(<InlineEdit value="Home" onCommit={onCommit} editing onEditingChange={onEditingChange} />);
    const input = screen.getByLabelText('Rename');
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCommit).not.toHaveBeenCalled();
    expect(onEditingChange).toHaveBeenCalledWith(false);
  });

  it('blur with unchanged or empty value does not commit', () => {
    const onCommit = vi.fn();
    render(<InlineEdit value="Home" onCommit={onCommit} editing onEditingChange={() => {}} />);
    const input = screen.getByLabelText('Rename');
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();
  });
});

it('multiline Field preserves newlines and forwards its textarea ref and events', () => {
  const ref = React.createRef<HTMLTextAreaElement>(); const change = vi.fn(); const blur = vi.fn();
  render(<Field as="textarea" ref={ref} value={'First\nSecond'} onChange={change} onBlur={blur} aria-label="Description" rows={4} />);
  const input = screen.getByRole('textbox', { name: 'Description' });
  expect(input.tagName).toBe('TEXTAREA'); expect(ref.current).toBe(input);
  fireEvent.change(input, { target: { value: 'First\nEdited' } });
  expect(change).toHaveBeenCalledWith('First\nEdited');
  fireEvent.blur(input); expect(blur).toHaveBeenCalledOnce();
});
it('date Field retains date-only values without numeric arrow stepping', () => {
  const change = vi.fn(); render(<Field type="date" value="2026-09-09" onChange={change} aria-label="Published" />);
  const input = screen.getByLabelText('Published'); expect(input).toHaveAttribute('type', 'date');
  fireEvent.keyDown(input, { key: 'ArrowUp' }); expect(change).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: '2026-09-10' } }); expect(change).toHaveBeenCalledWith('2026-09-10');
});

it('password fields use native masking and preserve the exact entered value', () => {
  const onChange = vi.fn();
  render(<Field type="password" value="token" onChange={onChange} aria-label="Token" />);
  expect(screen.getByLabelText('Token')).toHaveAttribute('type', 'password');
  // Never the browser's saved password in a token field (live bug 2026-09-27: the AI key field got autofilled).
  expect(screen.getByLabelText('Token')).toHaveAttribute('autocomplete', 'new-password');
  fireEvent.change(screen.getByLabelText('Token'), { target: { value: ' secret ' } });
  expect(onChange).toHaveBeenCalledWith(' secret ');
});

describe('window fields (the Figma Input, 2026-10-21)', () => {
  it('Field lg: 32px, outlined on the surface, 14px value, 24px slots; read-only values are selectable, not editable', () => {
    const onClick = vi.fn();
    const { container } = render(<Field size="lg" readOnly value="oleg.github.io/site" onChange={vi.fn()} onClick={onClick} aria-label="Address"
      trailing={<span data-testid="open" />} />);
    const box = container.firstElementChild as HTMLElement;
    // Outlined on the surface in Light, half a step lighter than the surface in Dark (owner 2026-10-22) — via its token.
    expect(box).toHaveClass('h-8', 'bg-input-fill-window', 'border-input-stroke', 'rounded-inner');
    expect(box).not.toHaveClass('bg-bg-contrast');
    const input = screen.getByLabelText('Address') as HTMLInputElement;
    expect(input).toHaveClass('text-sm', 'cursor-pointer');
    expect(input.readOnly).toBe(true);
    expect(screen.getByTestId('open').parentElement).toHaveClass('min-w-6', 'h-6');
    fireEvent.click(input);
    expect(onClick).toHaveBeenCalled();
  });

  it('skeleton (the loading state): Field = its own box pulsing, no input; Labeled = its label as a bar of its width, no helper', () => {
    const { container } = render(<Labeled label="Address" caption="helper" skeleton><Field size="lg" skeleton value="" onChange={vi.fn()} /></Labeled>);
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('.animate-pulse.h-8.w-full')).not.toBeNull(); // the lg field's 32px box
    expect(screen.getByText('Address')).toHaveClass('text-transparent', 'animate-pulse'); // the label's own width
    expect(screen.queryByText('helper')).toBeNull();
  });

  it('Labeled: the label 4px above any control, the helper below; an error wins over the helper', () => {
    const { rerender, container } = render(<Labeled label="GitHub" caption="Enter this code on GitHub" data-testid="item" title="tip">
      <button type="button">Log in</button></Labeled>);
    const item = screen.getByTestId('item');
    expect(item).toHaveClass('flex', 'flex-col', 'gap-1');
    expect(item).toHaveAttribute('title', 'tip');
    expect(item.firstElementChild).toHaveClass('text-xs', 'text-text-secondary'); // dimmed, by the token (owner 2026-10-21)
    expect(item.firstElementChild?.textContent).toBe('GitHub');
    expect(screen.getByText('Enter this code on GitHub')).toHaveClass('text-text-secondary');
    rerender(<Labeled label="Repository" caption="helper" error="site already exists"><span /></Labeled>);
    expect(screen.getByText('site already exists')).toHaveClass('text-error');
    expect(screen.queryByText('helper')).toBeNull();
    expect(container.textContent).toContain('Repository');
  });
});
