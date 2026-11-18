import { useMemo, useCallback, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { useScannedElements, type ScannedElement } from '@/context/SelectionContext';
import { useUndoContext } from '@/context/UndoContext';
import { useEditorDoc, useYjsValue } from '@/store/hooks';
import { selectCurrentPageId } from '@/store/selectors';
import { parseKey } from '@/store/types';
import { isWrapperKey } from '@/store/keyKind';
import { dispatchSetChildOrder } from '@/utils/dispatchSetChildOrder';
import { acceptEditorCommands } from '@/store/commandGesture';
import type { EditorCommand } from '@/store/types';
import type { MaterializationCommand } from '@/services/durableEdits/types';
import { collectOrderCommands } from '@/utils/masterOrderWrite';

interface ReorderOptions { snapshot?: boolean; collect?: EditorCommand[]; sourceCommands?: MaterializationCommand[] }

/** Extract the Yjs element ID from a scanned element key. */
function getElementIdFromKey(key: string): string {
  const parsed = parseKey(key);
  if (!parsed) return key;

  if (parsed.type === 'instance-child' || parsed.type === 'instance-root') {
    return parsed.instanceId;
  }

  return key;
}

export function useReorderElements() {
  const { scannedElements } = useScannedElements();
  const doc = useEditorDoc();
  const currentPageId = useYjsValue(selectCurrentPageId);
  const { takeSnapshot, claimSnapshot } = useUndoContext();

  const rootElements = useMemo(() => {
    const roots = scannedElements.filter(
      (el): el is ScannedElement =>
        el.parentKey === null && (el.hasSourceTracking || el.key.startsWith('drawn-'))
    );

    // Auto-unwrap: if single root is the infrastructure container (Astro page),
    // return its children instead so users can reorder actual content
    // Note: Don't filter by hasSourceTracking here - Theme Library instances don't have
    // data-sq-source but should still be reorderable
    if (roots.length === 1 && isWrapperKey(roots[0].key)) {
      const containerKey = roots[0].key;
      return scannedElements.filter(
        (el): el is ScannedElement =>
          el.parentKey === containerKey
      );
    }

    return roots;
  }, [scannedElements]);

  // Use ref to always access latest rootElements, avoiding stale closure in callback
  const rootElementsRef = useRef(rootElements);
  rootElementsRef.current = rootElements;

  // Core of the root reorder: a full target order by KEY. Group move calls
  // this directly (snapshot: false — executeGroupMove owns the one snapshot).
  const reorderRootElementsByKeys = useCallback(
    async (orderedKeys: string[], opts?: ReorderOptions): Promise<void> => {
      if (!currentPageId) return;

      if (opts?.snapshot !== false) takeSnapshot();

      // Deduplicate: multiple instance-child keys can map to the same element ID
      const elementIds: string[] = [];
      const seen = new Set<string>();
      for (const key of orderedKeys) {
        const id = getElementIdFromKey(key);
        if (!seen.has(id)) {
          seen.add(id);
          elementIds.push(id);
        }
      }

      const action: EditorCommand = {
        type: 'REORDER_PAGE_ELEMENTS',
        pageId: currentPageId,
        elementIds,
      };
      if (opts?.collect) { opts.collect.push(action); return; }
      await acceptEditorCommands(doc, [action], claimSnapshot(), opts?.sourceCommands ?? collectOrderCommands(doc, currentPageId, orderedKeys,
        rootElementsRef.current.map(element => element.key), { rootLevel: true }));
    },
    [currentPageId, doc, takeSnapshot, claimSnapshot]
  );

  const reorderRootElements = useCallback(
    async (oldIndex: number, newIndex: number): Promise<void> => {
      const currentRootElements = rootElementsRef.current;

      if (oldIndex === newIndex) return;
      if (currentRootElements.length < 2) return;

      const reordered = arrayMove(currentRootElements, oldIndex, newIndex);
      await reorderRootElementsByKeys(reordered.map((el) => el.key));
    },
    [reorderRootElementsByKeys]
  );

  // Ref keeps the callback identity stable while still seeing fresh
  // scannedElements (rebuilt on every iframe rescan).
  const scannedElementsRef = useRef(scannedElements);
  scannedElementsRef.current = scannedElements;

  const reorderChildElements = useCallback(
    async (parentKey: string, childKeys: string[], opts?: ReorderOptions): Promise<void> => {
      if (!currentPageId) return;
      if (opts?.snapshot !== false) takeSnapshot();
      const actions: EditorCommand[] = [];
      dispatchSetChildOrder(action => { actions.push(action); return true; }, scannedElementsRef.current, currentPageId, parentKey, childKeys);
      if (opts?.collect) { opts.collect.push(...actions); return; }
      await acceptEditorCommands(doc, actions, claimSnapshot(), opts?.sourceCommands ?? collectOrderCommands(doc, currentPageId, childKeys,
        scannedElementsRef.current.filter(element => element.parentKey === parentKey).map(element => element.key), { rootLevel: false }));
    },
    [currentPageId, doc, takeSnapshot, claimSnapshot]
  );

  return {
    rootElements,
    reorderRootElements,
    reorderRootElementsByKeys,
    reorderChildElements,
  };
}
