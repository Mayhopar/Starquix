/**
 * task-102 — markup-axis ↻: the masters overlay carries a `rev` bumped by
 * every REAL markup change (SET_MASTER_MARKUP with different markup); each
 * instance override write stamps `masterBaseRev` on the element. The
 * DesignBar shows ↻ when overrides exist AND the master rev moved past the
 * element's stamp — the same contract as the settings axis.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { readMasterMarkupRev, serializeMasters, rebuildMasters } from '../masters';

function seedInstance(doc: Y.Doc, id = 'el-1') {
  const el = new Y.Map<unknown>();
  el.set('id', id);
  el.set('pageId', 'page-1');
  el.set('astroSource', 'Section.astro');
  el.set('staticMarkup', '<section class="p-10"><h2>t</h2></section>');
  doc.getMap<Y.Map<unknown>>('elements').set(id, el);
  return el;
}

describe('masters overlay rev (markup axis)', () => {
  it('bumps on a REAL markup change, not on a no-op re-bake', () => {
    const doc = new Y.Doc();
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(0);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>a</section>' });
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(1);
    // Editor auto-flush re-bakes unconditionally — identical markup must NOT bump.
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>a</section>' });
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(1);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>b</section>' });
    expect(readMasterMarkupRev(doc, 'Section.astro')).toBe(2);
  });

  it('rev survives the serialize/rebuild persistence round-trip', () => {
    const doc = new Y.Doc();
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>a</section>' });
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>b</section>' });
    const data = serializeMasters(doc);
    const fresh = new Y.Doc();
    rebuildMasters(fresh, data);
    expect(readMasterMarkupRev(fresh, 'Section.astro')).toBe(2);
  });

  it('an instance class-override write stamps masterBaseRev = current master rev', () => {
    const doc = new Y.Doc();
    const el = seedInstance(doc);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>a</section>' }); // rev 1
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'h2-0', breakpoint: 'base', classes: ['font-bold'] });
    expect(el.get('masterBaseRev')).toBe(1);
    applyCommand(doc, { type: 'SET_MASTER_MARKUP', astroSource: 'Section.astro', markup: '<section>b</section>' }); // rev 2
    applyCommand(doc, { type: 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE', instanceId: 'el-1', selector: 'h2-0', breakpoint: 'base', classes: ['font-bold', 'text-xl'] });
    expect(el.get('masterBaseRev')).toBe(2); // re-edit re-bases
  });
});
