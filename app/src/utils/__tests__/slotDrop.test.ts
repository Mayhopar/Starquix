import { describe, it, expect } from 'vitest';
import { slotNameForDropTarget, draggedElementId } from '../slotDrop';
import type { ScannedElement } from '@/context/SelectionContext';

const LAYOUT_KEY = 'layoutchrome-p1';

function el(key: string, slotName?: string): ScannedElement {
  return {
    key,
    tagName: key.includes('slot') ? 'div' : 'section',
    classes: '',
    rect: { top: 0, left: 0, width: 10, height: 10 },
    parentKey: null,
    hasSourceTracking: !key.startsWith(LAYOUT_KEY),
    ...(slotName !== undefined ? { slotName } : {}),
  };
}

const SCAN: ScannedElement[] = [
  el(`${LAYOUT_KEY}:slot-0`, 'sidebar'), // named layout slot
  el(`${LAYOUT_KEY}:slot-1`, ''), // default layout slot
  el(`${LAYOUT_KEY}:header-0`), // chrome, not a slot
  el('Hero.astro:1:1'), // content root
];

describe('slotNameForDropTarget', () => {
  it('returns the named slot name when dropping onto a named layout slot', () => {
    expect(slotNameForDropTarget(`${LAYOUT_KEY}:slot-0`, SCAN, LAYOUT_KEY)).toBe('sidebar');
  });

  it('returns "" (default slot) when dropping onto the default layout slot', () => {
    expect(slotNameForDropTarget(`${LAYOUT_KEY}:slot-1`, SCAN, LAYOUT_KEY)).toBe('');
  });

  it('returns null for a non-slot chrome tag (e.g. header)', () => {
    expect(slotNameForDropTarget(`${LAYOUT_KEY}:header-0`, SCAN, LAYOUT_KEY)).toBeNull();
  });

  it('returns null for a content element (normal reparent applies)', () => {
    expect(slotNameForDropTarget('Hero.astro:1:1', SCAN, LAYOUT_KEY)).toBeNull();
  });

  it('returns null when there is no layout / null target', () => {
    expect(slotNameForDropTarget(`${LAYOUT_KEY}:slot-0`, SCAN, null)).toBeNull();
    expect(slotNameForDropTarget(null, SCAN, LAYOUT_KEY)).toBeNull();
  });

  it('returns null when the target is outside the layout namespace', () => {
    expect(slotNameForDropTarget('otherchrome-p2:slot-0', SCAN, LAYOUT_KEY)).toBeNull();
  });
});

describe('draggedElementId', () => {
  it('extracts the owning element id from a scanned key', () => {
    expect(draggedElementId('el-x:section-0')).toBe('el-x');
    expect(draggedElementId('Hero.astro:1:1')).toBe('Hero.astro');
  });
});
