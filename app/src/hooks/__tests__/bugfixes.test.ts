/**
 * Bug Fix Tests: Hooks
 *
 * Tests for:
 * - Bug #26: useVerticalResize stale closure for minHeight/maxHeight
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVerticalResize } from '../useVerticalResize';

describe('Bug #26: useVerticalResize stale closure for minHeight/maxHeight', () => {
  it('should not re-run effect when minHeight/maxHeight change during drag', () => {
    // Track how many times the effect cleanup runs
    const cleanupSpy = vi.fn();
    const originalAddEventListener = document.addEventListener;
    const originalRemoveEventListener = document.removeEventListener;

    // Track listener add/remove calls
    const listenerCalls: { type: string; action: 'add' | 'remove' }[] = [];
    document.addEventListener = vi.fn((type: string, listener: EventListener) => {
      listenerCalls.push({ type, action: 'add' });
      originalAddEventListener.call(document, type, listener);
    });
    document.removeEventListener = vi.fn((type: string, listener: EventListener) => {
      listenerCalls.push({ type, action: 'remove' });
      originalRemoveEventListener.call(document, type, listener);
    });

    const { result, rerender } = renderHook(
      ({ minHeight, maxHeight }) =>
        useVerticalResize({ initialHeight: 200, minHeight, maxHeight }),
      { initialProps: { minHeight: 80, maxHeight: 600 } }
    );

    // Start dragging
    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
        clientY: 100,
      } as unknown as React.MouseEvent);
    });

    expect(result.current.isDragging).toBe(true);

    // Count listeners added during drag start
    const listenersAfterDragStart = listenerCalls.filter(c => c.action === 'add').length;

    // Change minHeight/maxHeight - should NOT cause effect to re-run
    rerender({ minHeight: 100, maxHeight: 500 });

    // If the fix is working, no new listeners should have been added
    // (old impl would remove and re-add listeners)
    const listenersAfterRerender = listenerCalls.filter(c => c.action === 'add').length;
    expect(listenersAfterRerender).toBe(listenersAfterDragStart);

    // Cleanup
    document.addEventListener = originalAddEventListener;
    document.removeEventListener = originalRemoveEventListener;
  });

  it('should still respect new min/max values during drag', () => {
    const { result, rerender } = renderHook(
      ({ minHeight, maxHeight }) =>
        useVerticalResize({ initialHeight: 200, minHeight, maxHeight }),
      { initialProps: { minHeight: 80, maxHeight: 600 } }
    );

    // Start dragging
    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
        clientY: 100,
      } as unknown as React.MouseEvent);
    });

    // Change max height to something smaller than current height
    rerender({ minHeight: 80, maxHeight: 150 });

    // Simulate mouse move that would exceed new max
    act(() => {
      const event = new MouseEvent('mousemove', { clientY: 400 });
      document.dispatchEvent(event);
    });

    // Height should be clamped to new maxHeight
    expect(result.current.height).toBeLessThanOrEqual(150);

    // End drag
    act(() => {
      const event = new MouseEvent('mouseup');
      document.dispatchEvent(event);
    });

    expect(result.current.isDragging).toBe(false);
  });

  it('should use refs to avoid stale closures', () => {
    const { result, rerender } = renderHook(
      ({ minHeight, maxHeight }) =>
        useVerticalResize({ initialHeight: 200, minHeight, maxHeight }),
      { initialProps: { minHeight: 50, maxHeight: 400 } }
    );

    // Start dragging at y=100 with initial height 200
    act(() => {
      result.current.handleResizeStart({
        preventDefault: vi.fn(),
        clientY: 100,
      } as unknown as React.MouseEvent);
    });

    // Change min height while dragging
    rerender({ minHeight: 150, maxHeight: 400 });

    // Move mouse down (which would decrease height below new min)
    // e.g., clientY=200 means delta=100, so newHeight = 200 - 100 = 100
    // But with new minHeight=150, it should be clamped to 150
    act(() => {
      const event = new MouseEvent('mousemove', { clientY: 200 });
      document.dispatchEvent(event);
    });

    // Height should respect the NEW minHeight of 150, not the old 50
    expect(result.current.height).toBeGreaterThanOrEqual(150);

    // End drag
    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });
  });
});
