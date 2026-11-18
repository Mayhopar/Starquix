/**
 * Owner acceptance criterion 2: `*` must mean "THIS element diverged".
 *
 * `selectInstanceDivergence` answers one boolean for the whole instance, and
 * DesignBar lit `*` from it on every selection inside that instance — so an
 * untouched sibling `<p>` wore `P*`, the user went hunting, and found nothing.
 * Worse, in a dirty placement nothing said WHICH element actually moved.
 *
 * `collectInstanceDivergence` is the same scan reporting the element KEYS it
 * found instead of collapsing to a boolean, so the marker can be attributed.
 * `selectInstanceDivergence` is defined as `length > 0` — one body, one state
 * machine, no parallel logic.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { collectInstanceDivergence, selectInstanceDivergence } from '../instanceLifecycle';

const INSTANCE = 'el-abc';
const PAGE = 'page-1';
const MARKUP = '<div class="p-4"><h1 class="text-xl">Title</h1><p class="text-sm">Body</p></div>';

function docWithInstance(): { doc: Y.Doc; yEl: Y.Map<unknown> } {
  const doc = new Y.Doc();
  const yEl = new Y.Map();
  doc.transact(() => {
    yEl.set('staticMarkup', MARKUP);
    yEl.set('astroSource', 'src/components/Hero.astro');
    doc.getMap('elements').set(INSTANCE, yEl);
  }, 'sync');
  return { doc, yEl };
}

describe('collectInstanceDivergence — which element actually diverged', () => {
  it('an untouched instance reports nothing', () => {
    const { doc } = docWithInstance();
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([]);
    expect(selectInstanceDivergence(doc, INSTANCE, PAGE)).toBe(false);
  });

  it('a class override on ONE child names that child, not its siblings', () => {
    const { doc, yEl } = docWithInstance();
    doc.transact(() => {
      const co = new Y.Map<Y.Map<Y.Array<string>>>();
      const sel = new Y.Map<Y.Array<string>>();
      sel.set('base', Y.Array.from(['text-3xl', 'text-red-500']));
      co.set('h1-0', sel);
      yEl.set('classOverrides', co);
    }, 'sync');

    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([`${INSTANCE}:h1-0`]);
    // The <p> sibling is NOT in the list — that is the whole point.
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).not.toContain(`${INSTANCE}:p-1`);
    expect(selectInstanceDivergence(doc, INSTANCE, PAGE)).toBe(true);
  });

  it('a text edit names the edited child', () => {
    const { doc } = docWithInstance();
    doc.transact(() => {
      doc.getMap('sourceText').set(`${INSTANCE}:p-1`, 'new body');
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([`${INSTANCE}:p-1`]);
  });

  it('a selector-keyed override map names its selector', () => {
    const { doc, yEl } = docWithInstance();
    doc.transact(() => {
      const lo = new Y.Map<Y.Map<unknown>>();
      lo.set('h1-0', new Y.Map());
      yEl.set('linkOverrides', lo);
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([`${INSTANCE}:h1-0`]);
  });

  it('the ROOT owns what only the root can own: its own image attrs and its structure', () => {
    const { doc, yEl } = docWithInstance();
    doc.transact(() => {
      // imageAttributes on the instance element is the ROOT's own attribute map
      // (commands.ts UPDATE_IMAGE_ATTRIBUTE, instance-root branch) — attribute
      // keys, not selectors.
      const ia = new Y.Map<unknown>();
      ia.set('alt', 'hello');
      yEl.set('imageAttributes', ia);
      // A deleted child / a reorder is a change to the instance's structure.
      yEl.set('deletedSelectors', Y.Array.from(['p-1']));
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([INSTANCE]);
  });

  it('an edited sourceClasses entry names its own key', () => {
    const { doc } = docWithInstance();
    doc.transact(() => {
      const entry = new Y.Map<unknown>();
      entry.set('classes', 'text-3xl');
      entry.set('edited', true);
      // `p-0`, not `h1-0`: the index parse here is
      // `selector.replace(/^[a-z]+-/, '')`, which a digit-bearing tag name
      // defeats, and the index is per-TAG (this markup has one <p>).
      doc.getMap('sourceClasses').set(`${INSTANCE}:p-0`, entry);
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([`${INSTANCE}:p-0`]);
  });

  it('a no-op class override (same token SET) still counts as nothing', () => {
    const { doc, yEl } = docWithInstance();
    doc.transact(() => {
      const co = new Y.Map<Y.Map<Y.Array<string>>>();
      const sel = new Y.Map<Y.Array<string>>();
      sel.set('base', Y.Array.from(['text-xl'])); // identical to the markup
      co.set('h1-0', sel);
      yEl.set('classOverrides', co);
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([]);
  });

  it('two diverged children are BOTH reported', () => {
    const { doc, yEl } = docWithInstance();
    doc.transact(() => {
      const co = new Y.Map<Y.Map<Y.Array<string>>>();
      const sel = new Y.Map<Y.Array<string>>();
      sel.set('base', Y.Array.from(['text-3xl']));
      co.set('h1-0', sel);
      yEl.set('classOverrides', co);
      doc.getMap('sourceText').set(`${INSTANCE}:p-1`, 'new body');
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE).sort())
      .toEqual([`${INSTANCE}:h1-0`, `${INSTANCE}:p-1`]);
  });

  it('firstOnly short-circuits — selectInstanceDivergence keeps its cheap path', () => {
    const { doc, yEl } = docWithInstance();
    doc.transact(() => {
      yEl.set('orderOverrides', Y.Array.from(['p-1', 'h1-0']));
      doc.getMap('sourceText').set(`${INSTANCE}:p-1`, 'new body');
    }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE, { firstOnly: true })).toHaveLength(1);
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toHaveLength(2);
  });

  it('an instance with no markup reports nothing (unchanged contract)', () => {
    const doc = new Y.Doc();
    doc.transact(() => { doc.getMap('elements').set(INSTANCE, new Y.Map()); }, 'sync');
    expect(collectInstanceDivergence(doc, INSTANCE, PAGE)).toEqual([]);
    expect(selectInstanceDivergence(doc, INSTANCE, PAGE)).toBe(false);
  });
});
