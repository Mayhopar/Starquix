import { ShuffleIcon as SharedShuffleIcon } from '@/assets/icons';
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui';
import { useReorderElements } from '@/hooks';
import { useSelectionContext, useElementGeometry } from '@/context/SelectionContext';
import { DragHandle } from './DragHandle';
import { GutterId } from '@/types/drag';

const HIDE_SCALE_THRESHOLD = 0.3;
const HANDLE_SIZE = 24; // Handle width in px
const HANDLE_MARGIN = 8; // Margin between handle and viewport frame
const BUTTON_MARGIN = 8; // Margin between button and viewport frame

interface DragGutterProps {
  scale: number;
  viewportFrameLeft: number;
  viewportFrameTop: number;
  viewportWidth: number;
  canvasContainerTop: number;
}

export const DragGutter = memo(function DragGutter({
  scale,
  viewportFrameLeft,
  viewportFrameTop,
  viewportWidth,
  canvasContainerTop,
}: DragGutterProps) {
  const { rootElements } = useReorderElements();
  const { selectedKey } = useSelectionContext();

  // Find the selected root element (if any)
  const selectedRoot = selectedKey
    ? rootElements.find(el => el.key === selectedKey)
    : null;

  const selectedRect = useElementGeometry(selectedRoot?.key ?? null);

  // Fade out while scrolling/panning
  const [isScrolling, setIsScrolling] = useState(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const handleWheel = () => {
      setIsScrolling(true);
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 300);
    };
    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', handleWheel);
      clearTimeout(scrollTimerRef.current);
    };
  }, []);

  const handleReplace = useCallback(() => {
    window.dispatchEvent(new CustomEvent('sq:open-component-picker', {
      detail: { replace: true },
    }));
  }, []);

  // Hide handles when zoomed out too far
  if (scale < HIDE_SCALE_THRESHOLD) {
    return null;
  }

  // Position handles at left edge of viewport frame
  const handleLeft = viewportFrameLeft - HANDLE_SIZE - HANDLE_MARGIN;
  // Position replace button at right edge of viewport frame
  const buttonLeft = viewportFrameLeft + viewportWidth * scale + BUTTON_MARGIN;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-10"
      data-testid="drag-gutter"
    >
      <div className="pointer-events-auto transition-opacity duration-150" style={{ opacity: isScrolling ? 0 : 1 }}>
        {rootElements.map((element, index) => (
          <DragHandle
            key={element.key}
            element={element}
            draggableId={GutterId.create(element.key)}
            index={index}
            scale={scale}
            handleLeft={handleLeft}
            viewportFrameTop={viewportFrameTop}
            canvasContainerTop={canvasContainerTop}
          />
        ))}
      </div>
      {/* Replace button on the right for selected root section */}
      {selectedRoot && selectedRect && (
        <div
          className="absolute pointer-events-auto transition-opacity duration-150"
          style={{
            top: `${viewportFrameTop + selectedRect.top * scale}px`,
            left: `${buttonLeft}px`,
            opacity: isScrolling ? 0 : 1,
          }}
        >
          <Button
            variant="outline"
            size="sm"
            className="px-2 gap-1.5 font-normal text-2xs text-text-muted hover:inset-ring-stroke-active whitespace-nowrap"
            onClick={handleReplace}
            title="Replace section"
            icon={
              <SharedShuffleIcon className="w-4 h-4 text-text-muted" />
            }
            label="Replace"
          />
        </div>
      )}
    </div>
  );
});
