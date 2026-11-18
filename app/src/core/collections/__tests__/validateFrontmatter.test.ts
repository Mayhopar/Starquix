import { describe, it, expect } from 'vitest';
import { validateFrontmatter } from '../validateFrontmatter';
import type { CollectionField } from '../types';

const field = (over: Partial<CollectionField>): CollectionField => ({
  id: 'f', name: 'x', type: 'text', required: false, ...over,
});

describe('validateFrontmatter', () => {
  it('returns no issues when required fields have values', () => {
    const fields = [field({ name: 'title', required: true })];
    expect(validateFrontmatter(fields, { title: 'Hi' })).toEqual([]);
  });

  it('reports required empty text', () => {
    const fields = [field({ name: 'title', required: true })];
    const issues = validateFrontmatter(fields, { title: '' });
    expect(issues).toEqual([{ field: 'title', kind: 'required' }]);
  });

  it('reports required missing key', () => {
    const fields = [field({ name: 'date', type: 'date', required: true })];
    const issues = validateFrontmatter(fields, {});
    expect(issues).toEqual([{ field: 'date', kind: 'required' }]);
  });

  it('treats boolean false as a valid value (not empty)', () => {
    const fields = [field({ name: 'draft', type: 'boolean', required: true })];
    expect(validateFrontmatter(fields, { draft: false })).toEqual([]);
  });

  it('treats empty array as empty', () => {
    const fields = [field({ name: 'tags', type: 'list', required: true })];
    expect(validateFrontmatter(fields, { tags: [] })).toEqual([
      { field: 'tags', kind: 'required' },
    ]);
  });

  it('ignores optional fields', () => {
    const fields = [field({ name: 'description', required: false })];
    expect(validateFrontmatter(fields, {})).toEqual([]);
  });
});
