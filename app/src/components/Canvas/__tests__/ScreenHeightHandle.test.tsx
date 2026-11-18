import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ScreenHeightHandle } from '../ScreenHeightHandle';

const drag = (props: Partial<Parameters<typeof ScreenHeightHandle>[0]>, dy: number) => {
  cleanup();
  const onChange = vi.fn();
  const { getByRole } = render(<ScreenHeightHandle height={900} bottom={1400} content={1400} width={1280} scale={0.5} caption="900" onChange={onChange} {...props} />);
  const grip = getByRole('separator');
  grip.setPointerCapture = vi.fn();
  fireEvent.pointerDown(grip, { button: 0, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(grip, { clientY: 100 + dy, pointerId: 1, buttons: 1 });
  fireEvent.pointerUp(grip, { pointerId: 1 });
  fireEvent.pointerMove(grip, { clientY: 400, pointerId: 1, buttons: 1 });
  expect(onChange).toHaveBeenCalledTimes(1); // released: moves no longer resize
  return onChange.mock.calls[0][0];
};

describe('ScreenHeightHandle', () => {
  it('drags from the artboard edge in artboard pixels (delta / scale)', () => {
    expect(drag({}, 50)).toBe(1500);
  });
  it('dragging up into taller content keeps the saved min (the edge cannot move)', () => {
    expect(drag({}, -100)).toBe(900);
  });
  it('on a short page it shrinks the min down to the content, never below it', () => {
    expect(drag({ bottom: 900, content: 300 }, -200)).toBe(500);
    expect(drag({ bottom: 900, content: 300 }, -2000)).toBe(300);
  });
  // Owner 2026-10-08: after release the bar kept following the mouse (a
  // release with no pointerup) — a move with no button held ends the drag.
  it('a move with no button held ends the drag even without a pointerup', () => {
    cleanup();
    const onChange = vi.fn();
    const { getByRole } = render(<ScreenHeightHandle height={900} bottom={900} content={300} width={1280} scale={1} caption="900" onChange={onChange} />);
    const grip = getByRole('separator');
    grip.setPointerCapture = vi.fn();
    fireEvent.pointerDown(grip, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(grip, { clientY: 150, pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(grip, { clientY: 300, pointerId: 1, buttons: 0 });
    fireEvent.pointerMove(grip, { clientY: 400, pointerId: 1, buttons: 1 });
    expect(onChange.mock.calls).toEqual([[950]]);
  });
  it('captions where the screen ends', () => {
    const { getByTestId } = render(<ScreenHeightHandle height={900} bottom={1400} content={1400} width={1280} scale={1} caption="900 · Laptop 15&quot;" onChange={() => {}} />);
    expect(getByTestId('screen-height-caption').style.top).toBe('900px');
  });
});
