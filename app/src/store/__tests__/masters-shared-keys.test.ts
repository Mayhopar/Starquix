import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { baseMarkup } from '@/store/masters';

/**
 * Regression: the `masters` overlay is SHARED by every placement of a component.
 * A bake (editor flush / push) stores ONE instance's data-keys into the master.
 * Without per-placement re-stamping, every placement then renders markup carrying
 * that one captured id → the iframe scan sees DUPLICATE data-keys → isInstanceRootKey
 * miscounts (sameKeyCount=2) → the placement can't be selected/deleted ("deleted
 * elements return"). baseMarkup() must re-stamp each placement's OWN id.
 */
function addInstance(doc: Y.Doc, id: string, astroSource: string, staticMarkup: string) {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('astroSource', astroSource);
  el.set('staticMarkup', staticMarkup);
  doc.getMap('elements').set(id, el);
  return el;
}

describe('masters overlay — per-placement data-keys', () => {
  it('two placements sharing a baked master render with their OWN keys (no collision)', () => {
    const doc = new Y.Doc();
    const a = addInstance(doc, 'el-A', 'Hero.astro', '<section data-key="el-A:section-0"><h1 data-key="el-A:h1-0">x</h1></section>');
    const b = addInstance(doc, 'el-B', 'Hero.astro', '<section data-key="el-B:section-0"><h1 data-key="el-B:h1-0">x</h1></section>');

    // A bake captures ONE placement's instance keys (here, el-A's) into the shared master.
    applyCommand(doc, {
      type: 'SET_MASTER_MARKUP',
      astroSource: 'Hero.astro',
      markup: '<section data-key="el-A:section-0"><h1 data-key="el-A:h1-0">edited</h1></section>',
    });

    const mA = baseMarkup(doc, a);
    const mB = baseMarkup(doc, b);

    // Both see the edited master base...
    expect(mA).toContain('edited');
    expect(mB).toContain('edited');
    // ...but each carries its OWN data-keys.
    expect(mA).toContain('data-key="el-A:section-0"');
    expect(mB).toContain('data-key="el-B:section-0"');
    // The bug: B inherited A's baked keys → duplicate scan keys across placements.
    expect(mB).not.toContain('el-A:');
  });
});
