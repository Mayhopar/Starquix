import { ResizeIcon as SharedResizeIcon } from '@/assets/icons';
/**
 * ResizeHandle Component
 *
 * A draggable corner grip for resizing editor panels vertically.
 */

import React from 'react';

interface ResizeHandleProps {
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

export function ResizeHandle({ isDragging, onMouseDown }: ResizeHandleProps): React.ReactElement {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`absolute bottom-1 right-1 w-4 h-4 cursor-ns-resize flex items-center justify-center rounded-sm transition-colors ${
        isDragging ? 'bg-stroke-active/20' : 'hover:bg-stroke/50'
      }`}
      title="Drag to resize"
    >
      <SharedResizeIcon className={`transition-colors ${isDragging ? 'text-stroke-active' : 'text-text-secondary'}`} width="16" height="16" />
    </div>
  );
}
