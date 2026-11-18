import type { CollectionField } from '@/core/collections/types';
export interface PropertyDescriptor {
  key: string;
  field: CollectionField | null;
  source: 'schema' | 'inferred' | 'extra';
  editor: CollectionField['type'] | 'readonly';
  required: boolean;
  readOnlyReason: string | null;
}
export function describeProperties(fields: readonly CollectionField[], values: Readonly<Record<string, unknown>>, source: 'schema' | 'inferred', readOnlyPropertyKeys: readonly string[] = []): PropertyDescriptor[] {
  const seen = new Set<string>();
  const descriptors: PropertyDescriptor[] = [];
  for (const field of fields) {
    if (seen.has(field.name)) continue;
    seen.add(field.name);
    const value = values[field.name];
    const compatible = value === undefined || (
      field.type === 'boolean' ? typeof value === 'boolean' :
      field.type === 'list' ? Array.isArray(value) && value.every(item => typeof item === 'string') :
      ['text', 'date', 'url', 'image'].includes(field.type) && typeof value === 'string');
    const conflicting = fields.some(other => other.name === field.name && other.type !== field.type);
    const sourceReadOnly = readOnlyPropertyKeys.includes(field.name);
    const editable = compatible && !conflicting && !sourceReadOnly;
    descriptors.push({ key: field.name, field, source, editor: editable ? field.type : 'readonly', required: source === 'schema' && field.required,
      readOnlyReason: editable ? null : sourceReadOnly
        ? 'This property uses source formatting the editor cannot change safely. Edit it in the file.'
        : 'This value has a type the editor cannot change safely. Edit it in the file.' });
  }
  for (const key of Object.keys(values)) if (!seen.has(key)) descriptors.push({ key, field: null, source: 'extra', editor: 'readonly', required: false,
    readOnlyReason: 'This property is not described by the collection. Edit it in the file.' });
  return descriptors;
}
/** The row label for a frontmatter key: `heroImage` / `hero_image` → "Hero image"; acronyms stay ("canonicalURL" → "Canonical URL"). */
export function propertyLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_-]+/).filter(Boolean)
    .map(word => /^[A-Z0-9]{2,}$/.test(word) ? word : word.toLowerCase()).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
/** Nothing to show — the row draws the "Empty" placeholder. */
export const isEmptyValue = (value: unknown) => value === undefined || value === '' || Array.isArray(value) && value.length === 0;
export function propertyValueSummary(value: unknown): string {
  if (isEmptyValue(value)) return 'Empty';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`;
  if (typeof value === 'object') return 'Structured value';
  return String(value);
}
export function propertyInspection(value: unknown): string {
  if (value && typeof value === 'object' && 'raw' in value && typeof value.raw === 'string') return value.raw;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? 'Empty';
}
