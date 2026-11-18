/**
 * Generic tree multi-selection: click / shift-click range / cmd-click toggle.
 *
 * Deliberately reuses computeVisibleRange from store/multiSelect.ts rather than
 * re-deriving it — a parallel implementation of an existing behavior is the
 * mistake that cost a month once already (feedback_parity_reuse_not_parallel).
 * That module is already domain-agnostic: plain string ids in, ids out.
 *
 * State-agnostic by construction: the visible order is passed per call, so a
 * consumer whose selection lives elsewhere (Layers -> SelectionContext) can use
 * the same policy without adopting this state.
 */
import { useCallback, useMemo, useState } from 'react';
import { computeVisibleRange } from '@/store/multiSelect';

export interface RowClickModifiers {
  /** cmd / ctrl */
  toggle?: boolean;
  /** shift */
  range?: boolean;
}

export function useTreeMultiSelect(): {
  selectedIds: string[];
  anchorId: string | null;
  isSelected: (id: string) => boolean;
  onRowClick: (id: string, mods: RowClickModifiers, visibleIdsInOrder: string[]) => void;
  select: (ids: string[], anchor?: string | null) => void;
  clear: () => void;
} {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const onRowClick = useCallback((id: string, mods: RowClickModifiers, visibleIdsInOrder: string[]) => {
    if (mods.toggle) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
      setAnchorId((prev) => prev ?? id);
      return;
    }
    if (mods.range && anchorId) {
      const range = computeVisibleRange(anchorId, id, visibleIdsInOrder);
      if (range) { setSelectedIds(range); return; } // anchor stays put
    }
    setSelectedIds([id]);
    setAnchorId(id);
  }, [anchorId]);

  const select = useCallback((ids: string[], anchor: string | null = ids[0] ?? null) => {
    setSelectedIds(ids);
    setAnchorId(anchor);
  }, []);

  const clear = useCallback(() => { setSelectedIds([]); setAnchorId(null); }, []);

  return {
    selectedIds,
    anchorId,
    isSelected: useCallback((id: string) => selectedSet.has(id), [selectedSet]),
    onRowClick,
    select,
    clear,
  };
}
