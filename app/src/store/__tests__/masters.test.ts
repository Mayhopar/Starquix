import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { selectMasterMarkup, baseMarkup } from '@/store/masters';

function instance(doc: Y.Doc, id: string, astroSource: string, staticMarkup: string) {
  const el = new Y.Map();
  el.set('id', id); el.set('astroSource', astroSource); el.set('staticMarkup', staticMarkup);
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

describe('masters overlay', () => {
  it('baseMarkup falls back to staticMarkup when no master entry', () => {
    const doc = new Y.Doc();
    const el = instance(doc, 'el-1', 'Section.astro', '<section>frozen</section>');
    expect(baseMarkup(doc, el)).toBe('<section>frozen</section>');
  });

  it('SET_MASTER_MARKUP creates the entry and baseMarkup prefers it', () => {
    const doc = new Y.Doc();
    const el = instance(doc, 'el-1', 'Section.astro', '<section>frozen</section>');
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>edited</section>' });
    expect(selectMasterMarkup(doc, 'Section.astro')).toBe('<section>edited</section>');
    // baseMarkup re-stamps THIS placement's data-keys onto the shared master so two
    // placements never collide (see masters-shared-keys.test.ts).
    expect(baseMarkup(doc, el)).toBe('<section data-key="el-1:section-0">edited</section>');
  });

  it('baseMarkup returns "" for an element with no astroSource and no staticMarkup', () => {
    const doc = new Y.Doc();
    const el = new Y.Map(); doc.getMap<Y.Map<unknown>>('elements').set('x', el);
    expect(baseMarkup(doc, el)).toBe('');
  });
});
