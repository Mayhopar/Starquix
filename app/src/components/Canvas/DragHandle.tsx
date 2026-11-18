import { GripIcon as SharedGripIcon } from '@/assets/icons';
import { memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useElementGeometry, type ScannedElement } from '@/context/SelectionContext';
import { DRAG_TYPES } from '@/types/drag';

interface DragHandleProps {
  element: ScannedElement;
  draggableId: string;
  index: number;
  scale: number;
  handleLeft: number;
  viewportFrameTop: number;
  canvasContainerTop: number;
}

export const DragHandle = memo(function DragHandle({
  element,
  draggableId,
  index,
  scale,
  handleLeft,
  viewportFrameTop,
  canvasContainerTop,
}: DragHandleProps) {
  const rect = useElementGeometry(element.key);
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: draggableId,
    data: {
      type: DRAG_TYPES.GUTTER_HANDLE,
      element: rect ? { ...element, rect } : element,
      index,
      scale,
      viewportFrameTop,
      canvasContainerTop,
    },
  });

  // Position handle at element's Y position relative to viewport frame
  if (!rect) return null;
  const top = viewportFrameTop + rect.top * scale;

  return (
    <div
      ref={setNodeRef}
      data-testid={`drag-handle-${index}`}
      className={`absolute w-6 h-6 flex items-center justify-center cursor-default rounded bg-bg-secondary border border-stroke hover:border-stroke-active hover:bg-bg-hover transition-colors ${
        isDragging ? 'opacity-50 z-50' : ''
      }`}
      style={{
        top: `${top}px`,
        left: `${handleLeft}px`,
      }}
      {...attributes}
      {...listeners}
    >
      <SharedGripIcon className="w-4 h-4 text-text-muted" />
    </div>
  );
});
