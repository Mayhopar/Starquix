import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { SelectionProvider, useScannedElements, useScannedElementsRef, useSelectionContext, useRectHover, type ScannedElement } from '../SelectionContext';
const wrapper = ({ children }: { children: ReactNode }) => <SelectionProvider>{children}</SelectionProvider>;
const makeElement = (key: string, parentKey: string | null = null): ScannedElement => ({ key, parentKey, tagName: 'div', classes: '', rect: { top: 0, left: 0, width: 100, height: 100 }, hasSourceTracking: true });
const useState = () => ({ ...useScannedElements(), ...useScannedElementsRef(), ...useSelectionContext(), ...useRectHover() });
it('rect patches keep structural snapshots and trees idle while both refs refresh before returning', () => {
  let renders = 0;
  const { result } = renderHook(() => { renders++; return useState(); }, { wrapper });
  act(() => result.current.setScannedElements([makeElement('a'), makeElement('b', 'a')]));
  const previous = result.current.scannedElements, tree = result.current.treeNodes, before = renders;
  act(() => {
    result.current.updateScannedElementRects([{ key: 'a', rect: { ...previous[0].rect, width: 120 } }]);
    result.current.updateScannedElementRects([{ key: 'b', rect: { ...previous[1].rect, top: 40 } }]);
    expect(result.current.scannedElementsRef.current[0].rect.width).toBe(120);
    expect(result.current.scannedByKeyRef.current.get('b')?.rect.top).toBe(40);
  });
  expect(result.current.treeNodes).toBe(tree); expect(renders).toBe(before);
  expect(previous[0].rect.width).toBe(100); expect(result.current.scannedElements).toBe(previous);
  act(() => result.current.select('b', { rect: result.current.scannedByKeyRef.current.get('b')!.rect }));
  expect(result.current.selectedRect?.top).toBe(40);
});
it('full geometry-only scans preserve tree identity and unknown/equal patches preserve refs', () => {
  const { result } = renderHook(useState, { wrapper });
  act(() => result.current.setScannedElements([makeElement('a')])); const tree = result.current.treeNodes;
  act(() => result.current.setScannedElements([{ ...makeElement('a'), rect: { top: 20, left: 0, width: 100, height: 100 } }]));
  expect(result.current.treeNodes).toBe(tree);
  const refs = result.current.scannedElementsRef.current;
  act(() => result.current.updateScannedElementRects([{ key: 'unknown', rect: makeElement('x').rect }, { key: 'a', rect: refs[0].rect }]));
  expect(result.current.scannedElementsRef.current).toBe(refs);
});
it.each<Partial<ScannedElement>>([
  { parentKey: 'parent' }, { key: 'new' }, { textContent: 'changed' }, { componentName: 'Hero' }, { componentSrc: '/hero.astro' },
  { usageLocation: { file: '/page.astro', line: 2, column: 3 } }, { mediaUnit: { bodyLine: 2, bodyEnd: 4 } },
  { imageSrc: '/image.png' }, { boundAssetPath: '/asset.png' }, { ownerComponentFile: '/owner.astro' }, { imageComponentIndex: 1 }, { legacyKeys: ['old'] },
  { layout: 'flex-row' }, { layout: 'grid-column' },
])('publishes metadata change %j even with unchanged geometry', change => {
  const { result } = renderHook(useState, { wrapper });
  act(() => result.current.setScannedElements([makeElement('a')])); const tree = result.current.treeNodes;
  act(() => result.current.setScannedElements([{ ...makeElement('a'), ...change }]));
  expect(result.current.treeNodes).not.toBe(tree); expect(result.current.scannedElements[0]).toMatchObject(change);
});

it('keeps tree layout icons in sync with a layout-only scan change', () => {
  const { result } = renderHook(useState, { wrapper });
  act(() => result.current.setScannedElements([{ ...makeElement('a'), layout: 'flex-row' }]));
  expect(result.current.treeNodes[0].layout).toBe('flex-row');
  act(() => result.current.setScannedElements([{ ...makeElement('a'), layout: 'flex-column' }]));
  expect(result.current.treeNodes[0].layout).toBe('flex-column');
  act(() => result.current.setScannedElements([makeElement('a')]));
  expect(result.current.treeNodes[0].layout).toBeUndefined();
});
