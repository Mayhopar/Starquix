import { SelectionGeometryFixture, type GeometryFixtureApi } from '@/test/selectionGeometryFixture';
import { act } from '@testing-library/react';
import type { ScannedElement } from '@/context/SelectionContext';
// task-069 A3: the draw-time instance lock is wired from DrawOverlay into
// findInsertionTarget. We assert the WIRING (the 3rd `lockInstances` arg equals
// the `lockInstanceParenting` prop), not pointer-drag behavior — the skip/keep
// logic itself is covered by smartInsertion.test.ts. ledger F5: lock OFF in the
// component editor (Canvas passes false there); ON on real pages.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { DrawOverlay as RealDrawOverlay } from '../DrawOverlay';
import { findInsertionTarget } from '@/utils/smartInsertion';

vi.mock('@/utils/smartInsertion', () => ({
  findInsertionTarget: vi.fn(() => ({ parentKey: null, insertIndex: 0, relativeX: 0, relativeY: 0 })),
}));

// Force the draw tool so the overlay renders and the commit path runs.
vi.mock('@/context/ToolContext', () => ({
  useTool: () => ({ activeTool: 'frame', setActiveTool: vi.fn() }),
}));

const baseProps = {
  scale: 1,
  position: { x: 0, y: 0 },
  canvasWidth: 375,
  viewportWidth: 375,
  scannedElements: [],
  onElementCreated: vi.fn(),
};

function drawOnce(container: HTMLElement) {
  const overlay = container.querySelector('.z-40') as HTMLElement;
  fireEvent.mouseDown(overlay, { clientX: 0, clientY: 0 });
  fireEvent.mouseMove(overlay, { clientX: 100, clientY: 100 });
  fireEvent.mouseUp(overlay, { clientX: 100, clientY: 100 });
}

describe('DrawOverlay — instance-lock wiring', () => {
  beforeEach(() => vi.mocked(findInsertionTarget).mockClear());

  it('passes lockInstanceParenting=true as the 3rd arg to findInsertionTarget', () => {
    const { container } = render(<DrawOverlay {...baseProps} lockInstanceParenting={true} />);
    drawOnce(container);
    expect(findInsertionTarget).toHaveBeenCalledWith(expect.any(Object), [], true);
  });

  it('passes lockInstanceParenting=false as the 3rd arg to findInsertionTarget', () => {
    const { container } = render(<DrawOverlay {...baseProps} lockInstanceParenting={false} />);
    drawOnce(container);
    expect(findInsertionTarget).toHaveBeenCalledWith(expect.any(Object), [], false);
  });
});

let geometryApi: GeometryFixtureApi;
function DrawOverlay({ scannedElements = [], ...props }: React.ComponentProps<typeof RealDrawOverlay> & { scannedElements?: ScannedElement[] }) {
  return <SelectionGeometryFixture elements={scannedElements}  onReady={api => { geometryApi = api; }}><RealDrawOverlay {...props} /></SelectionGeometryFixture>;
}

it('hit-tests fresh provider geometry when drawing after a rect-only update', async () => {
  const actual = await vi.importActual<typeof import('@/utils/smartInsertion')>('@/utils/smartInsertion');
  vi.mocked(findInsertionTarget).mockImplementation(actual.findInsertionTarget);
  baseProps.onElementCreated.mockClear();
  const element: ScannedElement = { key: 'parent', parentKey: null, tagName: 'div', classes: '', hasSourceTracking: true, rect: { top: 0, left: 0, width: 200, height: 200 } };
  const { container } = render(<DrawOverlay {...baseProps} scannedElements={[element]} />);
  act(() => geometryApi.updateScannedElementRects([{ key: 'parent', rect: { ...element.rect, top: 500 } }]));
  drawOnce(container);
  expect(baseProps.onElementCreated.mock.calls[0][0].parentKey).toBeNull();
});
