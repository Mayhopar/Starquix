/**
 * Regression — every numeric Field accepts the universal keyboard steppers:
 * - ↑ / ↓ : ±1
 * - Shift+↑ / Shift+↓ : ±10
 *
 * Before fix: Field had no internal step handling. Only SpacingBlock and
 * LayoutAppearance Cols/Rows wired their own onKeyDown; Position,
 * Appearance, Typography, Image, Stroke, Effects relied on the browser's
 * native ±1 behaviour with no Shift modifier — inconsistent stepping
 * across blocks.
 *
 * After fix: Field installs a default keydown handler when `type="number"`
 * and the caller hasn't passed their own onKeyDown. Blocks that already
 * provide a custom handler (Spacing, LayoutAppearance grid templates)
 * retain their bespoke behaviour because the prop overrides the default.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Field } from '@/components/ui';

describe('Field — universal numeric stepping', () => {
  it('ArrowUp on type="number" steps the value by +1', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="number" value="5" onChange={onChange} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('6');
  });

  it('ArrowDown on type="number" steps the value by -1', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="number" value="5" onChange={onChange} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('4');
  });

  it('Shift+ArrowUp steps by +10', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="number" value="20" onChange={onChange} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('30');
  });

  it('Shift+ArrowDown steps by -10', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="number" value="20" onChange={onChange} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowDown', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('10');
  });

  it('clamps to min on ArrowDown', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="number" value="0" onChange={onChange} min={0} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('0');
  });

  it('clamps to max on ArrowUp', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="number" value="100" onChange={onChange} max={100} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp', shiftKey: true });
    expect(onChange).toHaveBeenCalledWith('100');
  });

  it('does NOT step when value is not a finite number (e.g. "auto", "")', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <Field type="number" value="" onChange={onChange} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();

    rerender(<Field type="number" value="auto" onChange={onChange} />);
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does NOT step text-type Fields', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Field type="text" value="5" onChange={onChange} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('caller-supplied onKeyDown overrides the default stepper', () => {
    const onChange = vi.fn();
    const onKeyDown = vi.fn();
    const { container } = render(
      <Field type="number" value="5" onChange={onChange} onKeyDown={onKeyDown} />
    );
    fireEvent.keyDown(container.querySelector('input')!, { key: 'ArrowUp' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });
});
