import { describe, it, expect } from 'vitest';
import {
  isLayoutChromeKey,
  isLayoutChromeChildKey,
  isLayoutSlotKey,
  isSlotSelector,
} from '../layoutChromeKeys';

describe('layoutChromeKeys — the chrome key namespace lives in ONE module', () => {
  it('isLayoutChromeKey matches the root and any child', () => {
    expect(isLayoutChromeKey('layoutchrome-page-1')).toBe(true);
    expect(isLayoutChromeKey('layoutchrome-page-1:slot-0')).toBe(true);
    expect(isLayoutChromeKey('el-x:slot-0')).toBe(false);
    expect(isLayoutChromeKey(null)).toBe(false);
    expect(isLayoutChromeKey(undefined)).toBe(false);
  });

  it('isLayoutChromeChildKey is scoped to ONE root', () => {
    expect(isLayoutChromeChildKey('layoutchrome-p1:slot-0', 'layoutchrome-p1')).toBe(true);
    expect(isLayoutChromeChildKey('layoutchrome-p2:slot-0', 'layoutchrome-p1')).toBe(false);
    // The bare root is not its own child.
    expect(isLayoutChromeChildKey('layoutchrome-p1', 'layoutchrome-p1')).toBe(false);
    expect(isLayoutChromeChildKey('layoutchrome-p1:slot-0', null)).toBe(false);
  });

  it('isSlotSelector matches a bare slot sub-selector only', () => {
    expect(isSlotSelector('slot-0')).toBe(true);
    expect(isSlotSelector('slot-12')).toBe(true);
    expect(isSlotSelector('slot')).toBe(false);
    expect(isSlotSelector('slot-')).toBe(false);
    expect(isSlotSelector('header-0')).toBe(false);
    expect(isSlotSelector('div-0 slot-0')).toBe(false);
    expect(isSlotSelector(null)).toBe(false);
  });

  it('isLayoutSlotKey matches ANY page\'s chrome slot child, and nothing else', () => {
    expect(isLayoutSlotKey('layoutchrome-page-1:slot-0')).toBe(true);
    expect(isLayoutSlotKey('layoutchrome-other:slot-3')).toBe(true);
    // Root, non-slot children, and non-chrome keys stay out.
    expect(isLayoutSlotKey('layoutchrome-page-1')).toBe(false);
    expect(isLayoutSlotKey('layoutchrome-page-1:header-0')).toBe(false);
    expect(isLayoutSlotKey('layoutchrome-page-1:slot-0:div-1')).toBe(false);
    expect(isLayoutSlotKey('el-x:slot-0')).toBe(false);
    expect(isLayoutSlotKey(null)).toBe(false);
  });
});
