/**
 * Reordering rows in a layout/component MASTER used to reach only the doc:
 * the rows' scanned parent is the preview shell (a `source` key that
 * SET_CHILD_ORDER rejects), so the drag fell through to the doc's root list,
 * which no writer mirrors to the .astro. Reopening the master re-seeded from
 * the file and the moved row snapped back to file order.
 */
import { describe, it, expect } from 'vitest';
import { sharedInstanceRoot } from '../dispatchSetChildOrder';

describe('sharedInstanceRoot', () => {
  it('returns the host when every row is a child of one opened document', () => {
    expect(sharedInstanceRoot(['el-1:header-0', 'el-1:slot-0'])).toBe('el-1');
  });

  it('returns null for page roots (instance ROOTS keep the doc-root path)', () => {
    expect(sharedInstanceRoot(['el-1', 'el-2'])).toBeNull();
  });

  it('returns null when rows belong to different hosts', () => {
    expect(sharedInstanceRoot(['el-1:slot-0', 'el-2:header-0'])).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(sharedInstanceRoot([])).toBeNull();
  });
});
