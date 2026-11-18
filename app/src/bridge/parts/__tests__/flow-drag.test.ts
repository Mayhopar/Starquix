/**
 * FlowDragManager mode-switch tests.
 *
 * Grid children get a REVERSIBLE container-bounds mode: leaving the original
 * parent's rect enters reparent mode (DRAG_MODE_CHANGED {mode:'reparent'}),
 * re-entering flips back to reorder (DRAG_MODE_CHANGED {mode:'grid'}).
 * Instantiates the REAL shipped part string — not a lookalike.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BRIDGE_UTILS } from '../utils';
import { BRIDGE_FLOW_DRAG } from '../flow-drag';

// BRIDGE_UTILS attaches methods to IFrameBridge.prototype — give it a stand-in.
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const FlowDragManager = new Function(
  `function IFrameBridge() {}; ${BRIDGE_UTILS}; ${BRIDGE_FLOW_DRAG}; return FlowDragManager;`,
)();

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };

function stubRect(el: Element, r: { left: number; top: number; right: number; bottom: number }): void {
  const rect: Rect = { ...r, width: r.right - r.left, height: r.bottom - r.top };
  (el as HTMLElement).getBoundingClientRect = () => rect as DOMRect;
}

describe('FlowDragManager grid mode switch', () => {
  let manager: InstanceType<typeof FlowDragManager>;
  let sendToParent: ReturnType<typeof vi.fn>;
  let grid: HTMLElement;
  let child: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    // Grid section (original parent) — key deliberately NOT instance-child-shaped
    // so it passes the _scanContainers key filter and can be a drop-back target.
    grid = document.createElement('section');
    grid.setAttribute('data-key', 'grid-root');
    grid.style.display = 'grid';
    document.body.appendChild(grid);

    child = document.createElement('div');
    child.setAttribute('data-key', 'el-a:div-0');
    grid.appendChild(child);
    const sibling = document.createElement('div');
    sibling.setAttribute('data-key', 'el-a:div-3');
    grid.appendChild(sibling);

    // A separate drop container elsewhere on the page
    const other = document.createElement('div');
    other.setAttribute('data-key', 'other-container');
    document.body.appendChild(other);

    stubRect(grid, { left: 0, top: 0, right: 600, bottom: 400 });
    stubRect(child, { left: 0, top: 0, right: 300, bottom: 400 });
    stubRect(sibling, { left: 300, top: 0, right: 600, bottom: 400 });
    stubRect(other, { left: 700, top: 0, right: 900, bottom: 400 });

    sendToParent = vi.fn();
    manager = new FlowDragManager({
      findElementByKey: (k: string) => document.querySelector(`[data-key="${k}"]`),
      isEditorNode: (n: Element) => n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')),
      sendToParent,
    });
    manager.handleStart({ key: 'el-a:div-0', iframeX: 50, iframeY: 50 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function modeChanges(): string[] {
    return sendToParent.mock.calls
      .filter((c) => c[0].type === 'DRAG_MODE_CHANGED')
      .map((c) => c[0].payload.mode);
  }

  it('does not flip to reparent on large cross-axis movement INSIDE the grid parent', () => {
    manager.handleMove({ iframeX: 60, iframeY: 350 }); // big Y delta, still inside parent rect
    expect(manager._state.mode).toBe('reorder');
    expect(modeChanges()).not.toContain('reparent');
  });

  it('flips to reparent when leaving the parent rect and notifies the host', () => {
    manager.handleMove({ iframeX: 60, iframeY: 500 }); // below parent bottom
    expect(manager._state.mode).toBe('reparent');
    expect(sendToParent).toHaveBeenCalledWith({
      type: 'DRAG_MODE_CHANGED', payload: { mode: 'reparent' },
    });
  });

  it('flips back to reorder when re-entering the parent rect (reversible)', () => {
    manager.handleMove({ iframeX: 60, iframeY: 500 });
    expect(manager._state.mode).toBe('reparent');
    manager.handleMove({ iframeX: 60, iframeY: 200 }); // back inside
    expect(manager._state.mode).toBe('reorder');
    expect(modeChanges()).toEqual(['reparent', 'grid']);
  });

  it('clears a sticky reparent target when no container is under the cursor', () => {
    manager.handleMove({ iframeX: 800, iframeY: 200 }); // exits parent, hovers other-container
    expect(manager._reparentTarget?.containerKey).toBe('other-container');
    manager.handleMove({ iframeX: 1200, iframeY: 600 }); // no container here
    expect(manager._reparentTarget).toBeNull();
  });

  it('includes the original parent in _scanContainers (drop-back target)', () => {
    const keys = manager._scanContainers().map((c: { key: string }) => c.key);
    expect(keys).toContain('grid-root');
  });

  it('drop-back onto the original parent ends as a plain reorder, not a reparent', () => {
    manager.handleMove({ iframeX: 60, iframeY: 500 }); // enter reparent mode
    manager._reparentTarget = { containerKey: 'grid-root', insertIndex: 1 };
    manager.handleEnd();
    const drop = sendToParent.mock.calls.find((c) => c[0].type === 'DRAG_ELEMENT_DROP')![0];
    expect(drop.payload.reparented).toBe(false);
    expect(drop.payload.newParentKey).toBe('grid-root');
    expect(drop.payload.insertIndex).toBe(1);
  });
});
