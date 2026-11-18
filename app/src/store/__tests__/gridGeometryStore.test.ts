import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSelectedCellGeometry,
  clearSelectedCellGeometry,
  subscribeSelectedCellGeometry,
  getSelectedCellGeometrySnapshot,
  selectedCellFor,
} from '../gridGeometryStore';

const cell = { key: 'el-1:div-0', breakpoint: 'base', start: 1, span: 6, rowStart: 1, rowSpan: 1, parentCols: 12, parentRows: 0 };

describe('gridGeometryStore', () => {
  beforeEach(() => clearSelectedCellGeometry());

  it('starts null', () => {
    expect(getSelectedCellGeometrySnapshot()).toBeNull();
  });

  it('publishes and reads back the selected cell', () => {
    setSelectedCellGeometry(cell);
    expect(getSelectedCellGeometrySnapshot()).toEqual(cell);
  });

  it('clear resets to null', () => {
    setSelectedCellGeometry(cell);
    clearSelectedCellGeometry();
    expect(getSelectedCellGeometrySnapshot()).toBeNull();
  });

  it('notifies subscribers on change', () => {
    let hits = 0;
    const unsub = subscribeSelectedCellGeometry(() => { hits++; });
    setSelectedCellGeometry(cell);
    setSelectedCellGeometry(null);
    unsub();
    setSelectedCellGeometry(cell); // after unsubscribe, no more hits
    expect(hits).toBe(2);
  });

  it('snapshot is stable until changed (reference equality)', () => {
    setSelectedCellGeometry(cell);
    const a = getSelectedCellGeometrySnapshot();
    const b = getSelectedCellGeometrySnapshot();
    expect(a).toBe(b);
  });

  // task-090 review: geometry has no identity → a Layers-panel selection
  // showed the PREVIOUS element's cell and clamped edits to the previous
  // grid's track count. The cell is now stamped with the element key and
  // frame breakpoint; consumers gate on both.
  describe('selectedCellFor (staleness gate)', () => {
    it('returns the cell only for the matching element key', () => {
      setSelectedCellGeometry(cell);
      expect(selectedCellFor('el-1:div-0', 'base')).toEqual(cell);
      expect(selectedCellFor('el-OTHER:div-0', 'base')).toBeNull();
    });

    it('returns null when the DesignBar breakpoint differs from the frame that measured', () => {
      setSelectedCellGeometry(cell);
      expect(selectedCellFor('el-1:div-0', 'md')).toBeNull();
    });

    it('returns null for null state or null key', () => {
      expect(selectedCellFor('el-1:div-0', 'base')).toBeNull();
      setSelectedCellGeometry(cell);
      expect(selectedCellFor(null, 'base')).toBeNull();
    });
  });

  it('notify skip compares key and breakpoint too', () => {
    let hits = 0;
    const unsub = subscribeSelectedCellGeometry(() => { hits++; });
    setSelectedCellGeometry(cell);
    setSelectedCellGeometry({ ...cell }); // identical → skipped
    setSelectedCellGeometry({ ...cell, key: 'el-2:div-0' }); // new key → notify
    setSelectedCellGeometry({ ...cell, key: 'el-2:div-0', breakpoint: 'md' }); // new bp → notify
    unsub();
    expect(hits).toBe(3);
  });
});
