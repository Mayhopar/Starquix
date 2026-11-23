/** Option-hover distances (Figma-style): SelectionOverlay → MeasureOverlay gating. */
import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { SelectionOverlay } from '../SelectionOverlay';
import { hoverRectStore } from '../hoverRectStore';

const labels = () => [...document.querySelectorAll('[data-testid="measure-label"]')].map((e) => e.textContent);
const alt = (type: 'keydown' | 'keyup') =>
  act(() => { window.dispatchEvent(new KeyboardEvent(type, { key: 'Alt', altKey: type === 'keydown' })); });

afterEach(() => {
  act(() => hoverRectStore.set(null));
  alt('keyup');
  cleanup();
});

describe('SelectionOverlay Option-hover measuring', () => {
  it('Option held BEFORE hovering still measures; releasing it clears', () => {
    render(<SelectionOverlay selectedRect={{ left: 0, top: 0, width: 100, height: 50 }} scale={1} containerOffset={{ x: 0, y: 0 }} />);
    alt('keydown');
    act(() => hoverRectStore.set({ rect: { left: 130, top: 0, width: 50, height: 50 }, key: 'b' }));
    expect(labels()).toEqual(['30']);
    alt('keyup');
    expect(labels()).toEqual([]);
  });

  it('no Option → hover outline only', () => {
    render(<SelectionOverlay selectedRect={{ left: 0, top: 0, width: 100, height: 50 }} scale={1} containerOffset={{ x: 0, y: 0 }} />);
    act(() => hoverRectStore.set({ rect: { left: 130, top: 0, width: 50, height: 50 }, key: 'b' }));
    expect(labels()).toEqual([]);
  });
});
