/**
 * Flow-drag reorder — owner UX 2026-11-11 (flexbox-style; replaces the
 * 2026-11-08 drop line for same-parent drags). A ghost follows the cursor; a
 * dimmed inert COPY of the element holds its slot and moves live between the
 * siblings (top half of a hovered sibling = slot above it, bottom half =
 * below). The real element stays hidden at its original spot so a mid-drag
 * rescan keeps the true order; it moves ONCE on drop.
 *
 * Instantiates the REAL shipped part string — not a lookalike.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BRIDGE_UTILS } from '../utils';
import { BRIDGE_FLOW_DRAG } from '../flow-drag';

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const FlowDragManager = new Function(
  `function IFrameBridge() {}; ${BRIDGE_UTILS}; ${BRIDGE_FLOW_DRAG}; return FlowDragManager;`,
)();

type Rect = { left: number; top: number; right: number; bottom: number };

function stubRect(el: Element, r: Rect): { count: () => number } {
  let calls = 0;
  const rect = { ...r, width: r.right - r.left, height: r.bottom - r.top };
  (el as HTMLElement).getBoundingClientRect = () => {
    calls++;
    return rect as DOMRect;
  };
  return { count: () => calls };
}

const keys = (parent: Element) => Array.from(parent.children).map((el) => el.getAttribute('data-key'));
const slot = () => document.querySelector('[data-drag-ghost]:not([style*="fixed"])') as HTMLElement | null;
const realKeys = (parent: Element) => Array.from(parent.children).filter((el) => !el.hasAttribute('data-drag-ghost')).map((el) => el.getAttribute('data-key'));
const slotIndex = (parent: Element) => Array.from(parent.children).indexOf(slot()!);

describe('flow reorder with a live slot', () => {
  let manager: InstanceType<typeof FlowDragManager>;
  let sendToParent: ReturnType<typeof vi.fn>;
  let parent: HTMLElement;
  let a: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('section');
    parent.setAttribute('data-key', 'parent-root');
    parent.style.display = 'block'; // vertical axis
    document.body.appendChild(parent);

    a = document.createElement('div'); a.setAttribute('data-key', 'el-a');
    a.innerHTML = '<h2 data-key="el-a-h" id="title">A</h2>';
    const b = document.createElement('div'); b.setAttribute('data-key', 'el-b');
    const c = document.createElement('div'); c.setAttribute('data-key', 'el-c');
    parent.append(a, b, c);

    stubRect(parent, { left: 0, top: 0, right: 600, bottom: 900 });
    stubRect(a, { left: 0, top: 0, right: 600, bottom: 300 });
    stubRect(b, { left: 0, top: 300, right: 600, bottom: 600 });
    stubRect(c, { left: 0, top: 600, right: 600, bottom: 900 });

    sendToParent = vi.fn();
    manager = new FlowDragManager({
      findElementByKey: (k: string) => document.querySelector(`[data-key="${k}"]`),
      isEditorNode: (n: Element) => n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')),
      sendToParent,
    });
    manager.handleStart({ key: 'el-a', iframeX: 100, iframeY: 100 });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const drop = () => sendToParent.mock.calls.find((call) => call[0].type === 'DRAG_ELEMENT_DROP')![0].payload;

  it('hovering the bottom half of a sibling moves the dimmed slot below it, live', () => {
    manager.handleMove({ iframeX: 100, iframeY: 500 }); // bottom half of B
    expect(slotIndex(parent)).toBe(2); // [A(hidden), B, slot, C]
    expect(slot()!.style.opacity).toBe('0.3');
    expect(a.style.display).toBe('none');
    expect(realKeys(parent)).toEqual(['el-a', 'el-b', 'el-c']); // the real order is untouched mid-drag
    expect(document.querySelector('[data-sq-drop-line]')).toBeNull();
    manager.handleEnd();
    expect(keys(parent)).toEqual(['el-b', 'el-a', 'el-c']);
    expect(slot()).toBeNull();
    expect(a.style.display).toBe('');
    expect(drop()).toMatchObject({ insertIndex: 1, reparented: false, newParentKey: 'parent-root' });
  });

  it('hovering the top half of a sibling moves the slot above it', () => {
    manager.handleMove({ iframeX: 100, iframeY: 850 }); // bottom half of C → end
    expect(slotIndex(parent)).toBe(3);
    manager.handleMove({ iframeX: 100, iframeY: 650 }); // top half of C → before C
    expect(slotIndex(parent)).toBe(2); // [A(hidden), B, slot, C]
    manager.handleEnd();
    expect(keys(parent)).toEqual(['el-b', 'el-a', 'el-c']);
  });

  it('its own slot drops as a no-op', () => {
    manager.handleMove({ iframeX: 100, iframeY: 850 });
    manager.handleMove({ iframeX: 100, iframeY: 310 }); // top half of B = where A already is
    manager.handleEnd();
    expect(keys(parent)).toEqual(['el-a', 'el-b', 'el-c']);
    expect(drop().insertIndex).toBe(0);
  });

  it('the slot copy is pure chrome: no keys or ids anywhere inside', () => {
    manager.handleMove({ iframeX: 100, iframeY: 500 });
    const copy = slot()!;
    expect(copy.hasAttribute('data-key')).toBe(false);
    expect(copy.querySelector('[data-key], [data-sq-source], [id]')).toBeNull();
    expect(document.querySelectorAll('[data-key="el-a-h"]')).toHaveLength(1);
    manager.handleEnd();
  });

  it('cancel leaves the order untouched and removes the slot', () => {
    manager.handleMove({ iframeX: 100, iframeY: 850 });
    manager.handleCancel();
    expect(Array.from(parent.children).map((el) => el.getAttribute('data-key'))).toEqual(['el-a', 'el-b', 'el-c']);
    expect(slot()).toBeNull();
    expect(a.style.display).toBe('');
    expect(a.style.opacity).toBe('');
  });
});

describe('siblings with no box are not drop targets (audit #27: a hidden md:block child)', () => {
  let sendToParent: ReturnType<typeof vi.fn>;
  afterEach(() => { document.body.innerHTML = ''; });

  /** A vertical stack of 300px-tall <p>s; HIDDEN measures like display:none (all zeros). */
  function mount(order: string[], parentKey = 'p', left = 0, width = 600) {
    const parent = document.createElement('section');
    parent.setAttribute('data-key', parentKey);
    document.body.appendChild(parent);
    let top = 0;
    for (const name of order) {
      const el = document.createElement('p');
      el.setAttribute('data-key', name);
      parent.appendChild(el);
      if (name.endsWith('HIDDEN')) { el.style.display = 'none'; stubRect(el, { left: 0, top: 0, right: 0, bottom: 0 }); }
      else { stubRect(el, { left, top, right: left + width, bottom: top + 300 }); top += 300; }
    }
    stubRect(parent, { left, top: 0, right: left + width, bottom: top });
    return parent;
  }
  function manager() {
    sendToParent = vi.fn();
    return new FlowDragManager({
      findElementByKey: (k: string) => document.querySelector(`[data-key="${k}"]`),
      isEditorNode: (n: Element) => n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')),
      sendToParent,
    });
  }
  const drop = () => sendToParent.mock.calls.find((call) => call[0].type === 'DRAG_ELEMENT_DROP')![0].payload;

  it('a hidden first child: the slot lands between the visible siblings, index in file order', () => {
    const parent = mount(['HIDDEN', 'X1', 'X2', 'X3']);
    const m = manager();
    m.handleStart({ key: 'X3', iframeX: 100, iframeY: 750 });
    m.handleMove({ iframeX: 100, iframeY: 340 }); // top half of X2
    m.handleEnd();
    expect(keys(parent)).toEqual(['HIDDEN', 'X1', 'X3', 'X2']);
    expect(drop()).toMatchObject({ insertIndex: 2, reparented: false });
  });

  it('a hidden middle child: an element can still be dropped below it', () => {
    const parent = mount(['X1', 'HIDDEN', 'X2', 'X3']);
    const m = manager();
    m.handleStart({ key: 'X1', iframeX: 100, iframeY: 100 });
    m.handleMove({ iframeX: 100, iframeY: 800 }); // bottom half of X3
    m.handleEnd();
    expect(keys(parent)).toEqual(['HIDDEN', 'X2', 'X3', 'X1']);
    expect(drop()).toMatchObject({ insertIndex: 3 });
  });

  it('wiggling the only visible child never moves it across hidden ones', () => {
    const parent = mount(['X1', 'HIDDEN']);
    const m = manager();
    m.handleStart({ key: 'X1', iframeX: 100, iframeY: 100 });
    m.handleMove({ iframeX: 100, iframeY: 250 });
    m.handleEnd();
    expect(keys(parent)).toEqual(['X1', 'HIDDEN']);
    expect(drop().insertIndex).toBe(0);
  });

  it('a drop into another container reports the slot in that container’s file order', () => {
    mount(['X1', 'X2'], 'p', 0, 300);
    mount(['Q-HIDDEN', 'Q1', 'Q2'], 'q', 700); // wider than the dragged element: a drop container
    const m = manager();
    m.handleStart({ key: 'X1', iframeX: 100, iframeY: 100 });
    m.handleMove({ iframeX: 900, iframeY: 340 }); // over q, top half of Q2
    m.handleEnd();
    expect(drop()).toMatchObject({ newParentKey: 'q', insertIndex: 2, reparented: true });
  });
});
