import * as Y from 'yjs';
import type { ContentCollection, BlogSlotSettings } from '@/core/collections/types';
import { resolveBlogSettings } from '@/core/collections/yjsAccessors';
import { yMapToCollection } from './collectionCommands';

export function selectContentCollections(doc: Y.Doc): ContentCollection[] {
  const result: ContentCollection[] = [];
  doc.getMap('contentCollections').forEach((yMap) => {
    result.push(yMapToCollection(yMap as Y.Map<unknown>));
  });
  return result;
}

export function selectContentCollection(doc: Y.Doc, collectionId: string): ContentCollection | undefined {
  const yMap = doc.getMap('contentCollections').get(collectionId) as Y.Map<unknown> | undefined;
  if (!yMap) return undefined;
  return yMapToCollection(yMap);
}

export interface BlogSlotBinding {
  collectionId: string;
  settings: BlogSlotSettings;
  bindings: Record<string, string>;
}

export function selectBlogSlotBinding(doc: Y.Doc, slotKey: string): BlogSlotBinding | undefined {
  const ySlot = doc.getMap('blogSlotBindings').get(slotKey) as Y.Map<unknown> | undefined;
  if (!ySlot) return undefined;

  const collectionId = ySlot.get('collectionId') as string;
  if (!collectionId) return undefined;

  // task-102 ONE LOGIC: settings resolve instance → master defaults → app
  // default per field, so untouched instances follow the master LIVE.
  const settings: BlogSlotSettings = resolveBlogSettings(doc, slotKey);

  const yBindings = ySlot.get('bindings') as Y.Map<unknown> | undefined;
  const bindings: Record<string, string> = {};
  yBindings?.forEach((val, key) => {
    bindings[key] = val as string;
  });

  return { collectionId, settings, bindings };
}

export function selectAllBlogSlotBindings(doc: Y.Doc): Record<string, BlogSlotBinding> {
  const result: Record<string, BlogSlotBinding> = {};
  doc.getMap('blogSlotBindings').forEach((_, key) => {
    const binding = selectBlogSlotBinding(doc, key);
    if (binding) result[key] = binding;
  });
  return result;
}
