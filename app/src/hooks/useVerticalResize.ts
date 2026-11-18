/**
 * useVerticalResize Hook
 *
 * Provides vertical resize functionality for editor panels.
 * Handles drag state, mouse events, and height constraints.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

interface UseVerticalResizeOptions {
  initialHeight: number;
  minHeight?: number;
  maxHeight?: number;
}

interface UseVerticalResizeReturn {
  height: number;
  isDragging: boolean;
  handleResizeStart: (e: React.MouseEvent) => void;
}

export function useVerticalResize({
  initialHeight,
  minHeight = 80,
  maxHeight = 600,
}: UseVerticalResizeOptions): UseVerticalResizeReturn {
  const [height, setHeight] = useState(initialHeight);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);
  // Store min/max in refs to avoid re-running effect when they change during drag
  const minHeightRef = useRef(minHeight);
  const maxHeightRef = useRef(maxHeight);
  minHeightRef.current = minHeight;
  maxHeightRef.current = maxHeight;

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      startYRef.current = e.clientY;
      startHeightRef.current = height;
    },
    [height]
  );

  useEffect(() => {
    if (!isDragging) return;

    function handleMouseMove(e: MouseEvent): void {
      const delta = e.clientY - startYRef.current;
      // Use refs to get current min/max values without triggering effect re-runs
      const newHeight = Math.max(minHeightRef.current, Math.min(maxHeightRef.current, startHeightRef.current + delta));
      setHeight(newHeight);
    }

    function handleMouseUp(): void {
      setIsDragging(false);
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return {
    height,
    isDragging,
    handleResizeStart,
  };
}
