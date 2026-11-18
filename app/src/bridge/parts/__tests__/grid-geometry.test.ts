/**
 * REQUEST_GRID_GEOMETRY container choice (task-090 review).
 *
 * Every host sender passes the SELECTED element's key and wants "the grid
 * this element participates in as a child" (resize cellInfo lookup, drag
 * isGridDrop gate, DesignBar selected-cell store all do
 * `cells.find(c => c.key === selectedKey)`). The old element-itself-first
 * check returned the child's OWN grid whenever the selected child was also
 * a grid container — its cells were the grandchildren, every lookup missed,
 * and the Start/Span fallback + grid drag silently broke for grid-in-grid.
 *
 * New contract: nearest grid ANCESTOR first; the element's own grid only as
 * a fallback when no ancestor grid exists.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BRIDGE_HEAD_CONSTANTS } from '../head';
import { BRIDGE_UTILS } from '../utils';
import { BRIDGE_GEOMETRY } from '../geometry';

type GeoBridge = {
  sendToParent: ReturnType<typeof vi.fn>;
  handleRequestGridGeometry: (payload: { key: string }) => void;
};

function mountGeoBridge(): GeoBridge {
  function IFrameBridge(this: GeoBridge) {
    this.sendToParent = vi.fn();
  }
  const src = `${BRIDGE_HEAD_CONSTANTS}\n${BRIDGE_UTILS}\n${BRIDGE_GEOMETRY}`;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  new Function('IFrameBridge', src)(IFrameBridge);
  return new (IFrameBridge as unknown as { new (): GeoBridge })();
}

/** jsdom has no layout engine — force display via inline style + computedStyle stub. */
function stubDisplay(el: HTMLElement, display: string) {
  el.style.display = display;
}

const responseCells = (bridge: GeoBridge): string[] => {
  const call = bridge.sendToParent.mock.calls.find(
    (c) => (c[0] as { type: string }).type === 'GRID_GEOMETRY_RESPONSE',
  );
  if (!call) return [];
  return ((call[0] as { payload: { cells: Array<{ key: string }> } }).payload.cells).map((c) => c.key);
};

describe('handleRequestGridGeometry container choice', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('grid-in-grid: returns the PARENT grid, whose cells include the selected child', () => {
    document.body.innerHTML = `
      <div id="parent" data-key="parent-grid">
        <div id="child" data-key="child-card">
          <div data-key="grandchild-a"></div>
          <div data-key="grandchild-b"></div>
        </div>
        <div data-key="sibling"></div>
      </div>`;
    stubDisplay(document.getElementById('parent')!, 'grid');
    stubDisplay(document.getElementById('child')!, 'grid'); // the selected child is ITSELF a grid

    const bridge = mountGeoBridge();
    bridge.handleRequestGridGeometry({ key: 'child-card' });

    const keys = responseCells(bridge);
    expect(keys).toContain('child-card');
    expect(keys).toContain('sibling');
    expect(keys).not.toContain('grandchild-a');
  });

  it('falls back to the element\'s own grid when no ancestor grid exists', () => {
    document.body.innerHTML = `
      <div id="standalone" data-key="standalone-grid">
        <div data-key="cell-a"></div>
        <div data-key="cell-b"></div>
      </div>`;
    stubDisplay(document.getElementById('standalone')!, 'grid');

    const bridge = mountGeoBridge();
    bridge.handleRequestGridGeometry({ key: 'standalone-grid' });

    const keys = responseCells(bridge);
    expect(keys).toEqual(['cell-a', 'cell-b']);
  });

  it('plain grid child still resolves its parent grid', () => {
    document.body.innerHTML = `
      <div id="parent" data-key="parent-grid">
        <div data-key="plain-child"></div>
        <div data-key="other-child"></div>
      </div>`;
    stubDisplay(document.getElementById('parent')!, 'grid');

    const bridge = mountGeoBridge();
    bridge.handleRequestGridGeometry({ key: 'plain-child' });

    expect(responseCells(bridge)).toEqual(['plain-child', 'other-child']);
  });
});

/**
 * Owner 2026-11-12: "grid behaviour is very buggy … especially in the ul→li
 * structure." Proven live on a gapless 3-column `ul`: every auto-placed card
 * was reported one track back (card 2 in column 1, the whole second row in
 * row 1), so the drag swapped the wrong neighbour and two cards ended in one
 * cell, and the panel showed the wrong Start.
 *
 * A child placed by auto-flow has no numeric grid-column-start, so its track
 * is read from its box. The old test "left edge inside this track, +1px" is
 * true for the PREVIOUS track whenever the gap is under a pixel (the next
 * track starts where this one ends), and false for every track when computed
 * sizes serialize rounded up.
 */
describe('auto-placed children report the track they render in', () => {
  const box = (left: number, top: number, width: number, height: number) =>
    () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;

  function mountGrid(columns: number[], rows: number[], gap: number, tracksAsReported = columns) {
    document.body.innerHTML = '<ul id="g" data-key="g"></ul>';
    const grid = document.getElementById('g')!;
    const styles = new Map<Element, Record<string, string>>();
    const width = columns.reduce((a, b) => a + b, 0) + gap * (columns.length - 1);
    const height = rows.reduce((a, b) => a + b, 0) + gap * (rows.length - 1);
    styles.set(grid, {
      display: 'grid', paddingTop: '0px', paddingLeft: '0px', paddingRight: '0px', paddingBottom: '0px',
      gridTemplateColumns: tracksAsReported.map((c) => `${c}px`).join(' '), gridTemplateRows: rows.map((r) => `${r}px`).join(' '),
      columnGap: `${gap}px`, rowGap: `${gap}px`,
    });
    grid.getBoundingClientRect = box(0, 0, width, height);
    let top = 0;
    rows.forEach((rowHeight, r) => {
      let left = 0;
      columns.forEach((colWidth, c) => {
        const li = document.createElement('li');
        li.setAttribute('data-key', `r${r}c${c}`);
        li.getBoundingClientRect = box(left, top, colWidth, rowHeight);
        grid.appendChild(li);
        left += colWidth + gap;
      });
      top += rowHeight + gap;
    });
    const auto = { display: 'block', gridColumnStart: 'auto', gridColumnEnd: 'auto', gridRowStart: 'auto', gridRowEnd: 'auto' };
    vi.spyOn(window, 'getComputedStyle').mockImplementation(
      (el: Element) => ({ ...auto, ...styles.get(el) }) as unknown as CSSStyleDeclaration,
    );
    const bridge = mountGeoBridge();
    bridge.handleRequestGridGeometry({ key: 'r0c0' });
    const call = bridge.sendToParent.mock.calls.find((c) => (c[0] as { type: string }).type === 'GRID_GEOMETRY_RESPONSE')!;
    const cells = (call[0] as { payload: { cells: Array<{ key: string; col: number; row: number }> } }).payload.cells;
    vi.restoreAllMocks();
    return cells.map((c) => `${c.key}=r${c.row}c${c.col}`);
  }
  const everyCellInItsOwnTrack = (cells: string[]) => cells.every((c) => { const [key, at] = c.split('='); return key === at; });

  it('a gapless grid: the next track starts where this one ends', () => {
    const cells = mountGrid([100, 100, 100], [50, 50], 0);
    expect(cells).toEqual(['r0c0=r0c0', 'r0c1=r0c1', 'r0c2=r0c2', 'r1c0=r1c0', 'r1c1=r1c1', 'r1c2=r1c2']);
  });

  it('a 1px gap with track sizes serialized rounded up (388.671875px reads "388.672px")', () => {
    expect(everyCellInItsOwnTrack(mountGrid([388.671875, 388.671875, 388.671875], [113.19531, 113.19531], 1, [388.672, 388.672, 388.672]))).toBe(true);
  });

  it('a wide gap with track sizes serialized rounded up', () => {
    expect(everyCellInItsOwnTrack(mountGrid([388.671875, 388.671875, 388.671875], [113.19531, 113.19531], 16, [388.672, 388.672, 388.672]))).toBe(true);
  });
});
