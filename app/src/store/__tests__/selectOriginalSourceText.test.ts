// task-049 TI-1: the authoritative RESTORE_ORIGINAL_TEXT baseline comes from
// the RAW staticMarkup (pre-override), resolved by the parent and shipped in
// the ENTER_EDIT_MODE payload.
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { selectOriginalSourceText } from '../selectors';

function docWithInstance(staticMarkup?: string) {
  const doc = new Y.Doc();
  const elements = doc.getMap('elements');
  doc.transact(() => {
    const el = new Y.Map();
    el.set('id', 'el-hero');
    if (staticMarkup !== undefined) el.set('staticMarkup', staticMarkup);
    elements.set('el-hero', el);
  });
  return doc;
}

describe('selectOriginalSourceText', () => {
  it('returns the raw source text at the selector, ignoring applied overrides', () => {
    const doc = docWithInstance('<section><p>source text</p></section>');
    expect(selectOriginalSourceText(doc, 'el-hero:p-0')).toBe('source text');
  });

  it('indexes same-tag siblings per the selector', () => {
    const doc = docWithInstance('<div><p>first</p><p>second</p></div>');
    expect(selectOriginalSourceText(doc, 'el-hero:p-1')).toBe('second');
  });

  it('returns null for source keys (file:line:col)', () => {
    const doc = docWithInstance('<p>x</p>');
    expect(selectOriginalSourceText(doc, 'src/components/Text.astro:1:1')).toBeNull();
  });

  it('returns null for instance-root keys', () => {
    const doc = docWithInstance('<p>x</p>');
    expect(selectOriginalSourceText(doc, 'el-hero')).toBeNull();
  });

  it('returns null when the instance has no staticMarkup (e.g. drawn elements)', () => {
    const doc = docWithInstance();
    expect(selectOriginalSourceText(doc, 'el-hero:p-0')).toBeNull();
  });

  it('returns null when the selector is out of range', () => {
    const doc = docWithInstance('<p>only</p>');
    expect(selectOriginalSourceText(doc, 'el-hero:p-3')).toBeNull();
  });

  it('returns null for unknown instances', () => {
    const doc = docWithInstance('<p>x</p>');
    expect(selectOriginalSourceText(doc, 'el-missing:p-0')).toBeNull();
  });
});
