import type { CollectionField } from './types';

export interface FrontmatterIssue {
  field: string;
  kind: 'required';
}

export function isEmpty(value: unknown, type: CollectionField['type']): boolean {
  if (value === undefined || value === null) return true;
  if (type === 'boolean') return false;
  if (type === 'list') return Array.isArray(value) ? value.length === 0 : true;
  return String(value).trim() === '';
}

export function validateFrontmatter(
  fields: CollectionField[],
  values: Record<string, unknown>,
): FrontmatterIssue[] {
  const issues: FrontmatterIssue[] = [];
  for (const f of fields) {
    if (f.required && isEmpty(values[f.name], f.type)) {
      issues.push({ field: f.name, kind: 'required' });
    }
  }
  return issues;
}
