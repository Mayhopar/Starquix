import { useCallback, useRef } from 'react';
import { useEditorDoc } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { useSelectionContext, useScannedElementsRef } from '@/context/SelectionContext';
import { selectProjectId } from '@/store/selectors';
import { isLocalProjectId } from '@/utils/localMode';
import { wrapLocalElements } from '@/components/Editor/localStructuralOps';

/** Issue #5 — "Create container" (or, given `unwrapLocalElement`, "Remove
 *  container") on the current selection; the one function every trigger
 *  (shortcuts, canvas and Layers menus) calls. */
export function useWrapSelection(run = wrapLocalElements): () => void {
  const doc = useEditorDoc();
  const { pushStructuralUndo } = useUndoContext();
  const { selectedKey, additionalSelections, select } = useSelectionContext();
  const { scannedByKeyRef } = useScannedElementsRef();
  const latest = useRef({ doc, pushStructuralUndo, selectedKey, additionalSelections, select });
  latest.current = { doc, pushStructuralUndo, selectedKey, additionalSelections, select };

  return useCallback(() => {
    const { doc, pushStructuralUndo, selectedKey, additionalSelections, select } = latest.current;
    // Every project the editor opens is files-truth; before its flag is read there is nothing to write to.
    if (!selectedKey || !isLocalProjectId(selectProjectId(doc) ?? '')) return;
    void run({
      keys: [selectedKey, ...additionalSelections.map(e => e.key)],
      scannedByKey: scannedByKeyRef.current,
      pushUndo: pushStructuralUndo,
      deselect: () => select(null),
    });
  }, [scannedByKeyRef, run]);
}
