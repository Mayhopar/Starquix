import { SelectionGeometryFixture, type GeometryFixtureApi } from '@/test/selectionGeometryFixture';
import { act } from '@testing-library/react';
// task-107 pen tool: PenOverlay wiring — reducers carry the logic; this pins
// the component contract: clicks place anchors, Enter commits with
// staticMarkup + penPath + seeded classes, Escape cancels; edit mode drags
// anchors and recommits {penPath, staticMarkup, classes} per gesture.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { PenOverlay as RealPenOverlay } from '../PenOverlay';
import type { DrawTool } from '@/context/ToolContext';
import type { ScannedElement } from '@/context/SelectionContext';

vi.mock('@/utils/smartInsertion', () => ({
  findInsertionTarget: vi.fn(() => ({ parentKey: null, insertIndex: 0, relativeX: 0, relativeY: 0 })),
}));

let mockTool: DrawTool = 'pen';
const mockSetActiveTool = vi.fn();
vi.mock('@/context/ToolContext', () => ({
  useTool: () => ({ activeTool: mockTool, setActiveTool: mockSetActiveTool }),
}));

let mockDoc: Y.Doc;
vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => mockDoc,
}));

let mockSelectedKey: string | null = null;


const onPathCommitted = vi.fn();
const baseProps = {
  scale: 1,
  position: { x: 0, y: 0 },
  canvasWidth: 375,
  viewportWidth: 375,
  scannedElements: [],
  onPathCommitted,
};

function click(container: HTMLElement, x: number, y: number) {
  const overlay = container.querySelector('[data-testid="pen-overlay"]') as HTMLElement;
  fireEvent.mouseDown(overlay, { clientX: x, clientY: y });
  fireEvent.mouseUp(overlay, { clientX: x, clientY: y });
}

describe('PenOverlay — drawing mode (task-107)', () => {
  beforeEach(() => {
    mockTool = 'pen';
    onPathCommitted.mockClear();
    mockSetActiveTool.mockClear();
  });

  it('renders nothing when pen is not the active tool', () => {
    mockTool = 'select';
    const { container } = render(<PenOverlay {...baseProps} />);
    expect(container.querySelector('[data-testid="pen-overlay"]')).toBeNull();
  });

  it('two clicks + Enter commits an open path with markup, penPath and seeded classes', () => {
    const { container } = render(<PenOverlay {...baseProps} />);
    click(container, 10, 50);
    click(container, 110, 100);
    fireEvent.keyDown(document, { key: 'Enter' });

    expect(onPathCommitted).toHaveBeenCalledTimes(1);
    const result = onPathCommitted.mock.calls[0][0];
    expect(result.classes).toContain('fill-none stroke-gray-900 stroke-2');
    expect(result.classes).toMatch(/w-\[\d+px\] h-\[\d+px\]/);
    expect(result.staticMarkup).toContain('<path d="');
    expect(result.staticMarkup).toContain('vector-effect="non-scaling-stroke"');
    const parsed = JSON.parse(result.penPath);
    expect(parsed.anchors).toHaveLength(2);
    expect(parsed.closed).toBe(false);
    expect(mockSetActiveTool).toHaveBeenCalledWith('select');
  });

  it('closing click on the first anchor commits a closed path with fill seed', () => {
    const { container } = render(<PenOverlay {...baseProps} />);
    click(container, 100, 100);
    click(container, 300, 100);
    click(container, 200, 260);
    click(container, 101, 101); // within closeRadius of first anchor

    expect(onPathCommitted).toHaveBeenCalledTimes(1);
    const result = onPathCommitted.mock.calls[0][0];
    expect(result.classes).toContain('fill-gray-200');
    expect(JSON.parse(result.penPath).closed).toBe(true);
  });

  it('Escape mid-draw cancels without commit and disarms the tool', () => {
    const { container } = render(<PenOverlay {...baseProps} />);
    click(container, 10, 50);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onPathCommitted).not.toHaveBeenCalled();
    expect(mockSetActiveTool).toHaveBeenCalledWith('select');
  });
});

describe('PenOverlay — edit mode, session-stable frame (task-107)', () => {
  const onPathEdited = vi.fn();
  const onElementDeleted = vi.fn();
  const onEditExit = vi.fn();

  // Element at iframe (50,100), 100×80, triangle path — visual scale 1:1.
  const RECT = { top: 100, left: 50, width: 100, height: 80 };
  const PEN_PATH =
    '{"anchors":[{"x":0,"y":0,"corner":true},{"x":100,"y":0,"corner":true},{"x":50,"y":80,"corner":true}],"closed":true}';
  const MARKUP =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80" preserveAspectRatio="none" width="100%" height="100%" style="display:block;overflow:visible"><path d="M 0 0 L 100 0 L 50 80 L 0 0 Z" vector-effect="non-scaling-stroke"/></svg>';

  const scannedFor = (rect: typeof RECT) =>
    [
      {
        key: 'pen-1',
        tagName: 'div',
        classes: '',
        rect,
        parentKey: null,
        hasSourceTracking: false,
      },
    ] as ScannedElement[];

  const editProps = (rect = RECT) => ({
    ...baseProps,
    scannedElements: scannedFor(rect),
    editingKey: 'pen-1',
    onPathEdited,
    onElementDeleted,
    onEditExit,
  });

  const seedDoc = (classes: string) => {
    mockDoc = new Y.Doc();
    const yEl = new Y.Map();
    yEl.set('id', 'pen-1');
    yEl.set('tag', 'div');
    yEl.set('penPath', PEN_PATH);
    yEl.set('staticMarkup', MARKUP);
    mockDoc.getMap('elements').set('pen-1', yEl);
    const entry = new Y.Map();
    entry.set('classes', classes);
    mockDoc.getMap('sourceClasses').set('pen-1', entry);
  };

  beforeEach(() => {
    mockTool = 'select';
    mockSelectedKey = 'pen-1';
    onPathEdited.mockClear();
    onElementDeleted.mockClear();
    onEditExit.mockClear();
    seedDoc('w-[100px] h-[80px] fill-gray-200 stroke-gray-900 stroke-2');
  });

  // toLocal at scale 1 / zero offsets: localX = iframe.x, localY = iframe.y + 32
  const anchorClient = (ax: number, ay: number, rect = RECT) => ({
    clientX: rect.left + ax,
    clientY: rect.top + ay + 32,
  });

  it('moves edit anchors when live geometry changes without a structural scan', () => {
    const { getByTestId } = render(<PenOverlay {...editProps()} />);
    const before = getByTestId('pen-anchor-0').querySelector('circle')!.getAttribute('cx');
    act(() => geometryApi.updateScannedElementRects([{ key: 'pen-1', rect: { ...RECT, left: 150 } }]));
    expect(Number(getByTestId('pen-anchor-0').querySelector('circle')!.getAttribute('cx')) - Number(before)).toBe(100);
  });

  it('uses the new element origin when an edit session switches keys', () => {
    mockDoc.getMap('elements').set('pen-2', (mockDoc.getMap('elements').get('pen-1') as Y.Map<unknown>).clone());
    mockDoc.getMap('sourceClasses').set('pen-2', (mockDoc.getMap('sourceClasses').get('pen-1') as Y.Map<unknown>).clone());
    const view = render(<PenOverlay {...editProps()} />);
    mockSelectedKey = 'pen-2';
    const nextRect = { ...RECT, left: 200 };
    view.rerender(<PenOverlay {...editProps(nextRect)} editingKey="pen-2" scannedElements={scannedFor(nextRect).map(el => ({ ...el, key: 'pen-2' }))} />);
    onPathEdited.mockClear();
    fireEvent.mouseDown(view.getByTestId('pen-segment-0'), anchorClient(50, 0, nextRect));
    const path = JSON.parse(onPathEdited.mock.calls[0][0].penPath);
    expect(path.anchors[1]).toMatchObject({ x: 50, y: 0 });
  });

  it('a drag gesture commits SESSION-space path in the frozen frame — classes untouched (1:1 while editing)', () => {
    const { getByTestId } = render(<PenOverlay {...editProps()} />);
    // anchor 1 at (100,0): drag +20/+10
    fireEvent.mouseDown(getByTestId('pen-anchor-1'), anchorClient(100, 0));
    fireEvent.mouseMove(document, anchorClient(120, 10));
    fireEvent.mouseUp(document, anchorClient(120, 10));

    expect(onPathEdited).toHaveBeenCalledTimes(1);
    const r = onPathEdited.mock.calls[0][0];
    expect(JSON.parse(r.penPath).anchors[1]).toMatchObject({ x: 120, y: 10 });
    expect(r.staticMarkup).toContain('viewBox="0 0 100 80"'); // frame FROZEN mid-session
    expect(r.classes).toBe('w-[100px] h-[80px] fill-gray-200 stroke-gray-900 stroke-2'); // untouched
  });

  it('exit refits ONCE: normalized penPath, bbox viewBox, refit classes, no extra undo stop', () => {
    const { getByTestId } = render(<PenOverlay {...editProps()} />);
    fireEvent.mouseDown(getByTestId('pen-anchor-1'), anchorClient(100, 0));
    fireEvent.mouseMove(document, anchorClient(120, 10));
    fireEvent.mouseUp(document, anchorClient(120, 10));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onPathEdited).toHaveBeenCalledTimes(2);
    const refit = onPathEdited.mock.calls[1][0];
    expect(JSON.parse(refit.penPath).anchors[1]).toMatchObject({ x: 120, y: 10 });
    expect(refit.staticMarkup).toContain('viewBox="0 0 120 80"');
    expect(refit.classes).toContain('w-[120px]');
    expect(refit.classes).toContain('h-[80px]');
    expect(refit.classes).toContain('fill-gray-200');
    expect(refit.takeUndoSnapshot).toBe(false); // rides the last gesture's undo step
    expect(onEditExit).toHaveBeenCalledTimes(1);
  });

  it('exiting without any gesture emits NO edit at all', () => {
    render(<PenOverlay {...editProps()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onPathEdited).not.toHaveBeenCalled();
    expect(onEditExit).toHaveBeenCalledTimes(1);
  });

  it('a DesignBar-stretched element edits 1:1 in visual space (stretch baked via viewBox)', () => {
    const rect = { top: 100, left: 50, width: 200, height: 80 }; // 2x horizontal stretch
    seedDoc('w-[200px] h-[80px] fill-gray-200 stroke-gray-900 stroke-2');
    const { getByTestId } = render(<PenOverlay {...editProps(rect)} />);
    // stored anchor 1 (100,0) renders visually at (200,0)
    fireEvent.mouseDown(getByTestId('pen-anchor-1'), anchorClient(200, 0, rect));
    fireEvent.mouseMove(document, anchorClient(210, 0, rect));
    fireEvent.mouseUp(document, anchorClient(210, 0, rect));

    const r = onPathEdited.mock.calls[0][0];
    expect(JSON.parse(r.penPath).anchors[1]).toMatchObject({ x: 210, y: 0 });
    expect(r.staticMarkup).toContain('viewBox="0 0 200 80"'); // session frame = visual box
  });

  it('deleting anchors below 2 calls onElementDeleted', () => {
    const { getByTestId } = render(<PenOverlay {...editProps()} />);
    fireEvent.mouseDown(getByTestId('pen-anchor-2'), anchorClient(50, 80));
    fireEvent.mouseUp(document, anchorClient(50, 80));
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(onPathEdited).toHaveBeenCalledTimes(1);
    expect(onElementDeleted).not.toHaveBeenCalled();

    fireEvent.mouseDown(getByTestId('pen-anchor-0'), anchorClient(0, 0));
    fireEvent.mouseUp(document, anchorClient(0, 0));
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(onElementDeleted).toHaveBeenCalledTimes(1);
  });

  it('Delete with NO selected anchor is swallowed — element survives', () => {
    render(<PenOverlay {...editProps()} />);
    fireEvent.keyDown(document, { key: 'Delete' });
    expect(onElementDeleted).not.toHaveBeenCalled();
    expect(onPathEdited).not.toHaveBeenCalled();
    expect(onEditExit).not.toHaveBeenCalled();
  });

  it('double-click on an anchor toggles corner↔smooth and commits', () => {
    const { getByTestId } = render(<PenOverlay {...editProps()} />);
    fireEvent.doubleClick(getByTestId('pen-anchor-1'), anchorClient(100, 0));
    expect(onPathEdited).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(onPathEdited.mock.calls[0][0].penPath);
    expect(parsed.anchors[1].corner).toBe(false);
    expect(parsed.anchors[1].hIn).toBeTruthy();
  });

  it('selecting a different element finishes the session (refit) and exits', () => {
    const { getByTestId, rerender } = render(<PenOverlay {...editProps()} />);
    fireEvent.mouseDown(getByTestId('pen-anchor-1'), anchorClient(100, 0));
    fireEvent.mouseMove(document, anchorClient(120, 10));
    fireEvent.mouseUp(document, anchorClient(120, 10));

    mockSelectedKey = 'other-el';
    rerender(<PenOverlay {...editProps()} />);

    expect(onPathEdited).toHaveBeenCalledTimes(2); // gesture + refit
    expect(onPathEdited.mock.calls[1][0].classes).toContain('w-[120px]');
    expect(onEditExit).toHaveBeenCalledTimes(1);
  });
});

let geometryApi: GeometryFixtureApi;
function PenOverlay({ scannedElements = [], ...props }: React.ComponentProps<typeof RealPenOverlay> & { scannedElements?: ScannedElement[] }) {
  return <SelectionGeometryFixture elements={scannedElements} selectedKey={mockSelectedKey} onReady={api => { geometryApi = api; }}><RealPenOverlay {...props} /></SelectionGeometryFixture>;
}
