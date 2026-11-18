// app/src/components/VariablesEditor/VariableStringCell.tsx

import { memo, useCallback } from 'react';
import type { VariableValue } from '@/core/variables/types';

interface VariableStringCellProps {
  value: VariableValue & { type: 'string' };
  onChange: (value: VariableValue) => void;
}

export const VariableStringCell = memo(function VariableStringCell({ value, onChange }: VariableStringCellProps) {
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange({ type: 'string', value: e.target.value });
  }, [onChange]);

  return (
    <input
      type="text"
      value={value.value}
      onChange={handleChange}
      className="w-full h-full px-1 text-xs bg-transparent text-text outline-none"
    />
  );
});
