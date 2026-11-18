// app/src/store/variableCommands.ts

import * as Y from 'yjs';
import type { EditorCommand } from './types';
import type { VariableCollection, DesignVariable, VariableValue } from '@/core/variables/types';

// ── Yjs Helpers ──────────────────────────────────────────────────────

export function collectionToYMap(c: VariableCollection): Y.Map<unknown> {
  const yMap = new Y.Map<unknown>();
  yMap.set('id', c.id);
  yMap.set('name', c.name);

  const yModes = new Y.Array<Y.Map<unknown>>();
  yModes.push(c.modes.map(mode => {
    const yMode = new Y.Map<unknown>();
    yMode.set('id', mode.id);
    yMode.set('name', mode.name);
    yMode.set('isDefault', mode.isDefault);
    return yMode;
  }));
  yMap.set('modes', yModes);

  const yVars = new Y.Array<Y.Map<unknown>>();
  yVars.push(c.variables.map(variableToYMap));
  yMap.set('variables', yVars);

  return yMap;
}

function variableToYMap(v: DesignVariable): Y.Map<unknown> {
  const yVar = new Y.Map<unknown>();
  yVar.set('id', v.id);
  yVar.set('name', v.name);
  yVar.set('type', v.type);

  const yValues = new Y.Map<Y.Map<unknown>>();
  for (const [modeId, val] of Object.entries(v.values)) {
    yValues.set(modeId, valueToYMap(val));
  }
  yVar.set('values', yValues);

  return yVar;
}

function valueToYMap(val: VariableValue): Y.Map<unknown> {
  const yVal = new Y.Map<unknown>();
  yVal.set('type', val.type);
  if (val.type === 'color') {
    yVal.set('hex', val.hex);
    yVal.set('opacity', val.opacity);
  } else if (val.type === 'number') {
    yVal.set('value', val.value);
    yVal.set('unit', val.unit);
  } else {
    yVal.set('value', val.value);
  }
  return yVal;
}

export function yMapToCollection(yMap: Y.Map<unknown>): VariableCollection {
  const yModes = yMap.get('modes') as Y.Array<Y.Map<unknown>>;
  const yVars = yMap.get('variables') as Y.Array<Y.Map<unknown>>;

  return {
    id: yMap.get('id') as string,
    name: yMap.get('name') as string,
    modes: yModes?.toArray().map(yMode => ({
      id: yMode.get('id') as string,
      name: yMode.get('name') as string,
      isDefault: yMode.get('isDefault') as boolean,
    })) || [],
    variables: yVars?.toArray().map(yMapToVariable) || [],
  };
}

function yMapToVariable(yVar: Y.Map<unknown>): DesignVariable {
  const yValues = yVar.get('values') as Y.Map<Y.Map<unknown>> | undefined;
  const values: Record<string, VariableValue> = {};

  yValues?.forEach((yVal, modeId) => {
    const type = yVal.get('type') as string;
    if (type === 'color') {
      values[modeId] = { type: 'color', hex: yVal.get('hex') as string, opacity: yVal.get('opacity') as number };
    } else if (type === 'number') {
      values[modeId] = { type: 'number', value: yVal.get('value') as number, unit: yVal.get('unit') as string };
    } else {
      values[modeId] = { type: 'string', value: yVal.get('value') as string };
    }
  });

  return {
    id: yVar.get('id') as string,
    name: yVar.get('name') as string,
    type: yVar.get('type') as 'color' | 'number' | 'string',
    values,
  };
}

function defaultValueForNewType(type: 'color' | 'number' | 'string'): VariableValue {
  switch (type) {
    case 'color': return { type: 'color', hex: '#000000', opacity: 100 };
    case 'number': return { type: 'number', value: 0, unit: 'px' };
    case 'string': return { type: 'string', value: '' };
  }
}

// ── Command Handler ──────────────────────────────────────────────────

export function applyVariableCommand(doc: Y.Doc, command: EditorCommand): boolean {
  const collections = doc.getMap('variableCollections');

  switch (command.type) {
    case 'ADD_VARIABLE_COLLECTION': {
      collections.set(command.collection.id, collectionToYMap(command.collection));
      return true;
    }

    case 'DELETE_VARIABLE_COLLECTION': {
      collections.delete(command.collectionId);
      return true;
    }

    case 'RENAME_VARIABLE_COLLECTION': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      yCol.set('name', command.name);
      return true;
    }

    case 'ADD_VARIABLE_MODE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yModes = yCol.get('modes') as Y.Array<Y.Map<unknown>>;
      const yMode = new Y.Map<unknown>();
      yMode.set('id', command.mode.id);
      yMode.set('name', command.mode.name);
      yMode.set('isDefault', command.mode.isDefault);
      yModes.push([yMode]);
      return true;
    }

    case 'DELETE_VARIABLE_MODE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yModes = yCol.get('modes') as Y.Array<Y.Map<unknown>>;
      const idx = yModes.toArray().findIndex(m => m.get('id') === command.modeId);
      if (idx >= 0) yModes.delete(idx, 1);
      // Also remove values for this mode from all variables
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      yVars?.forEach(yVar => {
        const yValues = yVar.get('values') as Y.Map<Y.Map<unknown>>;
        yValues?.delete(command.modeId);
      });
      return true;
    }

    case 'RENAME_VARIABLE_MODE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yModes = yCol.get('modes') as Y.Array<Y.Map<unknown>>;
      const yMode = yModes.toArray().find(m => m.get('id') === command.modeId);
      if (yMode) yMode.set('name', command.name);
      return true;
    }

    case 'SET_DEFAULT_MODE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yModes = yCol.get('modes') as Y.Array<Y.Map<unknown>>;
      yModes.forEach(m => {
        m.set('isDefault', m.get('id') === command.modeId);
      });
      return true;
    }

    case 'REORDER_VARIABLE_MODES': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yModes = yCol.get('modes') as Y.Array<Y.Map<unknown>>;
      const current = yModes.toArray();
      const reordered = command.modeIds
        .map(id => current.find(m => m.get('id') === id))
        .filter(Boolean) as Y.Map<unknown>[];
      yModes.delete(0, yModes.length);
      // Push cloned maps to avoid Yjs reference issues
      yModes.push(reordered.map(m => {
        const clone = new Y.Map<unknown>();
        clone.set('id', m.get('id'));
        clone.set('name', m.get('name'));
        clone.set('isDefault', m.get('isDefault'));
        return clone;
      }));
      return true;
    }

    case 'ADD_VARIABLE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      yVars.push([variableToYMap(command.variable)]);
      return true;
    }

    case 'DELETE_VARIABLE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      const idx = yVars.toArray().findIndex(v => v.get('id') === command.variableId);
      if (idx >= 0) yVars.delete(idx, 1);
      return true;
    }

    case 'UPDATE_VARIABLE_NAME': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      const yVar = yVars.toArray().find(v => v.get('id') === command.variableId);
      if (yVar) yVar.set('name', command.name);
      return true;
    }

    case 'UPDATE_VARIABLE_VALUE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      const yVar = yVars.toArray().find(v => v.get('id') === command.variableId);
      if (!yVar) return false;
      const yValues = yVar.get('values') as Y.Map<Y.Map<unknown>>;
      yValues.set(command.modeId, valueToYMap(command.value));
      return true;
    }

    case 'UPDATE_VARIABLE_TYPE': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      const yVar = yVars.toArray().find(v => v.get('id') === command.variableId);
      if (!yVar) return false;
      yVar.set('type', command.newType);
      // Reset all values to defaults for the new type
      const yValues = yVar.get('values') as Y.Map<Y.Map<unknown>>;
      const defaultVal = defaultValueForNewType(command.newType);
      yValues.forEach((_, modeId) => {
        yValues.set(modeId, valueToYMap(defaultVal));
      });
      return true;
    }

    case 'REORDER_VARIABLES': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yVars = yCol.get('variables') as Y.Array<Y.Map<unknown>>;
      const current = yVars.toArray();
      const plain = current.map(yMapToVariable);
      const reordered = command.variableIds
        .map(id => plain.find(v => v.id === id))
        .filter(Boolean) as DesignVariable[];
      yVars.delete(0, yVars.length);
      yVars.push(reordered.map(variableToYMap));
      return true;
    }

    case 'SET_COLLECTION_FROM_CSS': {
      // Full replacement from code editor parse
      collections.set(command.collectionId, collectionToYMap(command.collection));
      return true;
    }

    default:
      return false;
  }
}
