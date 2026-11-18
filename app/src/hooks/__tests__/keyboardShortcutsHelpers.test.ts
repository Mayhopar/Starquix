import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  isFilledDrawnSlot,
  findEnclosingFilledDrawnSlotKey,
  isInstanceRootKey,
  resolveDrillUpKey,
  isLayoutChromeKey,
} from '../keyboardShortcutsHelpers';
import type { ScannedElement } from '@/context/SelectionContext';

function makeScanned(
  key: string,
  parentKey: string | null,
  overrides: Partial<ScannedElement> = {},
): ScannedElement {
  return {
    key,
    tagName: 'div',
    classes: '',
    rect: { top: 0, left: 0, width: 0, height: 0 },
    parentKey,
    hasSourceTracking: false,
    ...overrides,
  };
}

function makeDocWithFilledSlot(slotKey = 'drawn-1'): Y.Doc {
  const doc = new Y.Doc();
  const elements = doc.getMap('elements');
  const slot = new Y.Map<unknown>();
  slot.set('isDrawn', true);
  slot.set('slotType', 'slot');
  slot.set('slotComponentMarkup', '<section/>');
  elements.set(slotKey, slot);
  return doc;
}

describe('isFilledDrawnSlot', () => {
  it('returns true for a drawn slot with slotComponentMarkup set', () => {
    const doc = makeDocWithFilledSlot('drawn-1');
    expect(isFilledDrawnSlot(doc, 'drawn-1')).toBe(true);
  });

  it('returns false for an empty drawn slot (no slotComponentMarkup)', () => {
    const doc = new Y.Doc();
    const slot = new Y.Map<unknown>();
    slot.set('isDrawn', true);
    slot.set('slotType', 'slot');
    doc.getMap('elements').set('drawn-1', slot);
    expect(isFilledDrawnSlot(doc, 'drawn-1')).toBe(false);
  });

  it('returns false for a non-drawn element', () => {
    const doc = new Y.Doc();
    const el = new Y.Map<unknown>();
    el.set('slotType', 'slot');
    el.set('slotComponentMarkup', '<x/>');
    doc.getMap('elements').set('el-1', el);
    expect(isFilledDrawnSlot(doc, 'el-1')).toBe(false);
  });

  it('returns false for a missing key', () => {
    const doc = new Y.Doc();
    expect(isFilledDrawnSlot(doc, 'drawn-missing')).toBe(false);
  });
});

describe('findEnclosingFilledDrawnSlotKey', () => {
  it('returns the slot key when an immediate child is selected', () => {
    const doc = makeDocWithFilledSlot('drawn-1');
    const scanned = [
      makeScanned('drawn-1', null),
      makeScanned('drawn-1:section-0', 'drawn-1'),
    ];
    expect(
      findEnclosingFilledDrawnSlotKey(doc, 'drawn-1:section-0', scanned),
    ).toBe('drawn-1');
  });

  it('walks up through several ancestors to reach the slot', () => {
    const doc = makeDocWithFilledSlot('drawn-1');
    const scanned = [
      makeScanned('drawn-1', null),
      makeScanned('drawn-1:section-0', 'drawn-1'),
      makeScanned('drawn-1:div-0', 'drawn-1:section-0'),
      makeScanned('dynamic:h1:0@x', 'drawn-1:div-0'),
    ];
    expect(
      findEnclosingFilledDrawnSlotKey(doc, 'dynamic:h1:0@x', scanned),
    ).toBe('drawn-1');
  });

  it('returns the slot itself when the slot is the start key', () => {
    const doc = makeDocWithFilledSlot('drawn-1');
    const scanned = [makeScanned('drawn-1', null)];
    // Caller compares startKey === enclosing to skip the clear-fill branch
    // and let the drawn-root branch run instead.
    expect(findEnclosingFilledDrawnSlotKey(doc, 'drawn-1', scanned)).toBe('drawn-1');
  });

  it('returns null when no ancestor is a filled drawn slot', () => {
    const doc = new Y.Doc(); // no slots
    const scanned = [
      makeScanned('section-0', 'page-root'),
      makeScanned('h1-0', 'section-0'),
    ];
    expect(findEnclosingFilledDrawnSlotKey(doc, 'h1-0', scanned)).toBeNull();
  });

  it('returns null on null/undefined start', () => {
    const doc = makeDocWithFilledSlot('drawn-1');
    expect(findEnclosingFilledDrawnSlotKey(doc, null, [])).toBeNull();
    expect(findEnclosingFilledDrawnSlotKey(doc, undefined, [])).toBeNull();
  });

  it('terminates on cyclic parentKey chains', () => {
    const doc = new Y.Doc();
    const scanned = [
      makeScanned('a', 'b'),
      makeScanned('b', 'a'),
    ];
    expect(findEnclosingFilledDrawnSlotKey(doc, 'a', scanned)).toBeNull();
  });
});

describe('isInstanceRootKey', () => {
  it('treats a tag whose parent lives outside the instance namespace as the root', () => {
    // Hero in a layout slot: parentKey is the layout's slot, instanceId is heroId
    const scanned = [
      makeScanned('layout-1:slot-0', null),
      makeScanned('hero-1:section-0', 'layout-1:slot-0'),
    ];
    expect(isInstanceRootKey('hero-1:section-0', 'hero-1', scanned)).toBe(true);
  });

  it('treats a tag whose parent is in the same instance namespace as a child', () => {
    const scanned = [
      makeScanned('hero-1:section-0', 'layout-1:slot-0'),
      makeScanned('hero-1:h1-0', 'hero-1:section-0'),
    ];
    expect(isInstanceRootKey('hero-1:h1-0', 'hero-1', scanned)).toBe(false);
  });

  it('treats a tag with no parentKey as a root (top of the page)', () => {
    const scanned = [makeScanned('hero-1:section-0', null)];
    expect(isInstanceRootKey('hero-1:section-0', 'hero-1', scanned)).toBe(true);
  });

  it('treats a tag with a source-key parent (file:line:col) as a root', () => {
    // The page's source tree lives outside any component instance.
    const scanned = [makeScanned('hero-1:section-0', 'src/index.astro:10:1')];
    expect(isInstanceRootKey('hero-1:section-0', 'hero-1', scanned)).toBe(true);
  });

  it('returns false when the key is not in scannedElements at all', () => {
    expect(isInstanceRootKey('hero-1:section-0', 'hero-1', [])).toBe(false);
  });

  it('MULTI-ROOT instance: a top-level tag with sibling top-level tags is NOT the root (delete individually)', () => {
    // A layout chrome: <header>, <main>, <footer> are all top-level siblings,
    // each parented to the page source. Deleting one must hide just it, not nuke
    // the whole layout.
    const src = 'src/pages/preview/[projectId]/[pageId].astro:17:29';
    const scanned = [
      makeScanned('layout-1:header-0', src),
      makeScanned('layout-1:main-0', src),
      makeScanned('layout-1:footer-0', src),
    ];
    expect(isInstanceRootKey('layout-1:header-0', 'layout-1', scanned)).toBe(false);
    expect(isInstanceRootKey('layout-1:footer-0', 'layout-1', scanned)).toBe(false);
  });

  it('single-root instance: the sole top-level tag IS the root, its inner tag is a child', () => {
    const scanned = [
      makeScanned('hero-1:section-0', 'src/index.astro:10:1'),
      makeScanned('hero-1:h1-0', 'hero-1:section-0'),
    ];
    expect(isInstanceRootKey('hero-1:section-0', 'hero-1', scanned)).toBe(true);
    expect(isInstanceRootKey('hero-1:h1-0', 'hero-1', scanned)).toBe(false);
  });
});

describe('resolveDrillUpKey', () => {
  const L = 'layoutchrome-p1';
  const el = (key: string, parentKey: string | null) =>
    ({ key, parentKey, tagName: 'div', classes: '', rect: { top: 0, left: 0, width: 1, height: 1 }, hasSourceTracking: true }) as never;
  const scan = [
    el('src/pages/preview/[projectId]/[pageId].astro:17:29', null),
    el(`${L}:slot-0`, 'src/pages/preview/[projectId]/[pageId].astro:17:29'),
    el('Hero:1:1', `${L}:slot-0`),
  ];

  it('slot/chrome → the Layout root (not the DOM page wrapper)', () => {
    expect(resolveDrillUpKey(`${L}:slot-0`, scan, L)).toBe(L);
  });
  it('Layout root → null (nothing above)', () => {
    expect(resolveDrillUpKey(L, scan, L)).toBeNull();
  });
  it('content → its slot (normal scan parent)', () => {
    expect(resolveDrillUpKey('Hero:1:1', scan, L)).toBe(`${L}:slot-0`);
  });
  it('a DOM parent of the page wrapper → the Layout root, never the wrapper', () => {
    const s = [el('Foo:1:1', 'src/pages/preview/[projectId]/[pageId].astro:17:29')];
    expect(resolveDrillUpKey('Foo:1:1', s, L)).toBe(L);
    expect(resolveDrillUpKey('Foo:1:1', s, null)).toBeNull(); // no layout → skip wrapper, clear
  });
});

describe('isLayoutChromeKey', () => {
  it('matches the layout-chrome root and its children', () => {
    expect(isLayoutChromeKey('layoutchrome-p1')).toBe(true);
    expect(isLayoutChromeKey('layoutchrome-p1:slot-0')).toBe(true);
  });
  it('does not match content / null', () => {
    expect(isLayoutChromeKey('el-1:section-0')).toBe(false);
    expect(isLayoutChromeKey('Hero.astro:1:1')).toBe(false);
    expect(isLayoutChromeKey(null)).toBe(false);
  });
});
