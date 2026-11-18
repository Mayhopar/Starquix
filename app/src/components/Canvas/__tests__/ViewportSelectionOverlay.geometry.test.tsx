import { act, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
// MultiSelectionRects reads each outline's colour from the doc (selectionVariantForKey).
vi.mock('@/store/hooks', async (importOriginal) => {
  const Y = await import('yjs'); const doc = new Y.Doc();
  return { ...await importOriginal<typeof import('@/store/hooks')>(), useEditorDoc: () => doc,
    useYjsValue: <T,>(selector: (d: import('yjs').Doc) => T) => selector(doc) };
});
import { useEffect } from 'react';
import { SelectionProvider, useScannedElements, useRectHover, useElementGeometry, useRectActions } from '@/context/SelectionContext';
import { ViewportSelectionOverlay } from '../ViewportSelectionOverlay';
import { MultiSelectionRects } from '../MultiSelectionRects';
import { useSelectionContext } from '@/context/SelectionContext';
let api: ReturnType<typeof useScannedElements> & ReturnType<typeof useSelectionContext> & ReturnType<typeof useRectActions>;
function Driver() { api = { ...useScannedElements(), ...useSelectionContext(), ...useRectActions() }; return null; }
const el = { key: 'a', tagName: 'div', classes: '', parentKey: null, hasSourceTracking: true, rect: { top: 10, left: 20, width: 100, height: 50 } };
it('updates the real connected selection overlay without rendering or remounting its stable-action host', () => {
  let renders = 0, mounts = 0;
  function Host() {
    useRectActions(); renders++;
    useEffect(() => { mounts++; }, []);
    return <><iframe title="host" /><ViewportSelectionOverlay suppressRect={false} scale={1} containerOffset={{ x: 0, y: 0 }} /></>;
  }
  const view = render(<SelectionProvider><Driver /><Host /></SelectionProvider>);
  const host = screen.getByTitle('host'); const before = renders;
  act(() => api.updateSelectionRect(el.rect));
  expect(view.container.querySelector('[data-handle="se"]')).toBeTruthy();
  expect(renders).toBe(before); expect(mounts).toBe(1); expect(screen.getByTitle('host')).toBe(host);
});
it('keeps additional selection outlines live after structural snapshots stop changing', () => {
  render(<SelectionProvider><Driver /><MultiSelectionRects containerOffset={{ x: 3, y: 4 }} /></SelectionProvider>);
  act(() => { api.setScannedElements([el]); api.addAdditionalSelection({ key: 'a', elementId: null }); });
  expect(screen.getByTestId('multi-select-rect')).toHaveStyle({ width: '100px', top: '14px' });
  act(() => api.updateScannedElementRects([{ key: 'a', rect: { ...el.rect, width: 140, top: 30 } }]));
  expect(screen.getByTestId('multi-select-rect')).toHaveStyle({ width: '140px', top: '34px' });
  act(() => api.setScannedElements([])); expect(screen.queryByTestId('multi-select-rect')).toBeNull();
});
it('isolates geometry between providers and handles a subscriber changing keys', () => {
  function Read({ name, elementKey }: { name: string; elementKey: string | null }) {
    const rect = useElementGeometry(elementKey); return <output data-testid={name}>{rect?.width ?? 'none'}</output>;
  }
  const view = render(<><SelectionProvider><Driver /><Read name="first" elementKey="a" /></SelectionProvider><SelectionProvider><Read name="second" elementKey="a" /></SelectionProvider></>);
  act(() => api.setScannedElements([el]));
  expect(screen.getByTestId('first')).toHaveTextContent('100'); expect(screen.getByTestId('second')).toHaveTextContent('none');
  view.rerender(<><SelectionProvider><Driver /><Read name="first" elementKey={null} /></SelectionProvider><SelectionProvider><Read name="second" elementKey="a" /></SelectionProvider></>);
  expect(screen.getByTestId('first')).toHaveTextContent('none');
});
it('recomputes synthetic layout unions from patched roots and removes deleted geometry', async () => {
  const { LayoutSelectionGeometry, ElementGeometryOverlay } = await import('../ViewportSelectionOverlay');
  function Rect() { const { selectedRect } = useRectHover(); return <output data-testid="union">{JSON.stringify(selectedRect)}</output>; }
  render(<SelectionProvider><Driver /><LayoutSelectionGeometry layoutRootKey="layoutchrome-page" /><Rect /><ElementGeometryOverlay elementKey="a">{rect => <output data-testid="empty-image">{rect.width}</output>}</ElementGeometryOverlay></SelectionProvider>);
  act(() => api.setScannedElements([el, { ...el, key: 'b', rect: { top: 100, left: 20, width: 100, height: 50 } }]));
  expect(screen.getByTestId('union')).toHaveTextContent('"height":140');
  act(() => api.updateScannedElementRects([{ key: 'b', rect: { top: 200, left: 20, width: 100, height: 50 } }, { key: 'a', rect: { ...el.rect, width: 140 } }]));
  expect(screen.getByTestId('union')).toHaveTextContent('"height":240'); expect(screen.getByTestId('empty-image')).toHaveTextContent('140');
  act(() => api.setScannedElements([])); expect(screen.getByTestId('union')).toHaveTextContent('null');
});
// Regression (filmstrip 2026-11-08): a hidden/detached selection measures 0×0 at
// the frame origin and drew a stray handle dot in the canvas corner.
it('draws no selection box for a zero-size rect', () => {
  const view = render(<SelectionProvider><Driver /><ViewportSelectionOverlay suppressRect={false} scale={1} containerOffset={{ x: 0, y: 0 }} /></SelectionProvider>);
  act(() => api.updateSelectionRect({ top: 0, left: 0, width: 0, height: 0 }));
  expect(view.container.querySelector('[data-handle="se"]')).toBeNull();
  act(() => api.updateSelectionRect(el.rect));
  expect(view.container.querySelector('[data-handle="se"]')).toBeTruthy();
});
