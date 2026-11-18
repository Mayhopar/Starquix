// app/src/components/VariablesEditor/VariableNumberCell.tsx

import { memo, useCallback } from 'react';
import type { VariableValue } from '@/core/variables/types';
import { arrowKeyDelta } from './constants';

interface VariableNumberCellProps {
  value: VariableValue & { type: 'number' };
  onChange: (value: VariableValue) => void;
}

const UNITS = ['px', 'rem', 'em', '%', 'vh', 'vw', ''];

export const VariableNumberCell = memo(function VariableNumberCell({ value, onChange }: VariableNumberCellProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '' || raw === '-') return;
    onChange({ type: 'number', value: parseFloat(raw) || 0, unit: value.unit });
  }, [value.unit, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const delta = arrowKeyDelta(e);
    if (delta === 0) return;
    e.preventDefault();
    onChange({ type: 'number', value: value.value + delta, unit: value.unit });
  }, [value, onChange]);

  const handleUnitChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({ type: 'number', value: value.value, unit: e.target.value });
  }, [value.value, onChange]);

  return (
    <div className="flex items-center h-full">
      <input
        type="text"
        inputMode="numeric"
        value={value.value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="flex-1 min-w-0 h-full px-1 text-xs bg-transparent text-text outline-none"
      />
      <select
        value={value.unit}
        onChange={handleUnitChange}
        className="h-full px-0.5 text-xs bg-transparent text-text-muted cursor-pointer outline-none appearance-none text-right"
      >
        {UNITS.map(u => (
          <option key={u} value={u}>{u || '—'}</option>
        ))}
      </select>
    </div>
  );
});
