import { describe, it, expect } from 'vitest';
import { isSlotSelection } from '../slotDetection';

describe('isSlotSelection', () => {
  it('detects each slot signal independently', () => {
    expect(isSlotSelection({ elementType: 'slot' })).toBe(true);          // codegen slot
    expect(isSlotSelection({ slotType: 'slot' })).toBe(true);             // draw-tool slot
    expect(isSlotSelection({ tagName: 'slot' })).toBe(true);              // empty <slot>
    expect(isSlotSelection({ tagName: 'SLOT' })).toBe(true);              // case-insensitive
    expect(isSlotSelection({ tagName: 'div', slotName: 'hero' })).toBe(true); // filled <div data-sq-slot>
    expect(isSlotSelection({ tagName: 'div', slotName: '' })).toBe(true);     // default (unnamed) filled slot
  });

  it('is false for a normal element', () => {
    expect(isSlotSelection({ tagName: 'div' })).toBe(false);
    expect(isSlotSelection({ tagName: 'section', elementType: 'frame' })).toBe(false);
    expect(isSlotSelection({})).toBe(false);
  });
});
