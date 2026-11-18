import { memo } from 'react';

interface DropIndicatorProps {
  isVisible: boolean;
  top: number;
  scale: number;
  viewportFrameLeft: number;
  viewportFrameTop: number;
  viewportWidth: number;
}

export const DropIndicator = memo(function DropIndicator({
  isVisible,
  top,
  scale,
  viewportFrameLeft,
  viewportFrameTop,
  viewportWidth,
}: DropIndicatorProps) {
  if (!isVisible) {
    return null;
  }

  // Position line at the drop position, spanning full viewport width
  const lineTop = viewportFrameTop + top * scale;
  const lineLeft = viewportFrameLeft;
  const lineWidth = viewportWidth * scale;

  return (
    <div
      data-testid="drop-indicator"
      className="absolute h-0.5 bg-accent-strong rounded-full pointer-events-none z-20"
      style={{
        top: `${lineTop}px`,
        left: `${lineLeft}px`,
        width: `${lineWidth}px`,
        boxShadow: '0 0 8px color-mix(in srgb, var(--color-accent-strong) 50%, transparent)',
      }}
    />
  );
});
