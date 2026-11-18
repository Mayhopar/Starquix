// app/src/components/DesignBar/VariablePicker.tsx

import { memo, useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui';
import { useYjsValue } from '@/store/hooks';
import { selectAllColorVariables, selectVariableCollections } from '@/store/variableSelectors';
import type { DesignVariable } from '@/core/variables/types';

interface VariablePickerProps {
  prefix: string;  // 'bg', 'text', 'border', etc.
  onSelect: (colorClass: string, hex: string) => void;
}

export const VariablePicker = memo(function VariablePicker({ prefix, onSelect }: VariablePickerProps) {
  const [search, setSearch] = useState('');
  const colorVars = useYjsValue(selectAllColorVariables);
  const collections = useYjsValue(selectVariableCollections);

  // Map variable ID to its default-mode hex for preview swatches
  const previewHexMap = useMemo(() => {
    // Build a single default-mode-id set across all collections
    const defaultModeIds = new Set(
      collections.map(col => col.modes.find(m => m.isDefault)?.id).filter(Boolean)
    );
    const map = new Map<string, string>();
    for (const v of colorVars) {
      const modeId = Object.keys(v.values).find(id => defaultModeIds.has(id));
      const val = modeId ? v.values[modeId] : undefined;
      map.set(v.id, val?.type === 'color' ? val.hex : '#000000');
    }
    return map;
  }, [colorVars, collections]);

  const filtered = search
    ? colorVars.filter(v => v.name.toLowerCase().includes(search.toLowerCase()))
    : colorVars;

  const handleSelect = useCallback((variable: DesignVariable) => {
    // text- is also a size and border- a width: say "colour" in the class, so
    // neither Tailwind nor the editor has to infer it (task-262, task-263).
    const hint = prefix === 'text' || prefix === 'border' ? 'color:' : '';
    const colorClass = `${prefix}-[${hint}var(--${variable.name})]`;
    onSelect(colorClass, previewHexMap.get(variable.id) || '#000000');
  }, [prefix, onSelect, previewHexMap]);

  if (colorVars.length === 0) {
    return (
      <div className="p-3 text-xs text-text-muted text-center">
        No color variables defined yet.
        <br />
        Create them in Components &rarr; Variables.
      </div>
    );
  }

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search variables..."
        className="w-full h-7 px-2 text-xs bg-input-fill border border-input-stroke rounded mb-2 text-text"
        autoFocus
      />
      <div className="max-h-[200px] overflow-y-auto">
        {filtered.map(v => {
          const hex = previewHexMap.get(v.id) || '#000000';
          return (
            <Button
              key={v.id}
              variant="ghost"
              onClick={() => handleSelect(v)}
              className="w-full h-auto justify-start gap-2 px-2 py-1.5 rounded font-normal text-xs text-text hover:text-text bg-transparent hover:bg-bg-hover"
            >
              <div
                className="w-4 h-4 rounded-sm border border-stroke shrink-0"
                style={{ backgroundColor: hex }}
              />
              <span className="font-mono">--{v.name}</span>
              <span className="ml-auto text-text-muted">{hex}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
});
