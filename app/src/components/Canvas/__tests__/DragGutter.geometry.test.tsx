import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DndContext } from '@dnd-kit/core';
import { SelectionGeometryFixture, type GeometryFixtureApi } from '@/test/selectionGeometryFixture';
import { DragGutter } from '../DragGutter';
vi.mock('@/hooks', async () => {
  const { useScannedElements } = await import('@/context/SelectionContext');
  return { useReorderElements: () => ({ rootElements: useScannedElements().scannedElements }) };
});
it('moves gutter handles and selected replace control with live geometry at the current zoom', () => {
  let api: GeometryFixtureApi;
  const el = { key: 'a', parentKey: null, tagName: 'div', classes: '', hasSourceTracking: true, rect: { top: 10, left: 0, width: 100, height: 50 } };
  render(<SelectionGeometryFixture elements={[el]} selectedKey="a" onReady={value => { api = value; }}><DndContext><DragGutter scale={2} viewportFrameLeft={200} viewportFrameTop={50} viewportWidth={100} canvasContainerTop={0} /></DndContext></SelectionGeometryFixture>);
  expect(screen.getByTestId('drag-handle-0')).toHaveStyle({ top: '70px' });
  act(() => api.updateScannedElementRects([{ key: 'a', rect: { ...el.rect, top: 40 } }]));
  expect(screen.getByTestId('drag-handle-0')).toHaveStyle({ top: '130px' });
  expect(screen.getByTitle('Replace section').parentElement).toHaveStyle({ top: '130px' });
});
