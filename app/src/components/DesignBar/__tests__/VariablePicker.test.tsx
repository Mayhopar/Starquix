import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';

const doc = createEditorDoc();
applyCommand(doc, { type: 'ADD_VARIABLE_COLLECTION', collection: {
  id: 'c', name: 'Colors', modes: [{ id: 'm', name: 'Light', isDefault: true }],
  variables: [{ id: 'v', name: 'ink', type: 'color', values: { m: { type: 'color', hex: '#111111', opacity: 100 } } }],
} });
vi.mock('@/store/hooks', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/store/hooks')>(),
  useYjsValue: <T,>(selector: (d: typeof doc) => T) => selector(doc),
}));

import { VariablePicker } from '../VariablePicker';

// task-262/263: text- and border- share their prefix with a size / a width, so
// the class says which one it is. bg- has no such twin and stays bare.
describe('VariablePicker writes a class Tailwind and the editor both read as a colour', () => {
  it.each([
    ['text', 'text-[color:var(--ink)]'],
    ['border', 'border-[color:var(--ink)]'],
    ['bg', 'bg-[var(--ink)]'],
  ])('%s → %s', (prefix, expected) => {
    const onSelect = vi.fn();
    render(<VariablePicker prefix={prefix} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('--ink'));
    expect(onSelect).toHaveBeenCalledWith(expected, '#111111');
  });
});
