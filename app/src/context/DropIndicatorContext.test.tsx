// app/src/context/DropIndicatorContext.test.tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { DropIndicatorProvider, useDropIndicator } from './DropIndicatorContext';

describe('DropIndicatorContext', () => {
  it('throws when used outside provider', () => {
    expect(() => {
      renderHook(() => useDropIndicator());
    }).toThrow('useDropIndicator must be used within a DropIndicatorProvider');
  });

  it('starts with hidden indicator', () => {
    const { result } = renderHook(() => useDropIndicator(), {
      wrapper: DropIndicatorProvider,
    });

    expect(result.current.dropIndicator.isVisible).toBe(false);
    expect(result.current.dropIndicator.top).toBe(0);
    expect(result.current.dropIndicator.targetIndex).toBe(-1);
  });

  it('shows indicator at specified position with position type and target index', () => {
    const { result } = renderHook(() => useDropIndicator(), {
      wrapper: DropIndicatorProvider,
    });

    act(() => {
      result.current.showDropIndicator(150, 'above', 2);
    });

    expect(result.current.dropIndicator.isVisible).toBe(true);
    expect(result.current.dropIndicator.top).toBe(150);
    expect(result.current.dropIndicator.position).toBe('above');
    expect(result.current.dropIndicator.targetIndex).toBe(2);
  });

  it('hides indicator and returns last state', () => {
    const { result } = renderHook(() => useDropIndicator(), {
      wrapper: DropIndicatorProvider,
    });

    act(() => {
      result.current.showDropIndicator(200, 'below', 1);
    });

    let lastState: { isVisible: boolean; top: number; position: 'above' | 'below'; targetIndex: number };
    act(() => {
      lastState = result.current.hideDropIndicator();
    });

    // Returns the state that was active before hiding
    expect(lastState!.isVisible).toBe(true);
    expect(lastState!.top).toBe(200);
    expect(lastState!.position).toBe('below');
    expect(lastState!.targetIndex).toBe(1);

    // Context state is now reset
    expect(result.current.dropIndicator.isVisible).toBe(false);
    expect(result.current.dropIndicator.top).toBe(0);
    expect(result.current.dropIndicator.targetIndex).toBe(-1);
  });

  it('updates position when already visible', () => {
    const { result } = renderHook(() => useDropIndicator(), {
      wrapper: DropIndicatorProvider,
    });

    act(() => {
      result.current.showDropIndicator(100, 'above', 0);
    });

    act(() => {
      result.current.showDropIndicator(250, 'below', 3);
    });

    expect(result.current.dropIndicator.isVisible).toBe(true);
    expect(result.current.dropIndicator.top).toBe(250);
    expect(result.current.dropIndicator.position).toBe('below');
    expect(result.current.dropIndicator.targetIndex).toBe(3);
  });

});
