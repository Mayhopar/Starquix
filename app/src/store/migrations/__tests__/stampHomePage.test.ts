import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { stampHomePage } from '../stampHomePage';

function pageWith(doc: Y.Doc, id: string, fields: Record<string, unknown>, root = true) {
  const page = new Y.Map();
  page.set('id', id);
  for (const [k, v] of Object.entries(fields)) page.set(k, v);
  doc.getMap('pages').set(id, page);
  if (root) doc.getArray('rootPages').push([id]);
  return page;
}

describe('stampHomePage', () => {
  it('stamps the page the legacy name-magic maps to', () => {
    const doc = new Y.Doc();
    pageWith(doc, 'p1', { name: 'About' });
    const home = pageWith(doc, 'p2', { name: 'Home' });
    stampHomePage(doc);
    expect(home.get('isHome')).toBe(true);
    expect((doc.getMap('pages').get('p1') as Y.Map<unknown>).get('isHome')).toBeUndefined();
  });

  it('prefers pageId "default" over a name match', () => {
    const doc = new Y.Doc();
    pageWith(doc, 'p1', { name: 'home' });
    const def = pageWith(doc, 'default', { name: 'Start' });
    stampHomePage(doc);
    expect(def.get('isHome')).toBe(true);
  });

  it('falls back to the first non-post root page', () => {
    const doc = new Y.Doc();
    pageWith(doc, 'post-pg', { name: 'Post Page', pageType: 'post' });
    const p = pageWith(doc, 'p2', { name: 'Landing' });
    stampHomePage(doc);
    expect(p.get('isHome')).toBe(true);
  });

  it('is idempotent and dedupes multiple flags (first in rootPages order wins)', () => {
    const doc = new Y.Doc();
    const a = pageWith(doc, 'p1', { name: 'A', isHome: true });
    const b = pageWith(doc, 'p2', { name: 'B', isHome: true });
    stampHomePage(doc);
    stampHomePage(doc);
    expect(a.get('isHome')).toBe(true);
    expect(b.get('isHome')).toBeUndefined();
  });

  it('no-op on an empty project', () => {
    const doc = new Y.Doc();
    expect(() => stampHomePage(doc)).not.toThrow();
  });
});
