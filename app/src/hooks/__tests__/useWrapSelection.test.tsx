/** Issue #5 — the one entry every "Create container" trigger calls. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';

const wrapLocalElements = vi.fn(async (_args: unknown) => true);
vi.mock('@/components/Editor/localStructuralOps', () => ({ wrapLocalElements: (args: unknown) => wrapLocalElements(args) }));

const doc = new Y.Doc();
vi.mock('@/store/hooks', () => ({ useEditorDoc: () => doc }));
const pushStructuralUndo = vi.fn();
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ pushStructuralUndo }) }));

const select = vi.fn();
let selection: { selectedKey: string | null; additionalSelections: Array<{ key: string; elementId: string | null }> };
const scannedByKey = new Map();
vi.mock('@/context/SelectionContext', () => ({
  useSelectionContext: () => ({ ...selection, select }),
  useScannedElementsRef: () => ({ scannedByKeyRef: { current: scannedByKey } }),
}));

import { markFilesTruth } from '@/utils/localMode';
import { useWrapSelection } from '../useWrapSelection';

describe('useWrapSelection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    doc.getMap('meta').set('projectId', 'p-local');
    markFilesTruth('p-local');
    selection = { selectedKey: 'a.astro:2:3', additionalSelections: [{ key: 'a.astro:4:3', elementId: null }] };
  });

  it('wraps the primary + extras with the scan, the undo stack and a deselect', () => {
    renderHook(() => useWrapSelection()).result.current();
    expect(wrapLocalElements).toHaveBeenCalledWith(expect.objectContaining({
      keys: ['a.astro:2:3', 'a.astro:4:3'], scannedByKey, pushUndo: pushStructuralUndo,
    }));
    (wrapLocalElements.mock.calls[0][0] as { deselect: () => void }).deselect();
    expect(select).toHaveBeenCalledWith(null);
  });

  it('nothing selected → nothing happens', () => {
    selection = { selectedKey: null, additionalSelections: [] };
    renderHook(() => useWrapSelection()).result.current();
    expect(wrapLocalElements).not.toHaveBeenCalled();
  });

  it('not a files-truth project (flag not read yet) → nothing happens', () => {
    doc.getMap('meta').set('projectId', 'p-unknown');
    renderHook(() => useWrapSelection()).result.current();
    expect(wrapLocalElements).not.toHaveBeenCalled();
  });
});
