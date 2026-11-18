// app/src/components/VariablesEditor/VariablesEditor.tsx

import { memo, useState, useCallback } from 'react';
import { useYjsValue, useDispatch } from '@/store/hooks';
import { selectVariableCollection } from '@/store/variableSelectors';
import { useVariables } from '@/context/VariablesContext';
import { useUndoContext } from '@/context/UndoContext';
import { VariablesTopBar, type ViewMode } from './VariablesTopBar';
import { VariablesTable } from './VariablesTable';
import { VariablesCodeView } from './VariablesCodeView';
import type { VariableValue, DesignVariable, VariableCollection } from '@/core/variables/types';
import { defaultValueForType, type VariableType } from './constants';

export const VariablesEditor = memo(function VariablesEditor() {
  const { activeCollectionId } = useVariables();
  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();

  const collection = useYjsValue((doc) =>
    activeCollectionId ? selectVariableCollection(doc, activeCollectionId) : undefined
  );

  // Use empty string fallback so hooks stay unconditional; early return below guards usage.
  const collectionId = activeCollectionId || '';

  // ── Mode Handlers ──────────────────────────────────────────────────

  const handleAddMode = useCallback(() => {
    takeSnapshot();
    const name = `Mode ${(collection?.modes.length || 0) + 1}`;
    dispatch({
      type: 'ADD_VARIABLE_MODE',
      collectionId,
      mode: { id: crypto.randomUUID(), name, isDefault: false },
    });
  }, [dispatch, collectionId, collection?.modes.length, takeSnapshot]);

  const handleDeleteMode = useCallback((modeId: string) => {
    takeSnapshot();
    dispatch({ type: 'DELETE_VARIABLE_MODE', collectionId, modeId });
  }, [dispatch, collectionId, takeSnapshot]);

  // ── Variable Handlers ──────────────────────────────────────────────

  const handleValueChange = useCallback((variableId: string, modeId: string, value: VariableValue) => {
    takeSnapshot();
    dispatch({ type: 'UPDATE_VARIABLE_VALUE', collectionId, variableId, modeId, value });
  }, [dispatch, collectionId, takeSnapshot]);

  const handleRenameVariable = useCallback((variableId: string, name: string) => {
    takeSnapshot();
    dispatch({ type: 'UPDATE_VARIABLE_NAME', collectionId, variableId, name });
  }, [dispatch, collectionId, takeSnapshot]);

  const handleDeleteVariable = useCallback((variableId: string) => {
    takeSnapshot();
    dispatch({ type: 'DELETE_VARIABLE', collectionId, variableId });
  }, [dispatch, collectionId, takeSnapshot]);

  const handleDuplicateVariable = useCallback((variableId: string) => {
    if (!collection) return;
    const original = collection.variables.find(v => v.id === variableId);
    if (!original) return;
    takeSnapshot();
    const dup: DesignVariable = {
      ...original,
      id: crypto.randomUUID(),
      name: `${original.name}-copy`,
      values: { ...original.values },
    };
    dispatch({ type: 'ADD_VARIABLE', collectionId, variable: dup });
  }, [dispatch, collectionId, collection, takeSnapshot]);

  const handleChangeType = useCallback((variableId: string, newType: VariableType) => {
    takeSnapshot();
    dispatch({ type: 'UPDATE_VARIABLE_TYPE', collectionId, variableId, newType });
  }, [dispatch, collectionId, takeSnapshot]);

  const handleAddVariable = useCallback((type: VariableType) => {
    takeSnapshot();
    const count = collection?.variables.filter(v => v.type === type).length || 0;
    const name = `${type}-${count + 1}`;
    const defaultVal = defaultValueForType(type);

    const values: Record<string, VariableValue> = {};
    for (const mode of collection?.modes || []) {
      values[mode.id] = { ...defaultVal };
    }

    dispatch({
      type: 'ADD_VARIABLE',
      collectionId,
      variable: { id: crypto.randomUUID(), name, type, values },
    });
  }, [dispatch, collectionId, collection, takeSnapshot]);

  const handleRenameModeColumn = useCallback((modeId: string, name: string) => {
    takeSnapshot();
    dispatch({ type: 'RENAME_VARIABLE_MODE', collectionId, modeId, name });
  }, [dispatch, collectionId, takeSnapshot]);

  // ── Code View Handler ──────────────────────────────────────────────

  const handleCodeParsed = useCallback((parsed: VariableCollection) => {
    takeSnapshot();
    dispatch({ type: 'SET_COLLECTION_FROM_CSS', collectionId, collection: parsed });
  }, [dispatch, collectionId, takeSnapshot]);

  if (!collection) return null;

  return (
    <div className="flex-1 flex flex-col bg-bg-contrast overflow-hidden min-w-0">
      <VariablesTopBar
        collection={collection}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAddMode={handleAddMode}
        onDeleteMode={handleDeleteMode}
      />
      {viewMode === 'table' ? (
        <VariablesTable
          collection={collection}
          onValueChange={handleValueChange}
          onRenameVariable={handleRenameVariable}
          onDeleteVariable={handleDeleteVariable}
          onDuplicateVariable={handleDuplicateVariable}
          onChangeVariableType={handleChangeType}
          onAddVariable={handleAddVariable}
          onAddMode={handleAddMode}
          onRenameModeColumn={handleRenameModeColumn}
        />
      ) : (
        <VariablesCodeView
          collection={collection}
          onParsed={handleCodeParsed}
        />
      )}
    </div>
  );
});
