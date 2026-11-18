import { SelectionGeometryFixture } from '@/test/selectionGeometryFixture';
// app/src/components/Canvas/DragHandle.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { DragHandle } from './DragHandle';

const mockElement = {
  key: 'elem-1:10:1',
  parentKey: null,
  hasSourceTracking: true,
  sourceLocation: { file: '/src/pages/index.astro', line: 10, column: 1 },
  tagName: 'section',
  classes: '',
  rect: { top: 100, left: 0, width: 800, height: 200 },
};

describe('DragHandle', () => {
  it('renders a draggable handle', () => {
    render(
      <SelectionGeometryFixture elements={[mockElement]}><DndContext>
        <DragHandle
          element={mockElement}
          draggableId={`gutter:${mockElement.key}`}
          index={0}
          scale={1}
          handleLeft={100}
          viewportFrameTop={50}
          canvasContainerTop={0}
        />
      </DndContext></SelectionGeometryFixture>
    );

    const handle = screen.getByTestId('drag-handle-0');
    expect(handle).toBeInTheDocument();
  });

  it('positions handle based on element rect and viewport frame position', () => {
    render(
      <SelectionGeometryFixture elements={[mockElement]}><DndContext>
        <DragHandle
          element={mockElement}
          draggableId={`gutter:${mockElement.key}`}
          index={0}
          scale={1}
          handleLeft={100}
          viewportFrameTop={50}
          canvasContainerTop={0}
        />
      </DndContext></SelectionGeometryFixture>
    );

    const handle = screen.getByTestId('drag-handle-0');
    // top = viewportFrameTop + element.rect.top * scale = 50 + 100 * 1 = 150
    expect(handle).toHaveStyle({ top: '150px' });
    expect(handle).toHaveStyle({ left: '100px' });
  });

  it('maintains fixed size regardless of scale', () => {
    render(
      <SelectionGeometryFixture elements={[mockElement]}><DndContext>
        <DragHandle
          element={mockElement}
          draggableId={`gutter:${mockElement.key}`}
          index={0}
          scale={0.5}
          handleLeft={100}
          viewportFrameTop={50}
          canvasContainerTop={0}
        />
      </DndContext></SelectionGeometryFixture>
    );

    const handle = screen.getByTestId('drag-handle-0');
    // Handle should have fixed size (w-6 h-6 = 24x24px), no transform applied
    // Using useDraggable (not useSortable) prevents sorting transforms
    expect(handle.style.transform).toBe('');
    expect(handle).toHaveClass('w-6', 'h-6');
  });
});
