import { SelectionGeometryFixture, type GeometryFixtureApi } from '@/test/selectionGeometryFixture';
import { act } from '@testing-library/react';
import type { ScannedElement } from '@/context/SelectionContext';
// task-106/109 vector shapes: DrawOverlay builds penPath + markup via buildShape.
// Pins: thin line drags survive the min-size guard; every shape kind commits a
// valid PenPath payload; drag direction controls line slope.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawOverlay as RealDrawOverlay } from '../DrawOverlay';
import { SHAPE_KINDS } from '../shapeMarkup';
import type { PenPath } from '../penGeometry';
import type { DrawTool } from '@/context/ToolContext';

vi.mock('@/utils/smartInsertion', () => ({
  findInsertionTarget: vi.fn(() => ({ parentKey: null, insertIndex: 0, relativeX: 0, relativeY: 0 })),
}));

let mockTool: DrawTool = 'rect';
vi.mock('@/context/ToolContext', () => ({
  useTool: () => ({ activeTool: mockTool, setActiveTool: vi.fn() }),
}));

const onElementCreated = vi.fn();
const baseProps = {
  scale: 1,
  position: { x: 0, y: 0 },
  canvasWidth: 375,
  viewportWidth: 375,
  scannedElements: [],
  onElementCreated,
};

function drag(container: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  const overlay = container.querySelector('.z-40') as HTMLElement;
  fireEvent.mouseDown(overlay, { clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(overlay, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(overlay, { clientX: to.x, clientY: to.y });
}

describe('DrawOverlay — shape tools (task-109 universal vector model)', () => {
  beforeEach(() => onElementCreated.mockClear());

  it('line: thin 200×3 drag survives and carries penPath + <path> markup', () => {
    mockTool = 'line';
    const { container } = render(<DrawOverlay {...baseProps} />);
    drag(container, { x: 0, y: 40 }, { x: 200, y: 43 });
    expect(onElementCreated).toHaveBeenCalledTimes(1);
    const result = onElementCreated.mock.calls[0][0];
    expect(result.staticMarkup).toContain('<path d=');
    const p: PenPath = JSON.parse(result.penPath);
    expect(p.anchors.length).toBe(2);
    expect(p.closed).toBe(false);
  });

  it('ellipse: fill seed classes + 4 smooth anchors, no rounded-full/bg-*', () => {
    mockTool = 'ellipse';
    const { container } = render(<DrawOverlay {...baseProps} />);
    drag(container, { x: 0, y: 0 }, { x: 100, y: 100 });
    const result = onElementCreated.mock.calls[0][0];
    expect(result.classes).toContain('fill-gray-200');
    expect(result.classes).not.toContain('rounded-full');
    expect(result.classes).not.toContain('bg-');
    const p: PenPath = JSON.parse(result.penPath);
    expect(p.anchors).toHaveLength(4);
    expect(p.closed).toBe(true);
  });

  it('line: TR→BL drag slopes up (first anchor at bottom-left)', () => {
    mockTool = 'line';
    const { container } = render(<DrawOverlay {...baseProps} />);
    // start below the 32px viewport-header offset so no clamping distorts h
    drag(container, { x: 200, y: 40 }, { x: 0, y: 140 });
    const result = onElementCreated.mock.calls[0][0];
    const p: PenPath = JSON.parse(result.penPath);
    expect(p.anchors[0]).toEqual({ x: 0, y: 100, corner: true });
    expect(p.anchors[1]).toEqual({ x: 200, y: 0, corner: true });
  });

  it('arrow: payload penPath carries markerEnd and markup carries the marker', () => {
    mockTool = 'arrow';
    const { container } = render(<DrawOverlay {...baseProps} />);
    drag(container, { x: 0, y: 0 }, { x: 200, y: 50 });
    const result = onElementCreated.mock.calls[0][0];
    const p: PenPath = JSON.parse(result.penPath);
    expect(p.markerEnd).toBe('arrow');
    expect(result.staticMarkup).toContain('marker-end="url(#sq-arrow)"');
  });

  it('every shape kind commits penPath (valid JSON, ≥2 anchors) + <path> markup', () => {
    for (const kind of SHAPE_KINDS) {
      onElementCreated.mockClear();
      mockTool = kind;
      const { container, unmount } = render(<DrawOverlay {...baseProps} />);
      drag(container, { x: 0, y: 0 }, { x: 120, y: 80 });
      expect(onElementCreated).toHaveBeenCalledTimes(1);
      const result = onElementCreated.mock.calls[0][0];
      expect(result.staticMarkup).toContain('<path d=');
      const p: PenPath = JSON.parse(result.penPath);
      expect(p.anchors.length).toBeGreaterThanOrEqual(2);
      unmount();
    }
  });

  it('non-shape tools (frame) carry NO penPath', () => {
    mockTool = 'frame';
    const { container } = render(<DrawOverlay {...baseProps} />);
    drag(container, { x: 0, y: 0 }, { x: 120, y: 80 });
    const result = onElementCreated.mock.calls[0][0];
    expect(result.penPath).toBeUndefined();
    expect(result.staticMarkup).toBeUndefined();
  });
});

let geometryApi: GeometryFixtureApi;
function DrawOverlay({ scannedElements = [], ...props }: React.ComponentProps<typeof RealDrawOverlay> & { scannedElements?: ScannedElement[] }) {
  return <SelectionGeometryFixture elements={scannedElements}  onReady={api => { geometryApi = api; }}><RealDrawOverlay {...props} /></SelectionGeometryFixture>;
}
