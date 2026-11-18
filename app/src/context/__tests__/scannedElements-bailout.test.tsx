/**
 * Perf regression guard (perf queue 2026-06-10, item 3): a no-op rescan
 * (identical elements, incl. rects) must NOT publish a new scannedElements
 * identity — before the fix every ELEMENTS_SCANNED produced a fresh array,
 * rebuilding treeNodes/scannedByKey and re-rendering every
 * ScannedElementsContext consumer (Editor, DesignBar, ElementsTree,
 * ViewportFrame) even when nothing changed.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, render, act } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import {
  SelectionProvider,
  useScannedElements,
  useScannedElementsRef,
  scannedElementsShallowEqual,
} from '../SelectionContext';
import type { ScannedElement } from '../SelectionContext';

const wrapper = ({ children }: { children: ReactNode }) => (
  <SelectionProvider>{children}</SelectionProvider>
);

const el = (
  key: string,
  overrides: Partial<ScannedElement> = {}
): ScannedElement => ({
  key,
  parentKey: null,
  tagName: 'div',
  classes: '',
  rect: { top: 0, left: 0, width: 10, height: 10 },
  hasSourceTracking: true,
  ...overrides,
});

describe('scannedElementsShallowEqual', () => {
  it.each(['sourceLocation', 'usageLocation'] as const)('publishes a changed %s revision when identical source bytes were reordered', field => {
    const location = { file: 'src/pages/index.astro', line: 1, column: 1, sourceVersion: 's1:10' };
    expect(scannedElementsShallowEqual(
      [el('a', { [field]: { ...location, sourceRevision: 1 } })],
      [el('a', { [field]: { ...location, sourceRevision: 2 } })],
    )).toBe(false);
  });
  it.each(['sourceLocation', 'usageLocation'] as const)('publishes a changed %s source version even when coordinates match', field => {
    const location = { file: 'src/pages/index.astro', line: 1, column: 1 };
    expect(scannedElementsShallowEqual(
      [el('a', { [field]: { ...location, sourceVersion: 's1:10' } })],
      [el('a', { [field]: { ...location, sourceVersion: 's2:10' } })],
    )).toBe(false);
  });
  it('equal arrays → true', () => {
    expect(scannedElementsShallowEqual([el('a'), el('b')], [el('a'), el('b')])).toBe(true);
  });

  it('rect change → false', () => {
    expect(
      scannedElementsShallowEqual(
        [el('a')],
        [el('a', { rect: { top: 5, left: 0, width: 10, height: 10 } })]
      )
    ).toBe(false);
  });

  it('length change → false', () => {
    expect(scannedElementsShallowEqual([el('a')], [el('a'), el('b')])).toBe(false);
  });

  it('classes change → false', () => {
    expect(scannedElementsShallowEqual([el('a')], [el('a', { classes: 'p-4' })])).toBe(false);
  });

  it('textContent change → false', () => {
    expect(
      scannedElementsShallowEqual([el('a', { textContent: 'x' })], [el('a', { textContent: 'y' })])
    ).toBe(false);
  });

  it('sourceLocation change → false', () => {
    expect(
      scannedElementsShallowEqual(
        [el('a', { sourceLocation: { file: 'f.astro', line: 1, column: 1 } })],
        [el('a', { sourceLocation: { file: 'f.astro', line: 2, column: 1 } })]
      )
    ).toBe(false);
  });

  it('one-sided sourceLocation → false', () => {
    expect(
      scannedElementsShallowEqual(
        [el('a', { sourceLocation: { file: 'f.astro', line: 1, column: 1 } })],
        [el('a')]
      )
    ).toBe(false);
  });

  it('usageLocation change → false (lock-tier badge would go stale)', () => {
    expect(
      scannedElementsShallowEqual(
        [el('a', { usageLocation: { file: 'p.astro', line: 1, column: 1 } })],
        [el('a', { usageLocation: { file: 'p.astro', line: 2, column: 1 } })]
      )
    ).toBe(false);
  });

  it('one-sided usageLocation → false', () => {
    expect(
      scannedElementsShallowEqual(
        [el('a', { usageLocation: { file: 'p.astro', line: 1, column: 1 } })],
        [el('a')]
      )
    ).toBe(false);
  });
});

describe('setScannedElements no-op bail-out', () => {
  it('keeps the same array identity for an equal rescan', () => {
    const { result } = renderHook(() => useScannedElements(), { wrapper });

    act(() => {
      result.current.setScannedElements([el('a'), el('b', { parentKey: 'a' })]);
    });
    const firstPublished = result.current.scannedElements;
    const firstTree = result.current.treeNodes;
    expect(firstPublished).toHaveLength(2);

    // Same content, new array/object identities — must NOT publish
    act(() => {
      result.current.setScannedElements([el('a'), el('b', { parentKey: 'a' })]);
    });
    expect(result.current.scannedElements).toBe(firstPublished);
    expect(result.current.treeNodes).toBe(firstTree);
  });

  it('publishes when content actually changes', () => {
    const { result } = renderHook(() => useScannedElements(), { wrapper });

    act(() => {
      result.current.setScannedElements([el('a')]);
    });
    const firstPublished = result.current.scannedElements;

    act(() => {
      result.current.setScannedElements([el('a', { classes: 'mt-2' })]);
    });
    expect(result.current.scannedElements).not.toBe(firstPublished);
    expect(result.current.scannedElements[0].classes).toBe('mt-2');
  });
});

describe('useScannedElementsRef', () => {
  it('refs expose fresh scan data (elements, byKey map, tree nodes)', () => {
    const { result } = renderHook(
      () => ({
        setScannedElements: useScannedElements().setScannedElements,
        refs: useScannedElementsRef(),
      }),
      { wrapper }
    );

    expect(result.current.refs.scannedElementsRef.current).toHaveLength(0);

    act(() => {
      result.current.setScannedElements([el('a'), el('b', { parentKey: 'a' })]);
    });

    expect(result.current.refs.scannedElementsRef.current).toHaveLength(2);
    expect(result.current.refs.scannedByKeyRef.current.get('b')?.parentKey).toBe('a');
    expect(result.current.refs.treeNodesRef.current.length).toBeGreaterThan(0);
  });

  it('a ref-only consumer renders exactly once across scans', () => {
    let setter: ((els: ReturnType<typeof el>[]) => void) | null = null;

    const Capture: React.FC = () => {
      const { setScannedElements } = useScannedElements();
      setter = setScannedElements;
      return null;
    };

    let probeRenders = 0;
    const Probe: React.FC = () => {
      useScannedElementsRef();
      probeRenders++;
      return null;
    };

    render(
      <SelectionProvider>
        <Capture />
        <Probe />
      </SelectionProvider>
    );
    const baseline = probeRenders;

    act(() => {
      setter!([el('a')]);
    });
    act(() => {
      setter!([el('a', { classes: 'p-2' })]);
    });

    expect(probeRenders).toBe(baseline);
  });
});
