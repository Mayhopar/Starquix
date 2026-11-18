import React, { useMemo, useCallback, useState, useRef } from 'react';
import { IconButton, Menu, MenuItem } from '@/components/ui';
import { STATE_PREFIXES } from '@/core/classes/constants';
import { useActiveState } from '@/context/StateContext';
import { useActiveTheme } from '@/context/ThemeContext';
import { useActiveBreakpoint } from '@/context/BreakpointContext';
import { useDispatch } from '@/store/hooks';
import { PrefixTag } from './PrefixTag';
import { extractCells, cellLabel, type Cell } from './variantCell';
import type { StateName } from '@/core/state/utils';
import type { Theme } from '@/core/classes/index';
import type { BreakpointName } from '@/context/BreakpointContext';
import type { Breakpoint as StoreBreakpoint } from '@/store/types';

interface HeaderTagsProps {
  classes: string;
  /** Remove all classes whose variant cell exactly equals `cell`. */
  onDeleteCell?: (cell: Cell) => void;
}

export const HeaderTags: React.FC<HeaderTagsProps> = ({ classes, onDeleteCell }) => {
  const { activeState, setActiveState } = useActiveState();
  const { activeTheme, setActiveTheme } = useActiveTheme();
  const { activeBreakpoint, setActiveBreakpoint, viewportBreakpoint } = useActiveBreakpoint();
  const dispatch = useDispatch();
  const [menuOpen, setMenuOpen] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const isActiveCell = useCallback((c: Cell) =>
    c.bp === activeBreakpoint && c.theme === activeTheme && c.state === activeState,
    [activeBreakpoint, activeTheme, activeState]);

  // Pill set = distinct override cells in the classes ∪ the active editing cell
  // (if non-base), deduped by canonical label.
  const pills = useMemo(() => {
    const cells = extractCells(classes);
    const seen = new Set(cells.map(cellLabel));
    const activeCell: Cell = { bp: activeBreakpoint, theme: activeTheme, state: activeState };
    const activeLabel = cellLabel(activeCell);
    if (activeLabel && !seen.has(activeLabel)) cells.push(activeCell);
    return cells.map(c => ({ cell: c, label: cellLabel(c) }));
  }, [classes, activeBreakpoint, activeTheme, activeState]);

  // "+" offers CELLS in two groups (user call 2026-07-03 — the editing layer
  // is explicit-only, so this menu is THE entry point for breakpoint layers):
  // 1. frame-scoped: the current viewport breakpoint (md, md:hover, …, md:dark)
  // 2. universal (no breakpoint): hover, …, dark
  // The active cell is excluded (you're already in it).
  const available = useMemo(() => {
    const cellsOf = (bp: BreakpointName): Cell[] => {
      const out: Cell[] = [];
      if (bp !== 'xs') out.push({ bp, theme: 'light', state: 'default' });
      for (const s of STATE_PREFIXES) out.push({ bp, theme: 'light', state: s });
      out.push({ bp, theme: 'dark', state: 'default' });
      return out;
    };
    const frame = viewportBreakpoint !== 'xs' ? cellsOf(viewportBreakpoint) : [];
    const universal = cellsOf('xs');
    return [
      ...frame.map((cell) => ({ group: 'frame' as const, cell, label: cellLabel(cell) })),
      ...universal.map((cell) => ({ group: 'universal' as const, cell, label: cellLabel(cell) })),
    ].filter(({ cell }) => !isActiveCell(cell));
  }, [viewportBreakpoint, isActiveCell]);

  const resetToBase = useCallback(() => {
    setActiveState('default' as StateName);
    setActiveTheme('light' as Theme);
    setActiveBreakpoint('xs' as BreakpointName);
  }, [setActiveState, setActiveTheme, setActiveBreakpoint]);

  const selectCell = useCallback((cell: Cell) => {
    if (isActiveCell(cell)) { resetToBase(); return; } // toggle the active pill back to base
    // Move the viewport to the cell's breakpoint so you SEE it (base needs no move).
    if (cell.bp !== 'xs' && cell.bp !== viewportBreakpoint)
      dispatch({ type: 'SET_BREAKPOINT', breakpoint: cell.bp as StoreBreakpoint });
    setActiveBreakpoint(cell.bp);
    setActiveTheme(cell.theme);
    setActiveState(cell.state);
  }, [isActiveCell, resetToBase, viewportBreakpoint, dispatch, setActiveBreakpoint, setActiveTheme, setActiveState]);

  // ✕ semantics (user call 2026-07-03): on the ACTIVE chip it EXITS the layer
  // and keeps the classes (delete-on-✕ silently destroyed just-made edits);
  // on an inactive pill it deletes that cell's classes (the only wholesale
  // cell-delete affordance). Exit first, delete on the second ✕.
  const handleDeleteCell = useCallback((cell: Cell) => {
    if (isActiveCell(cell)) { resetToBase(); return; }
    onDeleteCell?.(cell);
  }, [onDeleteCell, isActiveCell, resetToBase]);

  const pick = useCallback((cell: Cell) => {
    setActiveBreakpoint(cell.bp);
    setActiveTheme(cell.theme);
    setActiveState(cell.state);
    setMenuOpen(false);
  }, [setActiveBreakpoint, setActiveTheme, setActiveState]);

  return (
    <div className="flex items-center gap-1 flex-wrap relative">
      {pills.map(({ cell, label }) => (
        <PrefixTag
          key={label}
          tag={{ label, value: label }}
          isActive={isActiveCell(cell)}
          onSelect={() => selectCell(cell)}
          onDelete={onDeleteCell ? () => handleDeleteCell(cell) : undefined}
          deleteTitle={isActiveCell(cell) ? `Exit ${label} — classes are kept` : undefined}
        />
      ))}
      {available.length > 0 && (
        <IconButton
          ref={addBtnRef}
          size="sm"
          data-testid="add-state-btn"
          onClick={() => setMenuOpen(o => !o)}
          title="Add a breakpoint/state/theme layer to edit"
          className="text-sm leading-none"
        >
          +
        </IconButton>
      )}
      {available.length > 0 && (
        <Menu
          isOpen={menuOpen}
          onClose={() => setMenuOpen(false)}
          triggerRef={addBtnRef}
          placement="bottom-start"
        >
          {available.map(({ group, cell, label }, i) => (
            <React.Fragment key={label}>
              {/* divider where the frame-scoped group ends and universal begins */}
              {i > 0 && group === 'universal' && available[i - 1].group === 'frame' && (
                <div className="my-1 border-t border-stroke" />
              )}
              <MenuItem label={label} onSelect={() => pick(cell)} />
            </React.Fragment>
          ))}
        </Menu>
      )}
    </div>
  );
};
