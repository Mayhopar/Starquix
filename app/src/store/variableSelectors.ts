// app/src/store/variableSelectors.ts

import * as Y from 'yjs';
import type { VariableCollection, DesignVariable } from '@/core/variables/types';
import { yMapToCollection } from './variableCommands';

export function selectVariableCollections(doc: Y.Doc): VariableCollection[] {
  const result: VariableCollection[] = [];
  doc.getMap('variableCollections').forEach((yMap) => {
    result.push(yMapToCollection(yMap as Y.Map<unknown>));
  });
  return result;
}

export function selectVariableCollection(doc: Y.Doc, collectionId: string): VariableCollection | undefined {
  const collections = doc.getMap('variableCollections');
  const yMap = collections.get(collectionId) as Y.Map<unknown> | undefined;
  if (!yMap) return undefined;
  return yMapToCollection(yMap);
}

export function selectAllColorVariables(doc: Y.Doc): DesignVariable[] {
  return selectVariableCollections(doc).flatMap(col =>
    col.variables.filter(v => v.type === 'color')
  );
}
