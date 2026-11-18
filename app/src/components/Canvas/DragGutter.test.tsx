// app/src/components/Canvas/DragGutter.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { DragGutter } from './DragGutter';

// Mock useReorderElements
vi.mock('@/hooks', () => ({
  useReorderElements: vi.fn(() => ({
    rootElements: [
      {
        key: 'elem-1:10:1',
        rect: { top: 0, left: 0, width: 800, height: 200 },
        sourceLocation: { file: 'test.astro', line: 10, column: 1 },
      },
      {
        key: 'elem-2:20:1',
        rect: { top: 200, left: 0, width: 800, height: 200 },
        sourceLocation: { file: 'test.astro', line: 20, column: 1 },
      },
    ],
    reorderRootElements: vi.fn(),
  })),
}));

// DragGutter now calls useSelectionContext to highlight the selected gutter
// handle; tests don't exercise selection so a stub returning null is enough.
vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({ selectedKey: null }),
  useElementGeometry: (key: string) => ({ top: key === "elem-2:20:1" ? 200 : 0, left: 0, width: 800, height: 200 }),
}));

const defaultProps = {
  scale: 1,
  viewportFrameLeft: 200,
  viewportFrameTop: 50,
  viewportWidth: 800,
  canvasContainerTop: 0,
};

describe('DragGutter', () => {
  it('renders handles for each root element', () => {
    render(
      <DndContext>
        <DragGutter {...defaultProps} />
      </DndContext>
    );

    expect(screen.getByTestId('drag-handle-0')).toBeInTheDocument();
    expect(screen.getByTestId('drag-handle-1')).toBeInTheDocument();
  });

  it('hides when scale is below threshold', () => {
    render(
      <DndContext>
        <DragGutter {...defaultProps} scale={0.2} />
      </DndContext>
    );

    expect(screen.queryByTestId('drag-handle-0')).not.toBeInTheDocument();
  });

  it('shows at exactly 0.3 scale threshold', () => {
    render(
      <DndContext>
        <DragGutter {...defaultProps} scale={0.3} />
      </DndContext>
    );

    expect(screen.getByTestId('drag-handle-0')).toBeInTheDocument();
  });
});
