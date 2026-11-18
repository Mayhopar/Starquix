// app/src/components/Canvas/ViewportFrame.integration.test.tsx
/**
 * Integration test for scanned element rect updates.
 * Tests that updateScannedElementRects correctly updates element positions.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { SelectionProvider, useScannedElements, useScannedElementsRef } from '@/context/SelectionContext';

describe('updateScannedElementRects', () => {
  it('updates scannedElements rects with new values', () => {
    // Initial scanned elements with old rect values
    const initialElements = [
      {
        key: 'section-1:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 0, left: 0, width: 800, height: 400 },
      },
      {
        key: 'section-2:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 400, left: 0, width: 800, height: 400 },
      },
    ];

    // Wrapper that provides SelectionContext
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SelectionProvider>{children}</SelectionProvider>
    );

    const { result } = renderHook(() => ({ ...useScannedElements(), ...useScannedElementsRef() }), { wrapper });

    // Set initial scanned elements
    act(() => {
      result.current.setScannedElements(initialElements);
    });

    expect(result.current.scannedElementsRef.current[0].rect.top).toBe(0);
    expect(result.current.scannedElementsRef.current[0].rect.height).toBe(400);
    expect(result.current.scannedElementsRef.current[1].rect.top).toBe(400);

    // New rects after layout change (e.g., breakpoint change)
    const updatedRects = [
      { key: 'section-1:1:1', rect: { top: 0, left: 0, width: 600, height: 500 } },
      { key: 'section-2:1:1', rect: { top: 500, left: 0, width: 600, height: 500 } },
    ];

    // Call updateScannedElementRects (this function needs to be implemented)
    act(() => {
      result.current.updateScannedElementRects(updatedRects);
    });

    // After update, the scannedElements should have new rects
    expect(result.current.scannedElementsRef.current[0].rect.top).toBe(0);
    expect(result.current.scannedElementsRef.current[0].rect.height).toBe(500);
    expect(result.current.scannedElementsRef.current[1].rect.top).toBe(500);
    expect(result.current.scannedElementsRef.current[1].rect.height).toBe(500);
  });

  it('only updates rects for matching keys, preserves other elements', () => {
    const initialElements = [
      {
        key: 'section-1:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'section',
        classes: 'my-class',
        rect: { top: 0, left: 0, width: 800, height: 400 },
      },
      {
        key: 'section-2:1:1',
        parentKey: null,
        hasSourceTracking: true,
        tagName: 'section',
        classes: '',
        rect: { top: 400, left: 0, width: 800, height: 400 },
      },
    ];

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SelectionProvider>{children}</SelectionProvider>
    );

    const { result } = renderHook(() => ({ ...useScannedElements(), ...useScannedElementsRef() }), { wrapper });

    act(() => {
      result.current.setScannedElements(initialElements);
    });

    // Only update section-1
    const updatedRects = [
      { key: 'section-1:1:1', rect: { top: 10, left: 5, width: 600, height: 500 } },
    ];

    act(() => {
      result.current.updateScannedElementRects(updatedRects);
    });

    // section-1 should be updated
    expect(result.current.scannedElementsRef.current[0].rect.top).toBe(10);
    expect(result.current.scannedElementsRef.current[0].rect.left).toBe(5);
    expect(result.current.scannedElementsRef.current[0].rect.height).toBe(500);
    // classes should be preserved
    expect(result.current.scannedElementsRef.current[0].classes).toBe('my-class');

    // section-2 should be unchanged
    expect(result.current.scannedElementsRef.current[1].rect.top).toBe(400);
    expect(result.current.scannedElementsRef.current[1].rect.height).toBe(400);
  });
});
