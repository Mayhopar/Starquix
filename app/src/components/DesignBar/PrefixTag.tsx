import { CloseIcon as SharedCloseIcon } from '@/assets/icons';
import React from 'react';
import { useActiveState } from '@/context/StateContext';
import { useActiveBreakpoint, type BreakpointName } from '@/context/BreakpointContext';
import { useActiveTheme } from '@/context/ThemeContext';
import { useDispatch } from '@/store/hooks';
import { Button, IconButton, Tooltip } from '@/components/ui';
import type { Breakpoint as StoreBreakpoint } from '@/store/types';
import type { StateName } from '@/core/state/utils';
import type { Theme } from '@/core/classes/index';

export type TagCategory = 'state' | 'theme' | 'breakpoint';

export interface TagInfo {
  label: string;
  /** Single-axis category (BlockOverridePills). Omitted by HeaderTags composite cells. */
  category?: TagCategory;
  value: string;
}

interface PrefixTagProps {
  tag: TagInfo;
  /** Called when the × button is clicked. If omitted, no × is shown. */
  onDelete?: (tag: TagInfo) => void;
  /** Whether to stopPropagation on click (useful inside expandable rows) */
  stopPropagation?: boolean;
  /** Composite mode (HeaderTags): caller computes active + handles select itself.
   *  When omitted, PrefixTag uses its own single-axis category logic. */
  isActive?: boolean;
  onSelect?: (tag: TagInfo) => void;
  /** Override the × button title (HeaderTags: active chip = exit, not delete). */
  deleteTitle?: string;
}

export const PrefixTag: React.FC<PrefixTagProps> = ({ tag, onDelete, stopPropagation, isActive, onSelect, deleteTitle }) => {
  const { activeState, setActiveState } = useActiveState();
  const { activeBreakpoint, setActiveBreakpoint, viewportBreakpoint } = useActiveBreakpoint();
  const { activeTheme, setActiveTheme } = useActiveTheme();
  const dispatch = useDispatch();

  const composite = onSelect !== undefined;

  const computeActive = (): boolean => {
    switch (tag.category) {
      case 'state': return activeState === tag.value;
      case 'theme': return activeTheme === tag.value;
      case 'breakpoint': return viewportBreakpoint === tag.value && activeBreakpoint === tag.value;
      default: return false;
    }
  };

  const handleSelect = (e: React.MouseEvent) => {
    if (stopPropagation) e.stopPropagation();
    if (onSelect) { onSelect(tag); return; }
    const active = computeActive();
    switch (tag.category) {
      case 'state':
        setActiveState(active ? 'default' as StateName : tag.value as StateName);
        break;
      case 'theme':
        setActiveTheme(active ? 'light' as Theme : tag.value as Theme);
        break;
      case 'breakpoint':
        if (active) {
          // Go back to editing base layer, but keep viewport on current breakpoint
          setActiveBreakpoint('xs' as BreakpointName);
        } else if (viewportBreakpoint === tag.value) {
          // Viewport already on this breakpoint — just switch editing layer
          setActiveBreakpoint(tag.value as BreakpointName);
        } else {
          // Switch viewport and editing layer
          dispatch({ type: 'SET_BREAKPOINT', breakpoint: tag.value as StoreBreakpoint });
          setActiveBreakpoint(tag.value as BreakpointName);
        }
        break;
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Delete is class-removal only here. Resetting the ACTIVE editing context on
    // delete is a HeaderTags concern (it owns context-switching) — keeping it out
    // of this shared component means BlockOverridePills' × never touches context.
    onDelete?.(tag);
  };

  const active = isActive ?? computeActive();

  const tooltipByCategory: Record<TagCategory, string> = {
    state: `Has ${tag.label} state overrides\nClick to ${active ? 'edit base styles' : `edit ${tag.label} styles`}`,
    theme: `Has ${tag.label} theme overrides\nClick to ${active ? 'edit light theme' : `edit ${tag.label} theme`}`,
    breakpoint: `Has classes at ${tag.label} breakpoint\nClick to ${active ? 'edit base styles' : `edit ${tag.label} styles`}`,
  };
  // Composite cells (md:hover, dark, …) span axes, so use a generic tooltip.
  const tooltip = composite || !tag.category
    ? `Has ${tag.label} overrides\nClick to ${active ? 'edit base styles' : `edit ${tag.label} styles`}`
    : tooltipByCategory[tag.category];

  return (
    <Tooltip content={tooltip}>
    <span
      data-sq-pill
      className={`inline-flex items-center rounded transition-colors text-xs ${
        active
          ? 'bg-accent/15 text-accent border border-accent/30'
          : 'bg-transparent text-text-secondary border border-stroke hover:text-accent hover:border-accent/30'
      }`}
    >
      <Button
        variant="ghost"
        size="sm"
        label={tag.label}
        onClick={handleSelect}
        className={`h-auto rounded-none font-normal py-0.5 text-inherit hover:text-inherit bg-transparent hover:bg-transparent active:bg-transparent ${onDelete ? 'pl-1.5 pr-0.5' : 'px-2'}`}
      />
      {onDelete && (
        <IconButton
          size="sm"
          onClick={handleDelete}
          title={deleteTitle ?? `Remove all ${tag.label}: classes`}
          className="rounded-none bg-transparent hover:bg-transparent text-inherit hover:text-inherit opacity-60 hover:opacity-100"
        >
          <SharedCloseIcon className="w-4 h-4" />
        </IconButton>
      )}
    </span>
    </Tooltip>
  );
};
