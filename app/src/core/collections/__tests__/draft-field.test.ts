import { describe, it, expect } from 'vitest';
import { DEFAULT_FIELDS, createDefaultCollection } from '@/core/collections/types';

describe('draft field is in the default schema', () => {
  it('DEFAULT_FIELDS includes a `draft` boolean, not required', () => {
    const draft = DEFAULT_FIELDS.find(f => f.name === 'draft');
    expect(draft).toBeDefined();
    expect(draft!.type).toBe('boolean');
    expect(draft!.required).toBe(false);
  });

  it('a new collection includes the `draft` field with a fresh id', () => {
    const col = createDefaultCollection('news');
    const draft = col.fields.find(f => f.name === 'draft');
    expect(draft).toBeDefined();
    expect(draft!.type).toBe('boolean');
    expect(draft!.required).toBe(false);
    // createDefaultCollection rewrites field ids — should not collide with the
    // static 'f-draft' literal from DEFAULT_FIELDS.
    expect(draft!.id).not.toBe('f-draft');
  });
});
