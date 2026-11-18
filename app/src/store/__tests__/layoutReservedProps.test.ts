import { describe, it, expect } from 'vitest';
import { LAYOUT_SEO_RESERVED_PROPS, isReservedLayoutProp } from '../layoutReservedProps';

describe('LAYOUT_SEO_RESERVED_PROPS', () => {
  it('reserves title and description (these are owned by page.seo)', () => {
    expect(isReservedLayoutProp('title')).toBe(true);
    expect(isReservedLayoutProp('description')).toBe(true);
  });
  it('does not reserve arbitrary layout props', () => {
    expect(isReservedLayoutProp('variant')).toBe(false);
    expect(isReservedLayoutProp('showSidebar')).toBe(false);
  });
  it('exposes the reserved set', () => {
    expect(LAYOUT_SEO_RESERVED_PROPS.has('title')).toBe(true);
  });
});
