/**
 * Canvas section reorder (owner 2026-11-10, log-proven): a hand drag of a
 * full-width section drifts sideways, the >50px cross-axis drift flips the
 * drag into reparent mode, and the deepest container under the pointer — the
 * SIBLING section — swallowed the drop: Gamma landed nested inside Alpha.
 * A container no larger than the dragged element across the stack is not a
 * nest target: dropping there means before/after it. Nesting into a container
 * the element fits in still works.
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

// Like a browser: a display:none element measures 0×0 (the dragged element
// hides while its slot copy is in the flow).
function stubRect(el: Element, r: Rect): void {
  const rect = { ...r, width: r.right - r.left, height: r.bottom - r.top };
  const none = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  (el as HTMLElement).getBoundingClientRect = () => ((el as HTMLElement).style.display === 'none' ? none : rect) as DOMRect;
}

function add(parent: Element, tag: string, key: string, r: Rect): HTMLElement {
  const el = document.createElement(tag);
  el.setAttribute('data-key', key);
  parent.appendChild(el);
  stubRect(el, r);
  return el;
}

describe('canvas section drag', () => {
  let manager: InstanceType<typeof FlowDragManager>;
  let sendToParent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = '';
    const main = add(document.body, 'main', 'page:5:3', { left: 0, top: 0, right: 1000, bottom: 900 });
    const alpha = add(main, 'section', 'page:6:5', { left: 0, top: 0, right: 1000, bottom: 300 });
    add(alpha, 'div', 'page:7:7', { left: 100, top: 100, right: 900, bottom: 200 });
    const beta = add(main, 'section', 'page:12:5', { left: 0, top: 300, right: 1000, bottom: 600 });
    add(beta, 'div', 'page:13:7', { left: 100, top: 400, right: 900, bottom: 500 });
    add(main, 'section', 'page:18:5', { left: 0, top: 600, right: 1000, bottom: 900 });

    sendToParent = vi.fn();
    manager = new FlowDragManager({
      findElementByKey: (k: string) => document.querySelector(`[data-key="${k}"]`),
      isEditorNode: (n: Element) => n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')),
      sendToParent,
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const drop = () => sendToParent.mock.calls.find((c) => c[0].type === 'DRAG_ELEMENT_DROP')![0].payload;

  it('a sideways-drifting drag of a section onto a sibling section reorders, never nests', () => {
    manager.handleStart({ key: 'page:18:5', iframeX: 40, iframeY: 630 });
    // Hand drift: 80px sideways on the way up (crosses the 50px reparent threshold).
    const modes = new Set<string>();
    for (let y = 610, x = 40; y >= 20; y -= 30, x += 4) {
      manager.handleMove({ iframeX: x, iframeY: y });
      modes.add(manager._state.mode);
    }
    // A live reorder the whole way — never a flicker into reparent mode (the
    // hidden element once measured 0 wide, so every sibling looked bigger).
    expect([...modes]).toEqual(['reorder']);
    manager.handleMove({ iframeX: 120, iframeY: 150 }); // over Alpha's inner div
    manager.handleMove({ iframeX: 120, iframeY: 20 }); // top of Alpha
    manager.handleEnd();
    expect(drop()).toMatchObject({ key: 'page:18:5', newParentKey: 'page:5:3', insertIndex: 0, reparented: false });
  });

  it('dropping mid-way over a sibling section still lands before/after it', () => {
    manager.handleStart({ key: 'page:6:5', iframeX: 40, iframeY: 30 });
    manager.handleMove({ iframeX: 200, iframeY: 450 }); // drift + over Beta's inner div
    manager.handleMove({ iframeX: 200, iframeY: 590 }); // lower half of Beta
    manager.handleEnd();
    expect(drop()).toMatchObject({ key: 'page:6:5', newParentKey: 'page:5:3', insertIndex: 1, reparented: false });
  });

  it('sections directly in <body> reorder on a drifting drag (no snap-back)', () => {
    // Owner project 2026-11-11: <body><HeroClassic /><Hero4 />…</body> — the
    // container scan starts BELOW <body>, so with no other target the drop
    // sent the original index and the hero snapped back.
    document.body.innerHTML = '';
    document.body.setAttribute('data-key', 'index:16:3');
    stubRect(document.body, { left: 0, top: 0, right: 1000, bottom: 900 });
    add(document.body, 'section', 'hero-classic:8:1', { left: 0, top: 0, right: 1000, bottom: 300 });
    add(document.body, 'section', 'hero4:8:1', { left: 0, top: 300, right: 1000, bottom: 600 });
    manager.handleStart({ key: 'hero4:8:1', iframeX: 20, iframeY: 310 });
    manager.handleMove({ iframeX: 100, iframeY: 200 }); // 80px drift → reparent mode
    manager.handleMove({ iframeX: 100, iframeY: 20 }); // top of HeroClassic
    manager.handleEnd();
    document.body.removeAttribute('data-key');
    expect(drop()).toMatchObject({ key: 'hero4:8:1', newParentKey: 'index:16:3', insertIndex: 0, reparented: false });
  });

  it('a smaller element still nests into a container it fits in', () => {
    const main = document.querySelector('main')!;
    add(main, 'div', 'page:24:5', { left: 0, top: 900, right: 200, bottom: 960 }); // a small card
    manager.handleStart({ key: 'page:24:5', iframeX: 20, iframeY: 920 });
    manager.handleMove({ iframeX: 300, iframeY: 450 }); // into Beta's inner div
    manager.handleEnd();
    expect(drop()).toMatchObject({ key: 'page:24:5', newParentKey: 'page:13:7', reparented: true });
  });
});

/**
 * Owner 2026-11-12 ("grid behaviour is very buggy"), proven live: on a phone
 * canvas a responsive list is ONE column (grid-cols-1 md:grid-cols-2
 * lg:grid-cols-3). Dragging a card there pinned it — col-start-1 row-start-3
 * on the base layer — and the pin followed it to every wider breakpoint, where
 * the card sat alone on a third row. A one-column grid is a stack: its
 * children reorder like any stack's.
 */
describe('a one-column grid is a stack', () => {
  let manager: InstanceType<typeof FlowDragManager>;
  let sendToParent: ReturnType<typeof vi.fn>;
  let list: HTMLElement;

  function mount(columns: string) {
    document.body.innerHTML = '';
    list = add(document.body, 'ul', 'page:5:1', { left: 0, top: 0, right: 300, bottom: 300 });
    add(list, 'li', 'page:6:1', { left: 0, top: 0, right: 300, bottom: 100 });
    add(list, 'li', 'page:7:1', { left: 0, top: 100, right: 300, bottom: 200 });
    add(list, 'li', 'page:8:1', { left: 0, top: 200, right: 300, bottom: 300 });
    const real = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) =>
      (el === list ? { display: 'grid', gridTemplateColumns: columns, gridAutoFlow: 'row' } : real(el)) as CSSStyleDeclaration);
    sendToParent = vi.fn();
    manager = new FlowDragManager({
      findElementByKey: (k: string) => document.querySelector(`[data-key="${k}"]`),
      isEditorNode: (n: Element) => n.nodeType === 1 && (n.hasAttribute('data-drag-ghost') || n.hasAttribute('data-sq-drop-line')),
      sendToParent,
    });
  }
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });
  const drop = () => sendToParent.mock.calls.find((c) => c[0].type === 'DRAG_ELEMENT_DROP')![0].payload;

  it('dragging the first card below the last one reorders the list', () => {
    mount('300px');
    manager.handleStart({ key: 'page:6:1', iframeX: 150, iframeY: 50 });
    expect(sendToParent).toHaveBeenCalledWith({ type: 'DRAG_MODE_CHANGED', payload: { mode: 'flow' } }); // the host follows this
    manager.handleMove({ iframeX: 150, iframeY: 280 }); // lower half of the third card
    manager.handleEnd();
    expect(drop()).toMatchObject({ key: 'page:6:1', newParentKey: 'page:5:1', insertIndex: 2, reparented: false });
    expect([...list.children].map((c) => c.getAttribute('data-key'))).toEqual(['page:7:1', 'page:8:1', 'page:6:1']);
  });

  it('a grid with two or more columns keeps cell placement (no live reorder)', () => {
    mount('150px 150px');
    manager.handleStart({ key: 'page:6:1', iframeX: 150, iframeY: 50 });
    manager.handleMove({ iframeX: 150, iframeY: 280 });
    manager.handleEnd();
    expect(drop()).toMatchObject({ key: 'page:6:1', insertIndex: 0, reparented: false });
  });
});

