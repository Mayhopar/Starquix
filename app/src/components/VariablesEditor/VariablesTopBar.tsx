import { CloseIcon as SharedCloseIcon } from '@/assets/icons';
// app/src/components/VariablesEditor/VariablesTopBar.tsx

import { memo } from 'react';
import { Tabs, Button } from '@/components/ui';
import { PlusIcon } from '@/assets/icons';
import type { VariableCollection } from '@/core/variables/types';

export type ViewMode = 'table' | 'code';

interface VariablesTopBarProps {
  collection: VariableCollection;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onAddMode: () => void;
  onDeleteMode: (modeId: string) => void;
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <SharedCloseIcon className={className} />
  );
}

export const VariablesTopBar = memo(function VariablesTopBar({
  collection,
  viewMode,
  onViewModeChange,
  onAddMode,
  onDeleteMode,
}: VariablesTopBarProps) {
  return (
    <div className="flex items-stretch h-10 px-3 gap-2 border-b border-stroke bg-bg shrink-0">
      {/* Left: Mode tabs + add */}
      <div className="flex items-stretch gap-4 min-w-0">
        {collection.modes.map(mode => {
          const canDelete = !mode.isDefault;
          return (
            <div
              key={mode.id}
              className="group relative flex items-center gap-1.5 py-3 text-xs-medium bg-transparent text-text-secondary hover:text-text"
            >
              {mode.name}
              {canDelete && (
                <span
                  onClick={(e) => { e.stopPropagation(); onDeleteMode(mode.id); }}
                  className="w-3.5 h-3.5 flex items-center justify-center rounded-sm hover:bg-bg-hover text-text-muted hover:text-text cursor-pointer"
                  title={`Delete ${mode.name}`}
                >
                  <CloseIcon className="w-4 h-4" />
                </span>
              )}
            </div>
          );
        })}
        <Button
          variant="ghost"
          iconOnly
          onClick={onAddMode}
          className="w-7 h-auto self-stretch rounded-none bg-transparent hover:bg-transparent text-text-muted hover:text-text"
          title="Add mode"
          aria-label="Add mode"
          icon={<PlusIcon className="w-4 h-4" />}
        />
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right: View mode tabs + close */}
      <Tabs
        options={[
          { value: 'table', label: 'Table' },
          { value: 'code', label: 'Code' },
        ]}
        value={viewMode}
        onChange={(v) => onViewModeChange(v as ViewMode)}
        size="sm"
      />

    </div>
  );
});
