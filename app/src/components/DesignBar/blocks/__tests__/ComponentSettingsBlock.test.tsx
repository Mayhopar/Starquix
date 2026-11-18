/**
 * task-207 Task 4: manifest → controls. F-rows of the ledger.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ComponentSettingsBlock } from '../ComponentSettingsBlock';
import type { Manifest } from '@/core/manifest/types';

const MANIFEST: Manifest = {
  props: [
    { name: 'align', label: 'Align', control: { kind: 'enum', values: ['left', 'right'] } },
    { name: 'gap', label: 'Gap', control: { kind: 'number', unit: 'px' } },
    { name: 'caption', label: 'Caption', control: { kind: 'text' } },
  ],
};

const setup = (over: Partial<Parameters<typeof ComponentSettingsBlock>[0]> = {}) => {
  const onChange = vi.fn();
  render(
    <ComponentSettingsBlock
      name="Credit" manifest={MANIFEST} values={{ align: 'left', gap: 24 }}
      readOnly={false} onChange={onChange} {...over}
    />,
  );
  return onChange;
};

describe('ComponentSettingsBlock', () => {
  it('titles the block with the COMPONENT name, not "Media" (F4)', () => {
    setup();
    expect(screen.getByText('Credit')).toBeTruthy();
  });

  it('enum → segmented control; clicking emits the value', () => {
    const onChange = setup();
    fireEvent.click(screen.getByText('right'));
    expect(onChange).toHaveBeenCalledWith('align', 'right');
  });

  it('number → numeric field, emits a NUMBER on blur', () => {
    const onChange = setup();
    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: '32' } });
    fireEvent.blur(gap);
    expect(onChange).toHaveBeenCalledWith('gap', 32);
  });

  it('clearing a numeric field emits null — removes the attr (B5)', () => {
    const onChange = setup();
    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: '' } });
    fireEvent.blur(gap);
    expect(onChange).toHaveBeenCalledWith('gap', null);
  });

  /**
   * A `type="number"` input CANNOT hold "abc" — the browser (and jsdom) report
   * value "" — so the reachable outcome is the same as clearing: remove the
   * attr (B5). What must never happen is a NaN reaching the file write.
   */
  it('a non-numeric entry never emits a non-number', () => {
    const onChange = setup();
    const gap = screen.getByLabelText('Gap');
    fireEvent.change(gap, { target: { value: 'abc' } });
    fireEvent.blur(gap);
    for (const [, v] of onChange.mock.calls) {
      expect(v === null || Number.isFinite(v)).toBe(true);
    }
  });

  it('a text field emits the string on blur, and null when emptied', () => {
    const onChange = setup();
    const cap = screen.getByLabelText('Caption');
    fireEvent.change(cap, { target: { value: 'Hi' } });
    fireEvent.blur(cap);
    expect(onChange).toHaveBeenCalledWith('caption', 'Hi');
    fireEvent.change(cap, { target: { value: '' } });
    fireEvent.blur(cap);
    expect(onChange).toHaveBeenCalledWith('caption', null);
  });

  it('an out-of-enum current value leaves no segment active and stays live (B10)', () => {
    const onChange = setup({ values: { align: 'middle' } });
    fireEvent.click(screen.getByText('left'));
    expect(onChange).toHaveBeenCalledWith('align', 'left');
  });

  it('a numeric enum emits a NUMBER, not the stringified segment (A9)', () => {
    const onChange = setup({
      manifest: { props: [{ name: 'cols', label: 'Cols', control: { kind: 'enum', values: [1, 2, 3] } }] },
      values: {},
    });
    fireEvent.click(screen.getByText('2'));
    expect(onChange).toHaveBeenCalledWith('cols', 2);
  });

  it('an enum with more than 6 values is a select, not a segmented control (A8)', () => {
    const values = [1, 2, 3, 4, 5, 6, 7];
    const onChange = setup({
      manifest: { props: [{ name: 'cols', label: 'Cols', control: { kind: 'enum', values } }] },
      values: {},
    });
    const select = screen.getByLabelText('Cols');
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: '7' } });
    expect(onChange).toHaveBeenCalledWith('cols', 7);
  });

  it('a boolean renders an On/Off pair and emits a real boolean', () => {
    const onChange = setup({
      manifest: { props: [{ name: 'wide', label: 'Wide', control: { kind: 'boolean' } }] },
      values: {},
    });
    fireEvent.click(screen.getByText('On'));
    expect(onChange).toHaveBeenCalledWith('wide', true);
  });

  it('slot/slots controls are NOT rendered here — the owner keeps them', () => {
    const { container } = render(
      <ComponentSettingsBlock
        name="Credit" values={{}} readOnly={false} onChange={vi.fn()}
        manifest={{ props: [{ name: 'items', label: 'Items', control: { kind: 'slots' } }] }}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('readOnly disables every control and emits nothing', () => {
    const onChange = setup({ readOnly: true });
    fireEvent.click(screen.getByText('right'));
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Gap') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Caption') as HTMLInputElement).disabled).toBe(true);
  });

  it('an empty manifest renders NOTHING — not an empty panel (A15)', () => {
    const { container } = render(
      <ComponentSettingsBlock name="Credit" manifest={{ props: [] }} values={{}}
        readOnly={false} onChange={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
