/**
 * Regression: a plain created section (add_page_content → type 'frame' +
 * staticMarkup, no componentType) must select with the NORMAL blue outline,
 * not the cyan component one. Its rendered root key is `${id}:section-0`
 * (never the bare Yjs id), and the old variant logic returned 'component'
 * for every key that missed the elements map.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { selectionVariantForKey } from './selectionVariant';

function docWith(entries: Record<string, Record<string, unknown>>): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    const elements = doc.getMap('elements');
    for (const [id, fields] of Object.entries(entries)) {
      const yEl = new Y.Map();
      for (const [k, v] of Object.entries(fields)) yEl.set(k, v);
      elements.set(id, yEl);
    }
  });
  return doc;
}

describe('selectionVariantForKey', () => {
  it('plain frame section selected by child key → normal (the bug)', () => {
    const doc = docWith({
      'el-ai': { type: 'frame', staticMarkup: '<section class="py-16"></section>' },
    });
    expect(selectionVariantForKey(doc, 'el-ai:section-0')).toBe('normal');
  });

  it('component instance child key → component', () => {
    const doc = docWith({
      'el-hero': { type: 'component', componentType: 'Hero', staticMarkup: '<section></section>' },
    });
    expect(selectionVariantForKey(doc, 'el-hero:section-0')).toBe('component');
  });

  it('direct Yjs hits keep their variants', () => {
    const doc = docWith({
      'el-frame': { type: 'frame' },
      'el-inst': { type: 'instance' },
      'el-slot': { type: 'frame', slotType: 'slot' },
      'el-blog': { type: 'frame', slotType: 'blog' },
    });
    expect(selectionVariantForKey(doc, 'el-frame')).toBe('normal');
    expect(selectionVariantForKey(doc, 'el-inst')).toBe('component');
    expect(selectionVariantForKey(doc, 'el-slot')).toBe('slot');
    expect(selectionVariantForKey(doc, 'el-blog')).toBe('blog');
  });

  it('unknown owner keeps the cyan fallback; null key is normal', () => {
    const doc = docWith({});
    expect(selectionVariantForKey(doc, 'el-ghost:div-0')).toBe('component');
    expect(selectionVariantForKey(doc, null)).toBe('normal');
  });
});
