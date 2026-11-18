import { describe, it, expect } from 'vitest';
import { isValidChildOrderParentKey } from '../dispatchSetChildOrder';

describe('isValidChildOrderParentKey', () => {
  it('accepts instance-root keys', () => {
    expect(isValidChildOrderParentKey('el-abc123')).toBe(true);
  });

  it('accepts instance-child keys', () => {
    expect(isValidChildOrderParentKey('el-abc123:section-0')).toBe(true);
  });

  it('rejects source-location keys (page wrapper)', () => {
    expect(
      isValidChildOrderParentKey('src/pages/preview/[projectId]/[pageId].astro:17:29'),
    ).toBe(false);
  });

  it('rejects source-location keys (component file)', () => {
    expect(isValidChildOrderParentKey('src/components/Hero.astro:5:1')).toBe(false);
  });

  it('rejects null / undefined / empty', () => {
    expect(isValidChildOrderParentKey(null)).toBe(false);
    expect(isValidChildOrderParentKey(undefined)).toBe(false);
    expect(isValidChildOrderParentKey('')).toBe(false);
  });
});
