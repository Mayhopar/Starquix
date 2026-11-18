import { describe, it, expect } from 'vitest';
import { isPageWrapperKey } from '../pageWrapperKey';

describe('isPageWrapperKey', () => {
  it('matches the #sq-components / [pageId].astro infrastructure wrapper key', () => {
    expect(isPageWrapperKey('src/pages/preview/[projectId]/[pageId].astro:17:29')).toBe(true);
  });

  it('does not match real element / instance-child keys', () => {
    expect(isPageWrapperKey('el-123:slot-0')).toBe(false);
    expect(isPageWrapperKey('library/Hero.astro:5:1')).toBe(false);
    expect(isPageWrapperKey('layoutchrome-page-1')).toBe(false);
    expect(isPageWrapperKey(null)).toBe(false);
    expect(isPageWrapperKey(undefined)).toBe(false);
  });
});
