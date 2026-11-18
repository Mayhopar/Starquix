import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';

function setupDoc() {
  const doc = new Y.Doc();
  const sourceClasses = doc.getMap('sourceClasses');
  // Create a source element with some classes
  const entry = new Y.Map();
  entry.set('classes', 'p-4 bg-white');
  sourceClasses.set('test-key', entry);
  return doc;
}

describe('GRID_PLACE_ELEMENT', () => {
  it('adds grid-column and grid-row classes to source element', () => {
    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'GRID_PLACE_ELEMENT',
        key: 'test-key',
        gridColumn: 'col-start-2',
        gridRow: 'row-start-1',
      });
    });

    const entry = doc.getMap('sourceClasses').get('test-key') as Y.Map<unknown>;
    const classes = entry.get('classes') as string;
    expect(classes).toContain('col-start-2');
    expect(classes).toContain('row-start-1');
    expect(classes).toContain('p-4'); // preserve existing
    expect(classes).toContain('bg-white'); // preserve existing
  });

  it('replaces existing grid placement classes', () => {
    const doc = setupDoc();
    // First placement
    doc.transact(() => {
      applyCommand(doc, {
        type: 'GRID_PLACE_ELEMENT',
        key: 'test-key',
        gridColumn: 'col-start-1',
        gridRow: 'row-start-1',
      });
    });
    // Second placement
    doc.transact(() => {
      applyCommand(doc, {
        type: 'GRID_PLACE_ELEMENT',
        key: 'test-key',
        gridColumn: 'col-start-3',
        gridRow: 'row-start-2',
      });
    });

    const entry = doc.getMap('sourceClasses').get('test-key') as Y.Map<unknown>;
    const classes = entry.get('classes') as string;
    expect(classes).toContain('col-start-3');
    expect(classes).toContain('row-start-2');
    expect(classes).not.toContain('col-start-1');
    expect(classes).not.toContain('row-start-1');
  });

  it('preserves span when moving (multi-token gridColumn/gridRow)', () => {
    const doc = setupDoc();
    // Place with start + span in a single string
    doc.transact(() => {
      applyCommand(doc, {
        type: 'GRID_PLACE_ELEMENT',
        key: 'test-key',
        gridColumn: 'col-start-2 col-span-3',
        gridRow: 'row-start-1 row-span-2',
      });
    });

    const entry = doc.getMap('sourceClasses').get('test-key') as Y.Map<unknown>;
    const classes = entry.get('classes') as string;
    expect(classes).toContain('col-start-2');
    expect(classes).toContain('col-span-3');
    expect(classes).toContain('row-start-1');
    expect(classes).toContain('row-span-2');
    expect(classes).toContain('p-4'); // non-grid classes preserved
  });

  it('only strips grid classes at the target breakpoint, preserves others', () => {
    const doc = new Y.Doc();
    const sourceClasses = doc.getMap('sourceClasses');
    const entry = new Y.Map();
    entry.set('classes', 'order-first md:col-start-1 md:col-span-6 flex lg:row-start-2 sm:row-span-3 col-span-full');
    sourceClasses.set('bp-key', entry);

    // Place at md: breakpoint — only md: grid classes should be stripped
    doc.transact(() => {
      applyCommand(doc, {
        type: 'GRID_PLACE_ELEMENT',
        key: 'bp-key',
        gridColumn: 'md:col-start-3',
        gridRow: 'md:row-start-1',
      });
    });

    const result = doc.getMap('sourceClasses').get('bp-key') as Y.Map<unknown>;
    const classes = result.get('classes') as string;
    // New md: classes added
    expect(classes).toContain('md:col-start-3');
    expect(classes).toContain('md:row-start-1');
    // Old md: grid classes stripped
    expect(classes).not.toContain('md:col-start-1');
    expect(classes).not.toContain('md:col-span-6');
    // Grid classes at OTHER breakpoints preserved
    expect(classes).toContain('lg:row-start-2');
    expect(classes).toContain('sm:row-span-3');
    expect(classes).toContain('col-span-full'); // base preserved
    // Non-grid classes preserved
    expect(classes).toContain('order-first');
    expect(classes).toContain('flex');
  });
});

describe('SET_GRID_SPAN', () => {
  it('adds col-span and row-span classes (row-span-1 normalized away as default)', () => {
    const doc = setupDoc();
    doc.transact(() => {
      applyCommand(doc, {
        type: 'SET_GRID_SPAN',
        key: 'test-key',
        gridColumn: 'col-span-2',
        gridRow: 'row-span-1',
      });
    });

    const entry = doc.getMap('sourceClasses').get('test-key') as Y.Map<unknown>;
    const classes = entry.get('classes') as string;
    expect(classes).toContain('col-span-2');
    // row-span-1 is CSS default and gets normalized away
    expect(classes).not.toContain('row-span-1');
  });

  it('preserves position when changing span (multi-token)', () => {
    const doc = setupDoc();
    // First: place element
    doc.transact(() => {
      applyCommand(doc, {
        type: 'GRID_PLACE_ELEMENT',
        key: 'test-key',
        gridColumn: 'col-start-2',
        gridRow: 'row-start-3',
      });
    });
    // Then: resize (span change preserves position)
    doc.transact(() => {
      applyCommand(doc, {
        type: 'SET_GRID_SPAN',
        key: 'test-key',
        gridColumn: 'col-start-2 col-span-2',
        gridRow: 'row-start-3 row-span-3',
      });
    });

    const entry = doc.getMap('sourceClasses').get('test-key') as Y.Map<unknown>;
    const classes = entry.get('classes') as string;
    expect(classes).toContain('col-start-2');
    expect(classes).toContain('col-span-2');
    expect(classes).toContain('row-start-3');
    expect(classes).toContain('row-span-3');
  });
});

// Live 2026-11-12 (desktop, ul > li cards): a card dragged at lg carried
// lg:col-start-2; a span resize at xl wrote xl:col-span-2 alone and the card
// jumped to column 1 — the span shorthand at xl reset the lg start.
describe('a span written at a larger breakpoint keeps the start in force', () => {
  it('SET_GRID_SPAN at xl keeps the column a drag set at lg', () => {
    const doc = new Y.Doc();
    const entry = new Y.Map();
    entry.set('classes', 'p-6 lg:col-start-2 lg:col-span-3 lg:row-start-2');
    doc.getMap('sourceClasses').set('k', entry);
    doc.transact(() => {
      applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'xl:col-start-2 xl:col-span-2', gridRow: '' });
    });
    expect(entry.get('classes')).toBe('p-6 lg:col-start-2 lg:col-span-3 lg:row-start-2 xl:col-start-2 xl:col-span-2');
  });
});

describe('column-first sizing (task-090): a span governs size, fixed w/h yields', () => {
  function docWith(classes: string) {
    const doc = new Y.Doc();
    const sc = doc.getMap('sourceClasses');
    const e = new Y.Map();
    e.set('classes', classes);
    sc.set('k', e);
    return doc;
  }
  const out = (doc: Y.Doc) =>
    (doc.getMap('sourceClasses').get('k') as Y.Map<unknown>).get('classes') as string;

  it('writing a column span strips conflicting fixed width (drawn w-[390px]), keeps height', () => {
    const doc = docWith('w-[390px] h-[201px] bg-stone-300 col-span-6');
    doc.transact(() => applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'lg:col-span-10', gridRow: '' }));
    const c = out(doc);
    expect(c).toContain('lg:col-span-10');
    expect(c).not.toMatch(/(?:^|\s)w-\[390px\]/); // fixed width removed → cell governs width
    expect(c).toContain('h-[201px]'); // height untouched (no row change)
    expect(c).toContain('bg-stone-300');
  });

  it('strips numeric fixed width (w-96) on a span WRITE but keeps w-full', () => {
    const doc = docWith('w-full flex');
    doc.transact(() => applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'col-start-1 col-span-3', gridRow: '' }));
    expect(out(doc)).toContain('w-full'); // stretch width is not "fixed" — keep it

    const doc2 = docWith('w-96 flex');
    doc2.transact(() => applyCommand(doc2, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'col-span-3', gridRow: '' }));
    expect(out(doc2)).not.toMatch(/(?:^|\s)w-96(?:\s|$)/);
  });

  it('a pure MOVE (GRID_PLACE_ELEMENT) never strips fixed sizes — drag-drop and occupant swap keep the drawn size', () => {
    // task-090 review: buildGridPlacementTokens always emits col/row tokens, so
    // every drop (incl. the swapped occupant) hit the strip and lost w/h on a
    // reposition with zero size intent. Only SET_GRID_SPAN (resize) strips.
    const doc = docWith('w-[390px] h-[201px] bg-stone-300 col-span-2');
    doc.transact(() => applyCommand(doc, {
      type: 'GRID_PLACE_ELEMENT', key: 'k',
      gridColumn: 'col-start-3 col-span-2', gridRow: 'row-start-2',
    }));
    const c = out(doc);
    expect(c).toContain('w-[390px]');
    expect(c).toContain('h-[201px]');
    expect(c).toContain('col-start-3');
    expect(c).toContain('col-span-2');
  });

  it('span write strips fixed sizes only at breakpoints that APPLY at the target (min-width cascade)', () => {
    // target lg: base + md: apply at lg (stripped); xl: does not (kept)
    const doc = docWith('w-64 md:w-32 xl:w-96 col-span-2');
    doc.transact(() => applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'lg:col-span-3', gridRow: '' }));
    const c = out(doc);
    expect(c).not.toMatch(/(?:^|\s)w-64(?:\s|$)/);
    expect(c).not.toContain('md:w-32');
    expect(c).toContain('xl:w-96');
  });

  it('base span write strips only the base fixed width, keeps prefixed ones', () => {
    const doc = docWith('w-64 md:w-32');
    doc.transact(() => applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'col-span-4', gridRow: '' }));
    const c = out(doc);
    expect(c).not.toMatch(/(?:^|\s)w-64(?:\s|$)/);
    expect(c).toContain('md:w-32');
  });

  it('writing a row span strips conflicting fixed height, not width', () => {
    const doc = docWith('w-[390px] h-[201px]');
    doc.transact(() => applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: '', gridRow: 'row-span-3' }));
    const c = out(doc);
    expect(c).toContain('row-span-3');
    expect(c).not.toMatch(/(?:^|\s)h-\[201px\]/);
    expect(c).toContain('w-[390px]'); // width untouched (no col change)
  });

  it('does not strip min-w / max-w (only the size token)', () => {
    const doc = docWith('max-w-[640px] min-w-[100px] col-span-2');
    doc.transact(() => applyCommand(doc, { type: 'SET_GRID_SPAN', key: 'k', gridColumn: 'col-span-4', gridRow: '' }));
    const c = out(doc);
    expect(c).toContain('max-w-[640px]');
    expect(c).toContain('min-w-[100px]');
  });
});
