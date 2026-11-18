/**
 * Regression: "Choose Component" overlay must NOT render on literal <slot>
 * tags inside a COMPONENT instance's markup (e.g. a bound BlogSlot's
 * <slot name="posts"><BlogCard/></slot> / <slot name="pagination"/>).
 * composeSlotChildren leaves unfilled slots literal (selectors.ts), so the
 * scan reports tagName='slot' with keys `el-…:slot-N`. A bound BlogSlot
 * renders posts via the blog pipeline, not Yjs children, so the owner never
 * appears in filledLayoutInstanceMap — the old filter treated it as an empty
 * LAYOUT slot and drew the overlay on top of the card.
 *
 * Only layout-chrome slots (`layoutchrome-<pageId>:slot-N`, see
 * pageLayoutElementId in store/layoutElement.ts and selectors.ts:949) are
 * fillable page slots.
 */
import { describe, it, expect } from 'vitest';
import { computeLayoutSlotElements } from '../ViewportFrame';

describe('computeLayoutSlotElements', () => {
  it('excludes <slot> tags owned by a component instance (bound BlogSlot, no Yjs children)', () => {
    const scanned = [
      { key: 'el-1783009245879-79oegph:slot-0', tagName: 'slot' },
      { key: 'el-1783009245879-79oegph:slot-1', tagName: 'slot' },
    ];
    expect(computeLayoutSlotElements(scanned, {})).toEqual([]);
  });

  it('includes an empty layout-chrome slot', () => {
    const scanned = [{ key: 'layoutchrome-page-1:slot-0', tagName: 'slot' }];
    expect(computeLayoutSlotElements(scanned, {})).toEqual([
      { key: 'layoutchrome-page-1:slot-0', slotType: 'layout' },
    ]);
  });

  it('excludes a filled layout-chrome slot', () => {
    const scanned = [{ key: 'layoutchrome-page-1:slot-0', tagName: 'slot' }];
    expect(
      computeLayoutSlotElements(scanned, { 'layoutchrome-page-1': true }),
    ).toEqual([]);
  });

  it('ignores non-slot scanned elements', () => {
    const scanned = [{ key: 'layoutchrome-page-1:div-0', tagName: 'div' }];
    expect(computeLayoutSlotElements(scanned, {})).toEqual([]);
  });
});
