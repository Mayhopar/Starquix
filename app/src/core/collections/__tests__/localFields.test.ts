import { describe, it, expect } from 'vitest';
import { synthesizeLocalCollections, fieldsFromInferred } from '../localFields';
import type { DiscoveredCollection } from '../types';

// Review F2: for files-truth projects the Content tab renders DISK collections —
// nothing seeds Yjs contentCollections (files are truth), so the panel was blank.

describe('synthesizeLocalCollections', () => {
  it('synthesizes ContentCollection rows from disk collections', () => {
    const disk: DiscoveredCollection[] = [
      { name: 'works', posts: [], inferredFields: [{ name: 'title', type: 'text' }] },
    ];
    const cols = synthesizeLocalCollections(disk);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ id: 'local:works', name: 'works' });
    expect(cols[0].fields).toEqual([{ id: 'title', name: 'title', type: 'text', required: false }]);
  });
});

describe('fieldsFromInferred', () => {
  it('maps inferred fields to non-required CollectionFields with safe type fallback', () => {
    const fields = fieldsFromInferred([
      { name: 'date', type: 'date' },
      { name: 'weird', type: 'nested' },
    ]);
    expect(fields).toEqual([
      { id: 'date', name: 'date', type: 'date', required: false },
      { id: 'weird', name: 'weird', type: 'text', required: false },
    ]);
  });
});
