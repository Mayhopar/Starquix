/**
 * Generation-time svg → pen-shape conversion (add_page_content pipeline).
 * AI-created elements are born without static inline svgs; unconvertible
 * svgs stay inline.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { selectResolvedStaticMarkup } from '@/store/selectors';
import { convertElementSvgs } from '../convertElementSvgs';
import type { EditorCommand } from '@/store/types';

const EL = 'element-gen-1';
const PAGE = 'page-1';

function buildDoc(markup: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
  doc.transact(() => {
    const el = new Y.Map<unknown>();
    el.set('id', EL);
    el.set('pageId', PAGE);
    el.set('staticMarkup', markup);
    doc.getMap('elements').set(EL, el);
  });
  return doc;
}

describe('convertElementSvgs', () => {
  it('converts every convertible svg; unconvertible ones stay inline', async () => {
    // svg-0: single circle (convertible). svg-1: two shapes (unconvertible).
    const markup =
      `<div data-key="${EL}:div-0"><svg width="96" height="96" viewBox="0 0 96 96">` +
      '<circle cx="48" cy="48" r="32" fill="#0066cc"/></svg>' +
      '<svg viewBox="0 0 10 10"><rect width="4" height="4"/><circle cx="7" cy="7" r="2"/></svg></div>';
    const doc = buildDoc(markup);

    const n = await convertElementSvgs(doc, EL, PAGE);
    expect(n).toBe(1);

    const el = doc.getMap('elements').get(EL) as Y.Map<unknown>;
    const deleted = (el.get('deletedSelectors') as Y.Array<string>).toArray();
    expect(deleted).toEqual(['svg-0']);

    // one drawn pen element, parented into the card container
    let drawn: Y.Map<unknown> | null = null;
    doc.getMap('elements').forEach((v, id) => {
      if (String(id).startsWith('drawn-')) drawn = v as Y.Map<unknown>;
    });
    expect(drawn).not.toBeNull();
    expect(drawn!.get('penPath')).toBeTruthy();

    // resolved markup: convertible svg gone, unconvertible svg still inline
    const resolved = selectResolvedStaticMarkup(doc, EL)!;
    expect(resolved).not.toContain('svg-0"');
    expect(resolved).toContain(`data-key="${EL}:svg-1"`);
  });

  it('no svgs leaves the document unchanged and returns 0', async () => {
    const doc = buildDoc(`<div data-key="${EL}:div-0"><h3 data-key="${EL}:h3-0">Hi</h3></div>`);
    const before = Y.encodeStateAsUpdate(doc);
    expect(await convertElementSvgs(doc, EL, PAGE)).toBe(0);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });
});
