// app/src/components/DesignBar/VariablesQuickPanel.tsx
//
// Shown in the right sidebar when no element is selected.
// Lists all variables grouped by type (Color, Number, String)
// in a Figma-like styles panel layout using Row components.

import { memo, useCallback, useState, useMemo, useRef } from 'react';
import { useYjsValue, useDispatch } from '@/store/hooks';
import { selectVariableCollections } from '@/store/variableSelectors';
import { useUndoContext } from '@/context/UndoContext';
import { Row, Button, EmptyState, Popover } from '@/components/ui';
import { PlusIcon, PencilIcon } from '@/assets/icons';
import { CustomColorPicker } from '@/components/DesignBar/CustomColorPicker';
import { VariableNumberCell } from '@/components/VariablesEditor/VariableNumberCell';
import { VariableStringCell } from '@/components/VariablesEditor/VariableStringCell';
import { defaultValueForType } from '@/components/VariablesEditor/constants';
import { useVariables } from '@/context/VariablesContext';
import { createDefaultCollection } from '@/core/variables/types';
import type { VariableCollection, VariableValue } from '@/core/variables/types';

// ── Swatches ─────────────────────────────────────────────────────────

function ColorSwatch({ hex, opacity }: { hex: string; opacity: number }) {
  return (
    <div
      className="w-6 h-6 rounded-full border border-stroke shrink-0"
      style={{ backgroundColor: hex, opacity: opacity / 100 }}
    />
  );
}

function TypeIcon({ type }: { type: 'number' | 'string' }) {
  return (
    <div className="w-6 h-6 rounded-full bg-bg-contrast border border-stroke shrink-0 flex items-center justify-center">
      <span className="text-3xs-medium text-text-muted">
        {type === 'number' ? '#' : 'Aa'}
      </span>
    </div>
  );
}

// ── Variable row ─────────────────────────────────────────────────────

function VariableItem({ variable, modeId, collectionId }: {
  variable: { id: string; name: string; type: 'color' | 'number' | 'string'; values: Record<string, VariableValue> };
  modeId: string;
  collectionId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const editBtnRef = useRef<HTMLButtonElement>(null);
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const val = variable.values[modeId] || defaultValueForType(variable.type);

  const handleChange = useCallback((value: VariableValue) => {
    takeSnapshot();
    dispatch({ type: 'UPDATE_VARIABLE_VALUE', collectionId, variableId: variable.id, modeId, value });
  }, [dispatch, collectionId, variable.id, modeId, takeSnapshot]);

  const swatch = val.type === 'color'
    ? <ColorSwatch hex={val.hex} opacity={val.opacity} />
    : <TypeIcon type={variable.type as 'number' | 'string'} />;

  return (
    <>
      <Row
        title={variable.name}
        size="sm"
        className="pl-3 pr-1 hover:bg-bg-hover text-text"
        leftIcons={swatch}
        rightIcons={
          <Button
            ref={editBtnRef}
            variant="ghost"
            size="sm"
            iconOnly
            onClick={() => setIsOpen(!isOpen)}
            title="Edit variable"
          >
            <PencilIcon className="w-4 h-4" />
          </Button>
        }
      />
      <Popover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={editBtnRef}
        placement="bottom-end"
        width={260}
        className="p-2"
      >
        {val.type === 'color' && (
          <CustomColorPicker
            value={val.hex}
            onChange={(hex) => handleChange({ type: 'color', hex, opacity: val.opacity })}
            onClose={() => setIsOpen(false)}
          />
        )}
        {val.type === 'number' && (
          <VariableNumberCell value={val} onChange={handleChange} />
        )}
        {val.type === 'string' && (
          <VariableStringCell value={val} onChange={handleChange} />
        )}
      </Popover>
    </>
  );
}

// ── Grouped variables ────────────────────────────────────────────────

type GroupedVars = {
  label: string;
  type: 'color' | 'number' | 'string';
  items: { variable: VariableCollection['variables'][number]; collectionId: string; modeId: string }[];
};

const TYPE_ORDER: ('color' | 'number' | 'string')[] = ['color', 'number', 'string'];
const TYPE_LABELS: Record<string, string> = { color: 'Color styles', number: 'Number styles', string: 'String styles' };

function groupVariables(collections: VariableCollection[]): GroupedVars[] {
  const groups = new Map<string, GroupedVars>(
    TYPE_ORDER.map(t => [t, { label: TYPE_LABELS[t], type: t, items: [] }])
  );

  for (const col of collections) {
    const defaultMode = col.modes.find(m => m.isDefault) || col.modes[0];
    if (!defaultMode) continue;

    for (const v of col.variables) {
      groups.get(v.type)!.items.push({ variable: v, collectionId: col.id, modeId: defaultMode.id });
    }
  }

  return TYPE_ORDER.map(t => groups.get(t)!).filter(g => g.items.length > 0);
}

// ── Main panel ───────────────────────────────────────────────────────

export const VariablesQuickPanel = memo(function VariablesQuickPanel() {
  const collections = useYjsValue(selectVariableCollections);
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const { setActiveCollectionId } = useVariables();

  const groups = useMemo(() => groupVariables(collections), [collections]);

  const handleAddCollection = useCallback(() => {
    takeSnapshot();
    const col = createDefaultCollection();
    dispatch({ type: 'ADD_VARIABLE_COLLECTION', collection: col });
    setActiveCollectionId(col.id);
  }, [dispatch, takeSnapshot, setActiveCollectionId]);

  return (
    <div className="flex flex-col h-full" data-testid="variables-quick-panel">
      <Row
        title="Styles"
        size="sm"
        className="h-10 pl-3 pr-1 border-b border-stroke flex-shrink-0"
        hover={false}
        right={[{ type: 'custom', unboxed: true, node: (
          <Button variant="ghost" size="sm" iconOnly onClick={handleAddCollection} title="Add collection" aria-label="Add collection"
            icon={<PlusIcon className="w-4 h-4" />} />
        ) }]}
      />

      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {groups.length === 0 ? (
          <EmptyState title="No variables defined yet" action={{ label: 'Add collection', onClick: handleAddCollection }} />
        ) : (
          groups.map(group => (
            <div key={group.type}>
              <Row title={group.label} size="sm" className="pl-3 pr-2 mt-2" />
              {group.items.map(({ variable, collectionId, modeId }) => (
                <VariableItem
                  key={variable.id}
                  variable={variable}
                  modeId={modeId}
                  collectionId={collectionId}
                />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
});
