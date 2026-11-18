import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { SelectionProvider, useSelectionContext, useScannedElements, type ScannedElement } from './SelectionContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SelectionProvider>{children}</SelectionProvider>
);

describe('multi-selection extension set', () => {
  it('starts empty and adds entries via addAdditionalSelection', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    expect(result.current.additionalSelections).toEqual([]);
    act(() => {
      result.current.select('el-anchor');
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
    });
    expect(result.current.additionalSelections).toEqual([{ key: 'el-b', elementId: 'el-b' }]);
  });

  it('addAdditionalSelection dedupes by key and never adds the primary', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    act(() => {
      result.current.select('el-anchor');
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
      result.current.addAdditionalSelection({ key: 'el-anchor', elementId: 'el-anchor' });
    });
    expect(result.current.additionalSelections).toHaveLength(1);
  });

  it('removeAdditionalSelection removes by key', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    act(() => {
      result.current.select('el-anchor');
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
      result.current.removeAdditionalSelection('el-b');
    });
    expect(result.current.additionalSelections).toEqual([]);
  });

  it('select() of a different key collapses the extension set', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    act(() => {
      result.current.select('el-anchor');
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
      result.current.select('el-other');
    });
    expect(result.current.additionalSelections).toEqual([]);
    expect(result.current.selectedKey).toBe('el-other');
  });

  it('clearSelection() clears the extension set', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    act(() => {
      result.current.select('el-anchor');
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
      result.current.clearSelection();
    });
    expect(result.current.additionalSelections).toEqual([]);
  });

  it('clearAdditionalSelections() keeps the primary', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    act(() => {
      result.current.select('el-anchor');
      result.current.addAdditionalSelection({ key: 'el-b', elementId: 'el-b' });
      result.current.clearAdditionalSelections();
    });
    expect(result.current.additionalSelections).toEqual([]);
    expect(result.current.selectedKey).toBe('el-anchor');
  });

  it('select() still refuses infra keys (invariant untouched)', () => {
    const { result } = renderHook(() => useSelectionContext(), { wrapper });
    act(() => {
      result.current.select('src/pages/preview/[projectId]/[pageId].astro:17:29');
    });
    expect(result.current.selectedKey).toBeNull();
  });
});

const el = (key: string, tagName = 'p'): ScannedElement => ({
  key, tagName, classes: '', rect: { top: 0, left: 0, width: 10, height: 10 }, parentKey: null, hasSourceTracking: true,
});
const free = { isLocked: () => false };

function setupToggle(keys = ['el-a', 'el-b', 'el-c']) {
  const r = renderHook(() => ({ sel: useSelectionContext(), scan: useScannedElements() }), { wrapper });
  act(() => r.result.current.scan.setScannedElements(keys.map(k => el(k))));
  return r;
}

describe('toggleInSelection (ledger §1)', () => {
  it('joins and leaves — several toggles inside ONE act stay consistent', () => {
    const { result } = setupToggle();
    act(() => {
      result.current.sel.select('el-a');
      result.current.sel.toggleInSelection('el-b', free);
      result.current.sel.toggleInSelection('el-c', free);
      result.current.sel.toggleInSelection('el-b', free);
    });
    expect(result.current.sel.selectedKey).toBe('el-a');
    expect(result.current.sel.additionalSelections.map(e => e.key)).toEqual(['el-c']);
  });

  it('the primary leaves: the earliest-added extra becomes primary, the rest stay', () => {
    const { result } = setupToggle();
    act(() => {
      result.current.sel.select('el-a');
      result.current.sel.toggleInSelection('el-b', free);
      result.current.sel.toggleInSelection('el-c', free);
    });
    act(() => { result.current.sel.toggleInSelection('el-a', free); });
    expect(result.current.sel.selectedKey).toBe('el-b');
    expect(result.current.sel.additionalSelections.map(e => e.key)).toEqual(['el-c']);
  });

  it('the sole selection deselects', () => {
    const { result } = setupToggle();
    act(() => { result.current.sel.select('el-a'); });
    act(() => { result.current.sel.toggleInSelection('el-a', free); });
    expect(result.current.sel.selectedKey).toBeNull();
  });

  it("nothing selected → returns 'select' and changes nothing", () => {
    const { result } = setupToggle();
    let decision = '';
    act(() => { decision = result.current.sel.toggleInSelection('el-a', free); });
    expect(decision).toBe('select');
    expect(result.current.sel.selectedKey).toBeNull();
  });

  it("a locked candidate → 'none', selection unchanged", () => {
    const { result } = setupToggle();
    act(() => { result.current.sel.select('el-a'); });
    let decision = '';
    act(() => { decision = result.current.sel.toggleInSelection('el-b', { isLocked: k => k === 'el-b' }); });
    expect(decision).toBe('none');
    expect(result.current.sel.additionalSelections).toEqual([]);
  });
});

describe('same-line key shifts (ledger E7)', () => {
  const F = 'src/pages/index.astro';
  it('extras and the primary follow while several are selected', () => {
    const { result } = renderHook(() => ({ sel: useSelectionContext(), scan: useScannedElements() }), { wrapper });
    act(() => result.current.scan.setScannedElements([el(`${F}:7:6`, 'span'), el(`${F}:7:36`, 'span')]));
    act(() => {
      result.current.sel.select(`${F}:7:36`);
      result.current.sel.toggleInSelection(`${F}:7:6`, free);
    });
    act(() => result.current.scan.setScannedElements([el(`${F}:7:6`, 'span'), el(`${F}:7:48`, 'span')]));
    expect(result.current.sel.selectedKey).toBe(`${F}:7:48`);
    expect(result.current.sel.additionalSelections.map(e => e.key)).toEqual([`${F}:7:6`]);
  });
  it('a single selection never relinks (unchanged behaviour)', () => {
    const { result } = renderHook(() => ({ sel: useSelectionContext(), scan: useScannedElements() }), { wrapper });
    act(() => result.current.scan.setScannedElements([el(`${F}:7:6`, 'span'), el(`${F}:7:36`, 'span')]));
    act(() => { result.current.sel.select(`${F}:7:36`); });
    act(() => result.current.scan.setScannedElements([el(`${F}:7:6`, 'span'), el(`${F}:7:48`, 'span')]));
    expect(result.current.sel.selectedKey).toBe(`${F}:7:36`);
  });
});
