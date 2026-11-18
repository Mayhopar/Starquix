import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { dropLayoutMasterVersion } from '../dropLayoutMasterVersion';

function pageWith(doc: Y.Doc, id: string, fields: Record<string, unknown>) {
  const page = new Y.Map();
  for (const [k, v] of Object.entries(fields)) page.set(k, v);
  doc.getMap('pages').set(id, page);
  return page;
}

describe('dropLayoutMasterVersion', () => {
  it('removes a leftover layoutMasterVersion key', () => {
    const doc = new Y.Doc();
    const page = pageWith(doc, 'p1', { layoutName: 'L', layoutMasterVersion: 'v1' });
    dropLayoutMasterVersion(doc);
    expect(page.get('layoutMasterVersion')).toBeUndefined();
    expect(page.get('layoutName')).toBe('L'); // association untouched
  });

  it('is idempotent and a no-op when the key is absent', () => {
    const doc = new Y.Doc();
    const page = pageWith(doc, 'p1', { layoutName: 'L' });
    dropLayoutMasterVersion(doc);
    dropLayoutMasterVersion(doc);
    expect(page.get('layoutMasterVersion')).toBeUndefined();
    expect(page.get('layoutName')).toBe('L');
  });
});
