import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { baseMarkup, MASTERS_MAP } from '../masters';

/**
 * Regression: cb715bd made baseMarkup() re-stamp the overlay markup via
 * addDataKeysToHtml on EVERY call, returning a brand-new string each time.
 * Callers on the canvas render path memoize on identity, so a fresh string
 * per call caused an infinite re-render loop (measured ~75 baseMarkup calls/sec
 * idle). The per-id stampCache must return a STABLE string instance for the
 * same (element id, master source), and invalidate when the master changes.
 */

function makeDoc(id: string, astroSource: string, markup: string) {
  const doc = new Y.Doc();
  const el = new Y.Map();
  el.set('id', id);
  el.set('astroSource', astroSource);
  doc.getMap('elements').set(id, el);
  const masters = doc.getMap(MASTERS_MAP);
  const entry = new Y.Map();
  entry.set('markup', markup);
  masters.set(astroSource, entry);
  return { doc, el };
}

describe('baseMarkup stampCache (task-079 loop fix)', () => {
  it('returns the SAME string instance across calls for an unchanged master', () => {
    const { doc, el } = makeDoc('el-1', 'library/Hero.astro', '<section class="a"><h1>x</h1></section>');
    const first = baseMarkup(doc, el);
    const second = baseMarkup(doc, el);
    expect(second).toBe(first); // identity-stable → no render loop
  });

  it('still re-stamps THIS element id (two placements get distinct data-keys)', () => {
    const { doc: d1, el: e1 } = makeDoc('el-A', 'library/Hero.astro', '<section><h1>x</h1></section>');
    const { doc: d2, el: e2 } = makeDoc('el-B', 'library/Hero.astro', '<section><h1>x</h1></section>');
    expect(baseMarkup(d1, e1)).toContain('el-A:');
    expect(baseMarkup(d2, e2)).toContain('el-B:');
  });

  it('invalidates when the master markup changes', () => {
    const { doc, el } = makeDoc('el-1', 'library/Hero.astro', '<section class="a"><h1>x</h1></section>');
    const before = baseMarkup(doc, el);
    (doc.getMap(MASTERS_MAP).get('library/Hero.astro') as Y.Map<unknown>).set(
      'markup',
      '<section class="b"><h1>x</h1></section>',
    );
    const after = baseMarkup(doc, el);
    expect(after).not.toBe(before);
    expect(after).toContain('class="b"');
  });
});
