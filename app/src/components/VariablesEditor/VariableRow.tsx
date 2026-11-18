// app/src/components/VariablesEditor/VariableRow.tsx

import { memo, useState, useCallback, useRef } from 'react';
import type { DesignVariable, VariableMode, VariableValue } from '@/core/variables/types';
import { VariableColorCell } from './VariableColorCell';
import { VariableNumberCell } from './VariableNumberCell';
import { VariableStringCell } from './VariableStringCell';
import { Menu, MenuItem, IconButton, InlineEdit } from '@/components/ui';
import { TYPE_ICONS, VARIABLE_TYPES, defaultValueForType, CELL_CLASS, type VariableType } from './constants';

interface VariableRowProps {
  variable: DesignVariable;
  modes: VariableMode[];
  onValueChange: (variableId: string, modeId: string, value: VariableValue) => void;
  onRename: (variableId: string, name: string) => void;
  onDelete: (variableId: string) => void;
  onDuplicate: (variableId: string) => void;
  onChangeType: (variableId: string, newType: VariableType) => void;
  isAIActive?: boolean;
  isAITouched?: boolean;
}

function nextType(current: VariableType): VariableType {
  const idx = VARIABLE_TYPES.indexOf(current);
  return VARIABLE_TYPES[(idx + 1) % VARIABLE_TYPES.length];
}

function renderValueCell(val: VariableValue, onChange: (v: VariableValue) => void): React.ReactNode {
  switch (val.type) {
    case 'color':
      return <VariableColorCell value={val} onChange={onChange} />;
    case 'number':
      return <VariableNumberCell value={val} onChange={onChange} />;
    case 'string':
      return <VariableStringCell value={val} onChange={onChange} />;
  }
}

export const VariableRow = memo(function VariableRow({
  variable,
  modes,
  onValueChange,
  onRename,
  onDelete,
  onDuplicate,
  onChangeType,
  isAIActive,
  isAITouched,
}: VariableRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);

  const handleRename = useCallback((name: string) => {
    onRename(variable.id, name);
  }, [variable.id, onRename]);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);

  return (
    <tr className="group/row">
      {/* Type icon + Name */}
      <td className={`${CELL_CLASS} px-3 py-1 whitespace-nowrap`}>
        <div className="flex items-center gap-2">
          <span className="w-5 text-center text-xs text-text-muted font-mono">{TYPE_ICONS[variable.type]}</span>
          {isAIActive && (
            <div className="w-1.5 h-1.5 rounded-full bg-overlay-ai animate-pulse shrink-0" />
          )}
          {isAITouched && !isAIActive && (
            <div className="w-1.5 h-1.5 rounded-full bg-overlay-ai/40 shrink-0" />
          )}
          <span
            onClick={() => setIsEditing(true)}
            className="flex-1 min-w-0 flex items-center text-xs text-text font-mono hover:text-text-secondary cursor-text text-left"
          >
            {!isEditing && <span className="shrink-0">--</span>}
            <InlineEdit
              value={variable.name}
              onCommit={handleRename}
              editing={isEditing}
              onEditingChange={setIsEditing}
              inputClassName="font-mono"
              aria-label={`Rename variable ${variable.name}`}
            />
          </span>
        </div>
      </td>

      {/* Per-mode value cells */}
      {modes.map(mode => {
        const val = variable.values[mode.id] || defaultValueForType(variable.type);
        return (
          <td key={mode.id} className={`${CELL_CLASS} px-2 py-1`}>
            {renderValueCell(val, (v) => onValueChange(variable.id, mode.id, v))}
          </td>
        );
      })}

      {/* Row menu */}
      <td className={`${CELL_CLASS} px-2 py-1 w-8`}>
        <IconButton
          ref={menuRef}
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="bg-transparent rounded hover:bg-bg-hover text-text-muted hover:text-text-muted text-xs"
          aria-label="Variable actions"
        >
          &hellip;
        </IconButton>
        <Menu
          isOpen={isMenuOpen}
          onClose={closeMenu}
          triggerRef={menuRef}
          placement="bottom-end"
          width={160}
        >
          <MenuItem label="Duplicate" onSelect={() => { onDuplicate(variable.id); closeMenu(); }} />
          <MenuItem label="Change Type" onSelect={() => { onChangeType(variable.id, nextType(variable.type)); closeMenu(); }} />
          <MenuItem label="Delete" danger onSelect={() => { onDelete(variable.id); closeMenu(); }} />
        </Menu>
      </td>
    </tr>
  );
});
