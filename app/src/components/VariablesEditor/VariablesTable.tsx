import { ChevronDownIcon as SharedChevronDownIcon } from '@/assets/icons';
// app/src/components/VariablesEditor/VariablesTable.tsx

import { memo, useState, useRef, useMemo } from 'react';
import { useAI } from '@/ai/AIContext';
import type { VariableCollection, VariableValue } from '@/core/variables/types';
import { VariableRow } from './VariableRow';
import { Menu, MenuItem, Button, IconButton, InlineEdit } from '@/components/ui';
import { PlusIcon } from '@/assets/icons';
import { VARIABLE_TYPES, TYPE_ICONS, TYPE_LABELS, CELL_CLASS, HEADER_CELL_CLASS, type VariableType } from './constants';

interface VariablesTableProps {
  collection: VariableCollection;
  onValueChange: (variableId: string, modeId: string, value: VariableValue) => void;
  onRenameVariable: (variableId: string, name: string) => void;
  onDeleteVariable: (variableId: string) => void;
  onDuplicateVariable: (variableId: string) => void;
  onChangeVariableType: (variableId: string, newType: VariableType) => void;
  onAddVariable: (type: VariableType) => void;
  onAddMode: () => void;
  onRenameModeColumn: (modeId: string, name: string) => void;
}

export const VariablesTable = memo(function VariablesTable({
  collection,
  onValueChange,
  onRenameVariable,
  onDeleteVariable,
  onDuplicateVariable,
  onChangeVariableType,
  onAddVariable,
  onAddMode,
  onRenameModeColumn,
}: VariablesTableProps) {
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const { activeKeys, recentlyTouchedKeys } = useAI();
  const aiActiveSet = useMemo(() => new Set(activeKeys), [activeKeys]);
  const aiTouchedSet = useMemo(() => new Set(recentlyTouchedKeys), [recentlyTouchedKeys]);

  const closeAddMenu = () => setAddMenuOpen(false);

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full border-collapse table-fixed">
        <thead>
          <tr>
            <th className={`${HEADER_CELL_CLASS} w-1/4`}>Name</th>
            {collection.modes.map(mode => (
              <ModeColumnHeader
                key={mode.id}
                mode={mode}
                onRename={(name) => onRenameModeColumn(mode.id, name)}
              />
            ))}
            <th className={`${CELL_CLASS} px-2 py-1 w-10`}>
              <IconButton
                onClick={onAddMode}
                className="bg-transparent rounded hover:bg-bg-hover text-text-muted hover:text-text"
                title="Add mode"
                aria-label="Add mode"
              >
                <PlusIcon className="w-4 h-4" />
              </IconButton>
            </th>
          </tr>
        </thead>
        <tbody>
          {collection.variables.map(variable => (
            <VariableRow
              key={variable.id}
              variable={variable}
              modes={collection.modes}
              onValueChange={onValueChange}
              onRename={onRenameVariable}
              onDelete={onDeleteVariable}
              onDuplicate={onDuplicateVariable}
              onChangeType={onChangeVariableType}
              isAIActive={aiActiveSet.has(`variable:${variable.id}`)}
              isAITouched={aiTouchedSet.has(`variable:${variable.id}`)}
            />
          ))}
        </tbody>
      </table>

      {/* Add variable button */}
      <div className="px-3 py-3">
        <Button
          ref={addButtonRef}
          variant="ghost"
          size="sm"
          onClick={() => setAddMenuOpen(!addMenuOpen)}
          className="h-auto px-0 gap-1.5 font-normal text-text-muted hover:text-text bg-transparent hover:bg-transparent"
          icon={<PlusIcon className="w-4 h-4" />}
          label="Add variable"
          iconRight={
            <SharedChevronDownIcon className="w-4 h-4" />
          }
        />
        <Menu
          isOpen={addMenuOpen}
          onClose={closeAddMenu}
          triggerRef={addButtonRef}
          placement="bottom-start"
          width={140}
        >
          {VARIABLE_TYPES.map(type => (
            <MenuItem
              key={type}
              onSelect={() => { onAddVariable(type); closeAddMenu(); }}
              icon={<span className="font-mono text-text-muted">{TYPE_ICONS[type]}</span>}
              label={TYPE_LABELS[type]}
            />
          ))}
        </Menu>
      </div>
    </div>
  );
});

// ── ModeColumnHeader ─────────────────────────────────────────────────

const ModeColumnHeader = memo(function ModeColumnHeader({
  mode,
  onRename,
}: {
  mode: { id: string; name: string; isDefault: boolean };
  onRename: (name: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <th className={HEADER_CELL_CLASS}>
      <span
        onClick={() => setIsEditing(true)}
        className="block min-w-0 hover:text-text cursor-text"
      >
        <InlineEdit
          value={mode.name}
          onCommit={onRename}
          editing={isEditing}
          onEditingChange={setIsEditing}
          aria-label={`Rename mode ${mode.name}`}
        />
      </span>
    </th>
  );
});
