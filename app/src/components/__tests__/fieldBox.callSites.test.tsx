/** Issue #10: the field-looking boxes built outside ui/Field act like a Field's box — a press anywhere in the box
 *  (ring, padding, label, icon, unit, gaps) focuses its control; buttons and other controls in it stay their own targets. */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/context/SelectionContext', () => ({ useSelectedRectOptional: () => null }));
const collections = [{ id: 'k', name: 'Theme', modes: [{ id: 'm', name: 'Default', isDefault: true }], variables: [
  { id: 'n', name: 'gap', type: 'number', values: { m: { type: 'number', value: 4, unit: 'px' } } },
] }];
vi.mock('@/store/hooks', () => ({ useYjsValue: () => collections, useDispatch: () => vi.fn() }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }) }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ setActiveCollectionId: vi.fn() }) }));
vi.mock('@/assets/icons', () => {
  const Stub = (props: Record<string, unknown>) => React.createElement('span', props);
  return new Proxy({}, { get: (_t, key) => (key === 'then' ? undefined : Stub), has: () => true });
});

import { CustomColorPicker } from '../DesignBar/CustomColorPicker';
import { SizeInput } from '../DesignBar/blocks/LayoutAppearanceBlock';
import { SpacingBlock } from '../DesignBar/blocks/SpacingBlock';
import { VariableRow } from '../VariablesEditor/VariableRow';
import { AIChat } from '../Footer/AIChat';
import { VariablesQuickPanel } from '../DesignBar/VariablesQuickPanel';
import type { DesignVariable } from '@/core/variables/types';

const box = (el: Element) => el.closest('.border-input-stroke') as HTMLElement;

describe('hand-rolled field boxes: the whole box is the hit target', () => {
  it('CustomColorPicker: the HEX / R labels focus their inputs', () => {
    render(<CustomColorPicker value="#112233" onChange={vi.fn()} onClose={vi.fn()} />);
    expect(fireEvent.mouseDown(screen.getByText('HEX'))).toBe(false);
    expect(document.activeElement).toBe(screen.getByDisplayValue('#112233'));
    fireEvent.mouseDown(screen.getByText('R'));
    expect(document.activeElement).toBe(screen.getByDisplayValue('17'));
  });

  it('SizeInput and its min constraint: the label / icon slot focuses the input; the options chevron stays a button', () => {
    render(<SizeInput dimension="w" state={{ mode: 'fixed', value: 100, minValue: 10, maxValue: null }} onModeChange={vi.fn()}
      onValueChange={vi.fn()} onConstraintChange={vi.fn()} onAddConstraint={vi.fn()} onRemoveConstraint={vi.fn()}
      mixed={{ size: false, min: false, max: false }} />);
    for (const value of ['100', '10']) {
      const input = screen.getByDisplayValue(value);
      expect(fireEvent.mouseDown(box(input).firstElementChild!)).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    expect(fireEvent.mouseDown(screen.getAllByLabelText(/options$/)[0])).toBe(true);
  });

  it('SpacingBlock: a margin = auto box focuses its read-only value; × still removes auto', () => {
    const onClassesChange = vi.fn();
    render(<SpacingBlock classes="mx-auto" onClassesChange={onClassesChange} />);
    const pill = box(screen.getByTitle('Remove auto'));
    fireEvent.mouseDown(pill.firstElementChild!);
    expect(document.activeElement).toBe(pill.querySelector('input'));
    expect(pill.querySelector('input')).toHaveValue('auto');
    fireEvent.click(screen.getByTitle('Remove auto'));
    expect(onClassesChange).toHaveBeenCalled();
  });

  it('VariablesEditor value cells: the cell padding focuses the value; the % focuses opacity; swatch and unit stay targets', () => {
    const modes = [{ id: 'm', name: 'Default', isDefault: true }];
    const row = (variable: DesignVariable) => (
      <VariableRow key={variable.id} variable={variable} modes={modes} onValueChange={vi.fn()} onRename={vi.fn()}
        onDelete={vi.fn()} onDuplicate={vi.fn()} onChangeType={vi.fn()} />
    );
    render(<table><tbody>
      {row({ id: 's', name: 'title', type: 'string', values: { m: { type: 'string', value: 'Hi' } } })}
      {row({ id: 'n', name: 'gap', type: 'number', values: { m: { type: 'number', value: 4, unit: 'px' } } })}
      {row({ id: 'c', name: 'brand', type: 'color', values: { m: { type: 'color', hex: '#112233', opacity: 80 } } })}
    </tbody></table>);
    for (const value of ['Hi', '4', '#112233']) {
      const input = screen.getByDisplayValue(value);
      expect(fireEvent.mouseDown(input.closest('td')!)).toBe(false);
      expect(document.activeElement).toBe(input);
    }
    fireEvent.mouseDown(screen.getByText('%', { selector: 'span' }));
    expect(document.activeElement).toBe(screen.getByDisplayValue('80'));
    expect(screen.getByRole('button', { name: 'Pick color' })).toBeInTheDocument();
    expect(fireEvent.mouseDown(screen.getByRole('button', { name: 'Pick color' }))).toBe(true);
    expect(fireEvent.mouseDown(screen.getByDisplayValue('px'))).toBe(true);
  });

  it('AIChat composer: the box padding and the pills row focus the message; pills stay buttons', () => {
    render(<AIChat messages={[]} isGenerating={false} genSeconds={0} prompt="" onPromptChange={vi.fn()} queued={null}
      onUnqueue={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} onContinue={vi.fn()} contextElements={[]}
      onRemoveContext={vi.fn()} emptyNotice={null} onOpenSettings={vi.fn()} placeholder="Ask"
      pills={<button type="button">Model</button>} />);
    const message = screen.getByLabelText('Message');
    expect(fireEvent.mouseDown(box(message))).toBe(false);
    expect(document.activeElement).toBe(message);
    message.blur();
    fireEvent.mouseDown(message.nextElementSibling!); // the pills row
    expect(document.activeElement).toBe(message);
    expect(fireEvent.mouseDown(screen.getByText('Model'))).toBe(true);
  });

  it('Styles quick panel: the edit popover\'s padding focuses the value it holds', () => {
    render(<VariablesQuickPanel />);
    fireEvent.click(screen.getByTitle('Edit variable'));
    const input = screen.getByDisplayValue('4');
    expect(fireEvent.mouseDown(input.closest('.p-2')!)).toBe(false); // the padded box around the value
    expect(document.activeElement).toBe(input);
  });
});
