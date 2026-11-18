import type { CollectionField, ContentCollection, DiscoveredCollection, FieldType } from './types';

// Review F2 (task-138): files-truth projects render DISK collections in the Content
// tab — files are truth, Yjs contentCollections stays empty. Fields come from
// inference, never required: a real project's schema (zod) is not ours to
// validate against, so validateFrontmatter must never block a save.

const VALID_TYPES: ReadonlySet<string> = new Set<FieldType>(['text', 'date', 'image', 'url', 'boolean', 'list']);

export function fieldsFromInferred(inferred: Array<{ name: string; type: string }>): CollectionField[] {
  return inferred.map(({ name, type }) => ({
    id: name,
    name,
    type: (VALID_TYPES.has(type) ? type : 'text') as FieldType,
    required: false,
  }));
}

export function synthesizeLocalCollections(disk: DiscoveredCollection[]): ContentCollection[] {
  return disk.map(col => ({
    id: `local:${col.name}`,
    name: col.name,
    fields: fieldsFromInferred(col.inferredFields),
    createdAt: '',
  }));
}

/** The value a new field starts with in every post (Content tab "+ Add field" and the AI tool). */
export function defaultLocalFieldValue(type: FieldType): unknown {
  switch (type) {
    case 'boolean': return false;
    case 'list': return [];
    case 'date': return new Date().toISOString().split('T')[0];
    default: return '';
  }
}
