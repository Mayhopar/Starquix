/**
 * task-120 (5.1) — flow-drag move dispatches are rAF-coalesced: N mousemoves
 * inside one frame produce ONE onFlowDragMove; a pending move never lands
 * after drag end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SelectionOverlay } from '../SelectionOverlay';

const rect = { top: 10, left: 10, width: 100, height: 50 };

let rafQueue: Array<() => void>;

function flushRaf(): void {
  const q = rafQueue.splice(0);
  q.forEach((cb) => cb());
}

describe('flow-drag rAF coalescing', () => {
  beforeEach(() => {
    rafQueue = [];
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafQueue.push(() => cb(0));
      return ++id;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      // our fake queue holds at most the latest cb per handler; emulate cancel
      // by clearing the queue when the latest was cancelled
      void handle;
      rafQueue.pop();
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    // toIframeCoords targets this; jsdom rects are all-zero so coords = client/scale.
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-viewport', 'true');
    document.body.appendChild(iframe);
  });

  function mountOverlay(onFlowDragMove: (x: number, y: number) => void, onFlowDragEnd = vi.fn()) {
    return render(
      <SelectionOverlay
        selectedRect={rect}
        scale={1}
        containerOffset={{ x: 0, y: 0 }}
        isFlowDraggable
        onFlowDragStart={vi.fn()}
        onFlowDragMove={onFlowDragMove}
        onFlowDragEnd={onFlowDragEnd}
      />,
    );
  }

  it('many mousemoves in one frame → one onFlowDragMove', () => {
    const onMove = vi.fn();
    const { container } = mountOverlay(onMove);
    const overlay = container.querySelector('.z-\\[1000\\]') as HTMLElement;
    expect(overlay).toBeTruthy();

    fireEvent.mouseDown(overlay, { clientX: 50, clientY: 30 });
    // Cross the 8px threshold, then spam moves
    fireEvent.mouseMove(document, { clientX: 70, clientY: 30 });
    fireEvent.mouseMove(document, { clientX: 75, clientY: 31 });
    fireEvent.mouseMove(document, { clientX: 80, clientY: 32 });

    expect(onMove).not.toHaveBeenCalled(); // nothing until the frame flushes
    flushRaf();
    expect(onMove).toHaveBeenCalledTimes(1);
    // The dispatched coords are the LATEST move's
    expect(onMove.mock.calls[0][0]).toBe(80);

    fireEvent.mouseUp(document, { clientX: 80, clientY: 32 });
  });

  it('a pending move is cancelled by drag end (no move after end)', () => {
    const onMove = vi.fn();
    const onEnd = vi.fn();
    const { container } = mountOverlay(onMove, onEnd);
    const overlay = container.querySelector('.z-\\[1000\\]') as HTMLElement;

    fireEvent.mouseDown(overlay, { clientX: 50, clientY: 30 });
    fireEvent.mouseMove(document, { clientX: 70, clientY: 30 });
    fireEvent.mouseUp(document, { clientX: 70, clientY: 30 });

    flushRaf();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onMove).not.toHaveBeenCalled();
  });

  // Issue #5: the right button opens the layer menu; it must not start a drag or re-click on release.
  it.each([
    ['flow drag', { isFlowDraggable: true }],
    ['absolute move', { isMovable: true }],
  ])('a right-button press starts no %s', (_, mode) => {
    const onFlowDragStart = vi.fn();
    const onFlowDragEnd = vi.fn();
    const onMove = vi.fn();
    const { container } = render(
      <SelectionOverlay selectedRect={rect} scale={1} containerOffset={{ x: 0, y: 0 }} {...mode}
        onFlowDragStart={onFlowDragStart} onFlowDragMove={vi.fn()} onFlowDragEnd={onFlowDragEnd} onMove={onMove} />,
    );
    const overlay = container.querySelector('.z-\\[1000\\]') as HTMLElement;
    const pressed = fireEvent.mouseDown(overlay, { button: 2, clientX: 50, clientY: 30 });
    fireEvent.mouseMove(document, { clientX: 90, clientY: 60 });
    fireEvent.mouseUp(document, { button: 2, clientX: 90, clientY: 60 });
    flushRaf();
    expect(pressed).toBe(true);
    expect(onFlowDragStart).not.toHaveBeenCalled();
    expect(onFlowDragEnd).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });
});
