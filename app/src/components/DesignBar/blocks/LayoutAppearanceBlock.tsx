/**
 * Layout & Appearance Block - Combined block for layout and sizing controls
 *
 * Hierarchy:
 * 1. Display (Flex/Grid/Other selector)
 * 2. Size (W/H inputs without title)
 * 3. Aspect Ratio (segmented control, custom dropdown)
 * 4. Direction (segmented control) + Wrap button (left side with ml-1)
 * 5. Gap (full width input)
 * 6. Alignment (3x3 grid)
 */

import React, { useCallback, useContext, useMemo, useState, useEffect, useRef } from 'react';
import { GestureHostContext, getGestureScope, useValueGesture } from '@/components/ui/valueGesture';
import { useSelectedRectOptional } from '@/context/SelectionContext';
import { findClass, setClass, parseDimension } from '../utils';
import { deriveAxisPlacement, buildAxisEdit, axisEditTokens } from './gridPlacement';
import { resolveToClass } from '@/core/classes/vocabulary';
import { SegmentedControl, Popover, Field, IconButton, MenuItem, fieldBox } from '@/components/ui';
import { useMixedValue, useMultiMembers, ownsGroups, type Owns } from '../multi/mixed';
import {
  WrapIcon,
  GapIcon,
  GapXIcon,
  GapYIcon,
  YxGapIcon,
  ArrowRightIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  AlignItemsStartIcon,
  AlignItemsCenterIcon,
  AlignItemsEndIcon,
  AlignItemsStretchIcon,
  FixedWidthIcon,
  HugIcon,
  FillIcon,
  ChevronDownIcon,
  MinWidthIcon,
  MaxWidthIcon,
  RatioIcon,
  DotIcon,
  ColumnsIcon,
  RowsIcon,
  ColStartIcon,
  ColEndIcon,
  RowStartIcon,
  RowEndIcon
} from '@/assets/icons';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Handle arrow key increment/decrement for numeric inputs
 */
const handleArrowKeys = (
  e: React.KeyboardEvent<HTMLInputElement>,
  currentValue: string,
  onChange: (value: string) => void,
  min: number = 1,
  max: number = 12
) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = e.shiftKey ? 5 : 1;
    const numValue = parseInt(currentValue, 10) || 0;
    let newValue = e.key === 'ArrowUp' ? numValue + step : numValue - step;
    // Clamp to min/max
    newValue = Math.max(min, Math.min(max, newValue));
    onChange(newValue.toString());
  }
};

// ============================================================================
// Types
// ============================================================================

type SizeMode = 'fixed' | 'hug' | 'fill' | 'auto';
type Dimension = 'w' | 'h';

interface Length { value: number; unit: string }

interface SizeState {
  mode: SizeMode;
  value: number | null;
  unit: string;
  /** value -1: a constraint with no number (max-w-full, max-w-none…) */
  minValue: Length | null;
  maxValue: Length | null;
}

/** The units W / H and their min / max offer. */
const SIZE_UNITS = ['px', '%', 'vw', 'vh'];
/** A Mixed constraint's field: no own value. */
const NO_LENGTH: Length = { value: 0, unit: 'px' };
/** `50`, `50%`, `100vh`: a typed size; a bare number keeps the field's unit. */
const TYPED_LENGTH = new RegExp(`^(\\d*\\.?\\d+)\\s*(${SIZE_UNITS.join('|')})?$`, 'i');

// ============================================================================
// Constants
// ============================================================================

// Display mode options
const layoutModeOptions = [
  { value: 'flex', label: 'Flex' },
  { value: 'grid', label: 'Grid' },
  {
    value: 'other',
    label: 'Other',
    dropdown: [
      { value: 'block', label: 'Block' },
      { value: 'inline', label: 'Inline' },
      { value: 'inline-block', label: 'Inline Block' },
      { value: 'inline-flex', label: 'Inline Flex' },
      { value: 'inline-grid', label: 'Inline Grid' }
    ]
  }
];

const OTHER_DISPLAY_VALUES = ['block', 'inline', 'inline-block', 'inline-flex', 'inline-grid'];

// What the writers set and remove
const DIRECTION_RE = /^flex-(row|row-reverse|col|col-reverse)$/;
const JUSTIFY_RE = /^justify-(start|center|end|between|around|evenly)$/;
const ITEMS_RE = /^items-(start|center|end|stretch|baseline)$/;

// Alignment values
const JUSTIFY_VALUES = ['justify-start', 'justify-center', 'justify-end'] as const;
const ITEMS_VALUES = ['items-start', 'items-center', 'items-end'] as const;
const ITEMS_STRETCH = 'items-stretch';
const ITEMS_ICONS = [AlignItemsStartIcon, AlignItemsCenterIcon, AlignItemsEndIcon] as const;
const STRETCH_ICON = AlignItemsStretchIcon;

// ============================================================================
// Size Parsing Helpers
// ============================================================================

/** The bare `prefix-` token as a length in one of SIZE_UNITS (`w-[50%]`, `w-80` = 320px, `w-screen` = 100vw); null otherwise. */
const parseLength = (classes: string, prefix: Parameters<typeof parseDimension>[1]): Length | null => {
  const { value, unit } = parseDimension(classes, prefix);
  return value !== null && SIZE_UNITS.includes(unit) ? { value, unit } : null;
};

const parseSizeState = (classes: string, dim: Dimension): SizeState => {
  const base = { value: null, unit: 'px', minValue: parseConstraint(classes, dim, 'min'), maxValue: parseConstraint(classes, dim, 'max') };
  if (findClass(classes, new RegExp(`^${dim}-full$`)) || findClass(classes, /^(flex-1|grow)$/)) return { ...base, mode: 'fill' };
  if (findClass(classes, new RegExp(`^${dim}-(fit|min)$`))) return { ...base, mode: 'hug' };
  const fixed = parseLength(classes, dim);
  return fixed ? { ...base, mode: 'fixed', ...fixed } : { ...base, mode: 'auto' };
};

// Named max-width values in pixels (1rem = 16px)
const NAMED_MAX_WIDTH_PX: Record<string, number> = {
  'xs': 320,      // 20rem
  'sm': 384,      // 24rem
  'md': 448,      // 28rem
  'lg': 512,      // 32rem
  'xl': 576,      // 36rem
  '2xl': 672,     // 42rem
  '3xl': 768,     // 48rem
  '4xl': 896,     // 56rem
  '5xl': 1024,    // 64rem
  '6xl': 1152,    // 72rem
  '7xl': 1280,    // 80rem
  'prose': 1040,  // 65ch ≈ 65 * 16px
  'screen-sm': 640,
  'screen-md': 768,
  'screen-lg': 1024,
  'screen-xl': 1280,
  'screen-2xl': 1536,
};

// The bare token only: `classes` is the active layer's, so a token still carrying a variant
// (group-open:max-h-96, max-md:max-w-full) is a state the bar does not edit — never read or replace it.
const parseConstraint = (classes: string, dim: Dimension, type: 'min' | 'max'): Length | null => {
  const prefix = `${type}-${dim}` as const;
  // Keywords: max-w-full, max-w-min, max-w-max, max-w-none, min-w-full — a constraint with no number
  if (findClass(classes, new RegExp(`^${prefix}-(full|min|max|none|fit)$`))) return { value: -1, unit: 'px' };

  // Named sizes: max-w-md, max-w-screen-lg, etc. (max-w only, not min-w)
  if (type === 'max') {
    for (const [name, px] of Object.entries(NAMED_MAX_WIDTH_PX)) {
      if (findClass(classes, new RegExp(`^${prefix}-${name}$`))) return { value: px, unit: 'px' };
    }
  }
  return parseLength(classes, prefix);
};

const parseAspectRatio = (classes: string): { scale: string; arbitrary: string | null } => {
  const arbitraryToken = findClass(classes, /^aspect-\[.+\]$/);
  if (arbitraryToken) {
    const match = arbitraryToken.match(/^aspect-\[(.+)\]$/);
    return { scale: 'custom', arbitrary: match ? match[1] : null };
  }

  if (findClass(classes, /^aspect-auto$/)) {
    return { scale: '', arbitrary: null };
  }

  if (findClass(classes, /^aspect-square$/)) {
    return { scale: 'square', arbitrary: null };
  }
  if (findClass(classes, /^aspect-video$/)) {
    return { scale: 'video', arbitrary: null };
  }

  return { scale: '', arbitrary: null };
};

const parseDisplay = (classes: string): { mode: 'none' | 'flex' | 'grid' | 'other'; other: string } => {
  const tokens = classes.split(/\s+/).filter(Boolean);
  if (tokens.includes('inline-flex')) return { mode: 'other', other: 'inline-flex' };
  if (tokens.includes('inline-grid')) return { mode: 'other', other: 'inline-grid' };
  if (tokens.includes('grid')) return { mode: 'grid', other: 'block' };
  if (tokens.includes('flex')) return { mode: 'flex', other: 'block' };
  const other = OTHER_DISPLAY_VALUES.find(val => tokens.includes(val));
  return other ? { mode: 'other', other } : { mode: 'none', other: 'block' };
};

const parseGapValue = (token: string | undefined, prefix: string): number | null => {
  if (!token) return null;
  const match = token.match(new RegExp(`^${prefix}-(.+)$`));
  if (!match) return null;
  const suffix = match[1];
  if (suffix === '0') return 0;
  const arbitrary = suffix.match(/^\[(\d+(?:\.\d+)?)(px|rem|em|%)?\]$/);
  if (arbitrary) return parseFloat(arbitrary[1]);
  const num = parseFloat(suffix);
  return isNaN(num) ? null : num * 4;
};

/** Gap fields as shown: X / Y fall back to the unified gap. */
const parseGaps = (classes: string) => {
  const gap = parseGapValue(findClass(classes, /^gap-(?![xy]-)/), 'gap');
  const gapX = parseGapValue(findClass(classes, /^gap-x-/), 'gap-x') ?? gap;
  const gapY = parseGapValue(findClass(classes, /^gap-y-/), 'gap-y') ?? gap;
  const shown = (v: number | null) => (v !== null ? `${v}` : '');
  return { gap: shown(gap), gapX: shown(gapX), gapY: shown(gapY) };
};

// ============================================================================
// Several selected — each control's own reader ("Mixed", design C6) and what
// each write owns (only those tokens change on every member, design §2)
// ============================================================================

/** The Display segment shown ('block' when there is no display token — the browser default). */
const readDisplay = (classes: string): string => {
  const { mode, other } = parseDisplay(classes);
  return mode === 'flex' || mode === 'grid' ? mode : other;
};
const readDirection = (classes: string) => findClass(classes, DIRECTION_RE) || 'flex-row';
const readGridCols = (classes: string) => classes.match(/grid-cols-(\d+)/)?.[1] ?? '';
const readGridRows = (classes: string) => classes.match(/grid-rows-(\d+)/)?.[1] ?? '';
/** The 3×3 cell: no justify = start, no items = start (what the grid shows). */
const readAlignment = (classes: string) =>
  [findClass(classes, JUSTIFY_RE) || 'justify-start', findClass(classes, ITEMS_RE) || 'items-start'];
const readGap = (classes: string) => parseGaps(classes).gap;
const readGapX = (classes: string) => parseGaps(classes).gapX;
const readGapY = (classes: string) => parseGaps(classes).gapY;
const sizeReader = (dim: Dimension) => (classes: string) => {
  const { mode, value, unit } = parseSizeState(classes, dim);
  return [mode, value, unit];
};
const SIZE_READERS = {
  w: { size: sizeReader('w'), min: (c: string) => parseConstraint(c, 'w', 'min'), max: (c: string) => parseConstraint(c, 'w', 'max') },
  h: { size: sizeReader('h'), min: (c: string) => parseConstraint(c, 'h', 'min'), max: (c: string) => parseConstraint(c, 'h', 'max') },
};

const displayGroup = ownsGroups('standalone:display');
const OWNS = {
  /** `hidden` is Visibility's (Appearance), not Display's. */
  display: (t: string) => t !== 'hidden' && displayGroup(t),
  direction: ownsGroups('standalone:flexDirection'),
  wrap: ownsGroups('standalone:flexWrap'),
  gridCols: ownsGroups('grid-cols-'),
  gridRows: ownsGroups('grid-rows-'),
  /** Fill via flex-1 / grow is width's; the cross-dimension h-full / w-full a size write adds is not owned. */
  w: (t: string) => t.startsWith('w-') || t === 'flex-1' || t === 'grow',
  h: (t: string) => t.startsWith('h-'),
  'min-w': ownsGroups('min-w-'),
  'max-w': ownsGroups('max-w-'),
  'min-h': ownsGroups('min-h-'),
  'max-h': ownsGroups('max-h-'),
  /** The writer's own sets: `justify-items-*` / `justify-self-*` share Tailwind's `justify-` group. */
  alignment: (t: string) => JUSTIFY_RE.test(t) || ITEMS_RE.test(t),
  aspect: ownsGroups('aspect-'),
  gap: ownsGroups('gap-', 'gap-x-', 'gap-y-'),
  gapX: ownsGroups('gap-x-'),
  gapY: ownsGroups('gap-y-'),
} satisfies Record<string, Owns>;

/** Per field of a W / H input: do the members differ? */
interface SizeMixed { size: boolean; min: boolean; max: boolean }

// ============================================================================
// Size Class Generation
// ============================================================================

/**
 * Check if classes contain flex-1 or grow (which affects sizing)
 */
const hasFlexGrow = (classes: string): boolean => {
  return !!findClass(classes, /^flex-1$/) || !!findClass(classes, /^grow$/);
};

/**
 * Generate size classes for a dimension, properly handling flex-1.
 *
 * Key insight: flex-1 is a flex-item property that makes the element grow/shrink.
 * - In horizontal flex: flex-1 primarily affects width
 * - In vertical flex: flex-1 primarily affects height
 *
 * When changing one dimension from "fill" (flex-1), we need to:
 * 1. Remove flex-1
 * 2. Add the appropriate class for the new mode
 * 3. If the other dimension should remain "fill", add the appropriate class
 */
const generateSizeClasses = (
  classes: string,
  dim: Dimension,
  state: SizeState,
  otherDimState?: SizeState
): string => {
  const prefix = dim;
  const otherPrefix = dim === 'w' ? 'h' : 'w';
  let newClasses = classes;

  // Check if flex-1 was providing fill behavior before we modify
  const hadFlexGrow = hasFlexGrow(classes);

  // Remove existing size classes for this dimension
  newClasses = setClass(newClasses, new RegExp(`^${prefix}-`), null);

  // Remove flex-1/grow only if we're changing away from fill mode
  // or if this is the dimension that should own the flex-1
  if (state.mode !== 'fill') {
    newClasses = setClass(newClasses, /^flex-1$/, null);
    newClasses = setClass(newClasses, /^grow$/, null);

    // If the other dimension was also "fill" via flex-1, preserve it with explicit class
    if (hadFlexGrow && otherDimState?.mode === 'fill') {
      // Add explicit fill for the other dimension since we're removing flex-1
      if (!findClass(newClasses, new RegExp(`^${otherPrefix}-full$`))) {
        newClasses = `${newClasses} ${otherPrefix}-full`;
      }
    }
  }

  switch (state.mode) {
    case 'fixed':
      if (state.value !== null && state.value > 0) {
        const sizeClass = resolveToClass(prefix, state.value, state.unit);
        newClasses = `${newClasses} ${sizeClass}`;
      }
      break;
    case 'hug':
      newClasses = `${newClasses} ${prefix}-fit`;
      break;
    case 'fill':
      // If flex-1 already provides fill, keep it; otherwise use explicit class
      if (!hasFlexGrow(newClasses)) {
        newClasses = `${newClasses} ${prefix}-full`;
      }
      break;
    case 'auto':
      break;
  }

  return newClasses.trim();
};

const updateConstraint = (
  classes: string,
  dim: Dimension,
  type: 'min' | 'max',
  value: number | null,
  unit = 'px'
): string => {
  const prefix = type === 'min' ? `min-${dim}` : `max-${dim}`;
  let newClasses = setClass(classes, new RegExp(`^${prefix}-`), null); // the bare token only (see parseConstraint)

  if (value !== null && value > 0) {
    const constraintClass = resolveToClass(prefix, value, unit);
    newClasses = `${newClasses} ${constraintClass}`;
  }

  return newClasses.trim();
};

// ============================================================================
// Alignment Helpers
// ============================================================================

const getAlignmentForIndex = (index: number, isColumn: boolean) => {
  const gridRow = Math.floor(index / 3);
  const gridCol = index % 3;

  if (isColumn) {
    return {
      justify: JUSTIFY_VALUES[gridRow],
      align: ITEMS_VALUES[gridCol]
    };
  } else {
    return {
      justify: JUSTIFY_VALUES[gridCol],
      align: ITEMS_VALUES[gridRow]
    };
  }
};

const getIndexFromAlignment = (justify: string, align: string, isColumn: boolean): number => {
  const justifyIdx = JUSTIFY_VALUES.indexOf(justify as typeof JUSTIFY_VALUES[number]);
  const alignIdx = ITEMS_VALUES.indexOf(align as typeof ITEMS_VALUES[number]);

  if (justifyIdx === -1 || alignIdx === -1) return -1;

  if (isColumn) {
    return justifyIdx * 3 + alignIdx;
  } else {
    return alignIdx * 3 + justifyIdx;
  }
};

// ============================================================================
// GridPlacementField Component
// ============================================================================

/** Grid placement input: draft while focused, commit on blur/Enter, Escape
 * reverts (task-094 B2 — a per-keystroke commit deleted spans mid-typing).
 * Mirrors SizeInput's isFocused/inputValue pattern below. Arrow keys
 * step-commit complete values immediately (they can't form partial numbers). */
const GridPlacementField: React.FC<{
  icon: React.ReactNode;
  ariaLabel: string;
  title?: string;
  value: string;
  onCommit: (v: string) => void;
  min: number;
  max: number;
  containerClassName?: string;
}> = ({ icon, ariaLabel, title, value, onCommit, min, max, containerClassName }) => {
  const [draft, setDraft] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // Enter/Escape blur the input themselves — the follow-up blur event must not
  // commit again (Enter) or commit the reverted draft (Escape).
  const skipCommitRef = useRef(false);
  return (
    <Field
      icon={icon}
      aria-label={ariaLabel}
      title={title}
      value={isFocused ? draft : value}
      onChange={setDraft}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          skipCommitRef.current = true;
          onCommit(draft);
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          skipCommitRef.current = true;
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        } else {
          handleArrowKeys(e, isFocused ? draft : value, (v) => { setDraft(v); onCommit(v); }, min, max);
        }
      }}
      onBlur={() => {
        setIsFocused(false);
        if (skipCommitRef.current) { skipCommitRef.current = false; return; }
        if (draft !== value) onCommit(draft);
      }}
      onFocus={() => { setIsFocused(true); setDraft(value); }}
      placeholder="auto"
      containerClassName={containerClassName}
    />
  );
};

// ============================================================================
// SizeInput Component
// ============================================================================

interface SizeInputProps {
  dimension: Dimension;
  state: SizeState;
  onModeChange: (mode: SizeMode) => void;
  /** `unit` omitted: the field's current unit. */
  onValueChange: (value: number | null, unit?: string) => void;
  onConstraintChange: (type: 'min' | 'max', value: number | null, unit: string) => void;
  onAddConstraint: (type: 'min' | 'max') => void;
  onRemoveConstraint: (type: 'min' | 'max') => void;
  mixed: SizeMixed;
}

/** The unit of a W / H / min / max value: a sub-target in the field box (same look as SpacingBlock's unitSelectClass). */
const UnitSelect: React.FC<{ value: string; onChange: (unit: string) => void; 'aria-label': string }> = ({ value, onChange, 'aria-label': ariaLabel }) => (
  <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}
    className="w-4 h-4 text-3xs text-text-secondary bg-transparent outline-none cursor-pointer appearance-none text-center">
    {SIZE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
  </select>
);

/** The selection's rendered size, muted, beside Fill / Hug / auto (owner 2026-10-06).
 *  A leaf of its own: the rect updates often (scroll, resize) — only this label re-renders.
 *  Hidden while ≥2 are selected: the rect is only the primary's (design C14). */
const MeasuredSize: React.FC<{ dimension: 'w' | 'h'; label: string }> = ({ dimension, label }) => {
  const rect = useSelectedRectOptional();
  const multi = useMultiMembers();
  const value = rect && !multi ? Math.round(dimension === 'w' ? rect.width : rect.height) : null;
  return value === null ? null : (
    <span className="shrink-0 pr-1 text-xs tabular-nums text-text-secondary" title={`Rendered ${label}`}>{value}</span>
  );
};

export const SizeInput: React.FC<SizeInputProps> = ({
  dimension,
  state,
  onModeChange,
  onValueChange,
  onConstraintChange,
  onAddConstraint,
  onRemoveConstraint,
  mixed
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  // Last value an arrow press produced: key repeat outruns React's re-render, and stepping from the RENDERED
  // value repeated the same number (lost increments). Dropped when the rendered value reaches it, and on blur.
  const stepped = useRef<number | null>(null);
  if (stepped.current !== null && state.mode === 'fixed' && state.value === stepped.current) stepped.current = null;

  // What one committed text does: a positive length (`50`, `50%`, `100vh`) sets the size, '' / 'auto' switches to auto.
  // Shared by the legacy per-keystroke path and the value gesture kit (a settled draft, or a stepper tick under the
  // 'preview' scope).
  const commitText = (val: string) => {
    // Only a COMMIT replaces the displayed text: a draft keystroke / stepper tick is shown by the gesture itself, and an
    // aborted gesture must fall back to the committed text, not to the aborted one.
    if (getGestureScope() === 'commit') setInputValue(val);
    const typed = val.trim().match(TYPED_LENGTH);
    if (typed && parseFloat(typed[1]) > 0) {
      onValueChange(Math.round(parseFloat(typed[1])), typed[2]?.toLowerCase());
    } else if (val === '' || val.toLowerCase() === 'auto') {
      onModeChange('auto');
    }
  };
  const gestureHost = useContext(GestureHostContext);
  const gesture = useValueGesture({ value: inputValue, onChange: commitText, host: gestureHost, enabled: !!gestureHost, min: 1 });

  const label = dimension === 'w' ? 'W' : 'H';
  const fullLabel = dimension === 'w' ? 'width' : 'height';
  const name = dimension === 'w' ? 'Width' : 'Height';
  // A Mixed constraint still shows its row ("Mixed"): typing sets it on every member.
  const hasMin = state.minValue !== null || mixed.min;
  const hasMax = state.maxValue !== null || mixed.max;

  // Only sync from state when NOT focused (to avoid overwriting user's typing)
  useEffect(() => {
    if (isFocused) return;
    if (state.mode === 'fixed' && state.value !== null) {
      setInputValue(state.value.toString());
    } else if (state.mode === 'hug') {
      setInputValue('Hug');
    } else if (state.mode === 'fill') {
      setInputValue('Fill');
    } else {
      setInputValue('');
    }
  }, [state.mode, state.value, isFocused]);

  const handleModeSelect = (mode: SizeMode) => {
    onModeChange(mode);
    setIsOpen(false);
  };


  const getDisplayValue = () => {
    if (state.mode === 'fixed' && state.value !== null) {
      return state.value.toString();
    }
    if (state.mode === 'hug') return 'Hug';
    if (state.mode === 'fill') return 'Fill';
    return '';
  };

  const triggerRefButton = React.useRef<HTMLButtonElement>(null);

  return (
    <div className="relative">
      <div {...fieldBox} className="flex items-center h-7 rounded-inner bg-input-fill border border-input-stroke overflow-hidden cursor-text">
        <span className="w-4 h-4 ml-1 flex items-center justify-center text-xs text-text-secondary shrink-0">
          {label}
        </span>
        <input
          type="text"
          aria-label={name}
          className="flex-1 min-w-0 px-2 text-xs bg-transparent text-text outline-none"
          value={isFocused ? gesture.text : mixed.size ? '' : getDisplayValue()}
          onFocus={() => {
            setIsFocused(true);
            // Initialize inputValue based on current mode
            if (state.mode === 'fixed' && state.value !== null) {
              setInputValue(state.value.toString());
            } else {
              // Clear for non-fixed modes so user can type a number
              setInputValue('');
            }
          }}
          onBlur={() => { stepped.current = null; gesture.onBlur(); setIsFocused(false); }}
          onChange={(e) => {
            stepped.current = null; // typing replaces any stepped value
            gesture.onText(e.target.value);   // no host: straight to commitText, as before
          }}
          onCompositionStart={gesture.onCompositionStart}
          onCompositionEnd={gesture.onCompositionEnd}
          onKeyDown={(e) => {
            if (gesture.onKeyDown(e)) return;
            if (!gestureHost && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault();
              const step = e.shiftKey ? 10 : 1;
              const currentValue = stepped.current ?? (state.mode === 'fixed' && state.value !== null ? state.value : 0);
              const newValue = e.key === 'ArrowUp' ? currentValue + step : Math.max(1, currentValue - step);
              stepped.current = newValue;
              setInputValue(newValue.toString());
              onValueChange(newValue);
            }
          }}
          placeholder={mixed.size ? 'Mixed' : 'auto'}
        />
        {state.mode === 'fixed' && !mixed.size && (
          <UnitSelect aria-label={`${name} unit`} value={state.unit} onChange={(unit) => onValueChange(state.value, unit)} />
        )}
        {!isFocused && state.mode !== 'fixed' && <MeasuredSize dimension={dimension} label={fullLabel} />}
        <IconButton
          ref={triggerRefButton}
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`${name} options`}
          size="sm"
          className="w-4 h-4 mr-1 bg-transparent hover:bg-transparent text-text-secondary hover:text-text"
        >
          <ChevronDownIcon className="w-4 h-4" />
        </IconButton>
      </div>

      <Popover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={triggerRefButton}
        placement="bottom-start"
        className="w-48 py-1"
      >
          <MenuItem
            label={`Fixed ${fullLabel}${state.mode === 'fixed' && state.value ? ` (${state.value}${state.unit})` : ''}`}
            icon={<FixedWidthIcon className="w-4 h-4" />}
            selected={!mixed.size && state.mode === 'fixed'}
            onSelect={() => handleModeSelect('fixed')}
          />

          <MenuItem
            label="Hug contents"
            icon={<HugIcon className="w-4 h-4" />}
            selected={!mixed.size && state.mode === 'hug'}
            onSelect={() => handleModeSelect('hug')}
          />

          <MenuItem
            label="Fill container"
            icon={<FillIcon className="w-4 h-4" />}
            selected={!mixed.size && state.mode === 'fill'}
            onSelect={() => handleModeSelect('fill')}
          />

          <div className="h-px bg-stroke my-1" />

          {!hasMin ? (
            <MenuItem
              label={`Add min ${fullLabel}...`}
              icon={<MinWidthIcon className="w-4 h-4" />}
              className="text-text-secondary hover:text-text"
              onSelect={() => {
                onAddConstraint('min');
                setIsOpen(false);
              }}
            />
          ) : (
            <MenuItem
              label={`Remove min ${fullLabel}${state.minValue && state.minValue.value !== -1 ? ` (${state.minValue.value}${state.minValue.unit})` : ''}`}
              icon={<MinWidthIcon className="w-4 h-4" />}
              selected
              onSelect={() => {
                onRemoveConstraint('min');
                setIsOpen(false);
              }}
            />
          )}

          {!hasMax ? (
            <MenuItem
              label={`Add max ${fullLabel}...`}
              icon={<MaxWidthIcon className="w-4 h-4" />}
              className="text-text-secondary hover:text-text"
              onSelect={() => {
                onAddConstraint('max');
                setIsOpen(false);
              }}
            />
          ) : (
            <MenuItem
              label={`Remove max ${fullLabel}${state.maxValue && state.maxValue.value !== -1 ? ` (${state.maxValue.value}${state.maxValue.unit})` : ''}`}
              icon={<MaxWidthIcon className="w-4 h-4" />}
              selected
              onSelect={() => {
                onRemoveConstraint('max');
                setIsOpen(false);
              }}
            />
          )}
      </Popover>

      {(hasMin || hasMax) && (
        <div className="mt-1 space-y-1">
          {hasMin && (
            <ConstraintInput
              type="min"
              dimension={dimension}
              value={state.minValue ?? NO_LENGTH}
              mixed={mixed.min}
              onChange={(val, unit) => onConstraintChange('min', val, unit)}
              onRemove={() => onRemoveConstraint('min')}
            />
          )}
          {hasMax && (
            <ConstraintInput
              type="max"
              dimension={dimension}
              value={state.maxValue ?? NO_LENGTH}
              mixed={mixed.max}
              onChange={(val, unit) => onConstraintChange('max', val, unit)}
              onRemove={() => onRemoveConstraint('max')}
            />
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// ConstraintInput Component
// ============================================================================

interface ConstraintInputProps {
  type: 'min' | 'max';
  dimension: Dimension;
  value: Length;
  /** Several selected and their values differ: shows "Mixed"; typing sets it on every member. */
  mixed: boolean;
  onChange: (value: number | null, unit: string) => void;
  onRemove: () => void;
}

const ConstraintInput: React.FC<ConstraintInputProps> = ({
  type,
  dimension,
  value: { value, unit },
  mixed,
  onChange,
  onRemove
}) => {
  const [isOpen, setIsOpen] = useState(false);
  // Handle sentinel value -1 (special class like max-w-full)
  const isSpecialValue = !mixed && value === -1;
  const [inputValue, setInputValue] = useState(isSpecialValue ? '' : value.toString());
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const isMulti = !!useMultiMembers();
  const name = `${type === 'min' ? 'Min' : 'Max'} ${dimension === 'w' ? 'width' : 'height'}`;

  const Icon = type === 'min' ? MinWidthIcon : MaxWidthIcon;

  useEffect(() => {
    setInputValue(value === -1 ? '' : value.toString());
  }, [value]);

  return (
    <div className="relative">
      <div {...fieldBox} className="flex items-center h-7 rounded-inner bg-input-fill border border-input-stroke overflow-hidden cursor-text">
        <span className="w-4 h-4 ml-1 flex items-center justify-center text-text-secondary shrink-0">
          <Icon className="w-4 h-4" />
        </span>
        <input
          type={isSpecialValue ? 'text' : 'number'}
          aria-label={name}
          className="flex-1 min-w-0 px-2 text-xs bg-transparent text-text outline-none"
          value={mixed ? '' : isSpecialValue ? 'auto' : inputValue}
          onChange={(e) => {
            if (isSpecialValue) return; // Don't allow editing special values
            const val = e.target.value;
            setInputValue(val);
            const numValue = parseFloat(val);
            if (!isNaN(numValue) && numValue > 0) {
              onChange(Math.round(numValue), unit);
            }
          }}
          placeholder={mixed ? 'Mixed' : '0'}
          readOnly={isSpecialValue}
        />
        {!isSpecialValue && !mixed && <UnitSelect aria-label={`${name} unit`} value={unit} onChange={(u) => onChange(value, u)} />}
        <IconButton
          ref={triggerRef}
          onClick={() => setIsOpen(!isOpen)}
          aria-label={`${name} options`}
          size="sm"
          className="w-4 h-4 mr-1 bg-transparent hover:bg-transparent text-text-secondary hover:text-text"
        >
          <ChevronDownIcon className="w-4 h-4" />
        </IconButton>
      </div>

      <Popover
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        triggerRef={triggerRef}
        placement="bottom-start"
        className="w-40 py-1"
      >
        {/* Hidden while ≥2 are selected (design C14) */}
        {!isSpecialValue && !isMulti && (
          <MenuItem
            label={`Set to current ${dimension === 'w' ? 'width' : 'height'}`}
            onSelect={() => {
              onChange(value, unit);
              setIsOpen(false);
            }}
          />
        )}
        <MenuItem
          label={`Remove ${type} ${dimension === 'w' ? 'width' : 'height'}`}
          onSelect={() => {
            onRemove();
            setIsOpen(false);
          }}
        />
      </Popover>
    </div>
  );
};

// ============================================================================
// Main Component
// ============================================================================

export interface LayoutAppearanceBlockProps {
  classes: string;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
  /** True if the element's parent is a grid container */
  isGridChild?: boolean;
  /** Parent grid column count (for translating col-span-full → number) */
  parentGridCols?: number;
  /** Parent grid row count (for translating row-span-full → number) */
  parentGridRows?: number;
  /**
   * True when parentGridCols/Rows came from live grid geometry (selectedCell).
   * A class-derived count resolved at the active breakpoint may be the WRONG
   * breakpoint's value and must not bound edits (task-094 B1).
   */
  parentGridSizeIsExact?: boolean;
  /**
   * Grid-child placement in force at the CANVAS breakpoint (prefix-free), and
   * its writer. Placement is read and written on that layer — the one the
   * canvas drag/resize writes — not on the editing layer: a base col-start
   * loses to an lg: one at an lg canvas. Without them the block edits `classes`.
   */
  placementClasses?: string;
  onPlacementChange?: (axis: 'col' | 'row', tokens: string[], stripsFixedSize: boolean) => void;
  /** The container's own column/row count, written where the count in force on canvas lives (null = auto). */
  onGridTemplateChange?: (axis: 'col' | 'row', count: number | null) => void;
  /**
   * Rendered cell of the selected grid child (from the bridge GRID_GEOMETRY_RESPONSE).
   * Used as the Start/Span fallback so a col-span-only / auto-placed child shows its
   * real position instead of empty inputs (BUG-B / task-090).
   */
  gridCell?: { colStart: number; colSpan: number; rowStart: number; rowSpan: number } | null;
}

export const LayoutAppearanceBlock: React.FC<LayoutAppearanceBlockProps> = ({
  classes,
  onClassesChange,
  isGridChild = false,
  parentGridCols = 0,
  parentGridRows = 0,
  parentGridSizeIsExact = false,
  placementClasses,
  onPlacementChange,
  onGridTemplateChange,
  gridCell = null,
}) => {
  // Ref for classes to avoid stale closures in rapid input handlers
  // Update during render, not in useEffect (per CLAUDE.md pattern)
  const classesRef = useRef(classes);
  classesRef.current = classes;

  // Pending classes ref for accumulating rapid sequential changes
  // When multiple inputs fire before React re-renders, each handler
  // uses the previous pending change as its base
  const pendingClassesRef = useRef<string | null>(null);

  // Clear pending classes when actual classes prop updates
  useEffect(() => {
    pendingClassesRef.current = null;
  }, [classes]);

  // Helper to get the current base classes (pending or actual)
  const getBaseClasses = useCallback(() => {
    return pendingClassesRef.current ?? classesRef.current;
  }, []);

  // ========== Parse Layout State ==========
  const {
    layoutMode,
    otherDisplay,
    flexDirection,
    flexWrap,
    justify,
    align,
    gap,
    gapX,
    gapY,
    gridCols,
    gridRows,
    colStart,
    colSpan,
    rowStart,
    rowSpan
  } = useMemo(() => {
    const { mode, other } = parseDisplay(classes);

    const flexDirClass = findClass(classes, DIRECTION_RE);
    const flexWrapClass = findClass(classes, /^flex-(wrap|wrap-reverse|nowrap)$/);
    const justifyClass = findClass(classes, JUSTIFY_RE);
    const alignClass = findClass(classes, ITEMS_RE);

    // Grid counts and child placement show what is in force on canvas.
    const placement = placementClasses ?? classes;

    // Grid child placement — Start + Span. Explicit classes win; otherwise fall
    // back to the rendered cell (bridge geometry) so col-span-only / auto-placed
    // children are not shown as empty (BUG-B / task-090).
    const colPlacement = deriveAxisPlacement(placement, 'col', {
      renderedStart: gridCell?.colStart ?? null,
      renderedSpan: gridCell?.colSpan ?? null,
      parentSize: parentGridCols,
      sizeIsExact: parentGridSizeIsExact,
    });
    const rowPlacement = deriveAxisPlacement(placement, 'row', {
      renderedStart: gridCell?.rowStart ?? null,
      renderedSpan: gridCell?.rowSpan ?? null,
      parentSize: parentGridRows,
      sizeIsExact: parentGridSizeIsExact,
    });

    const parsed = {
      layoutMode: mode,
      otherDisplay: other,
      flexDirection: flexDirClass || '',
      flexWrap: flexWrapClass || '',
      justify: justifyClass || '',
      align: alignClass || '',
      ...parseGaps(classes),
      gridCols: readGridCols(placement),
      gridRows: readGridRows(placement),
      colStart: colPlacement.start,
      colSpan: colPlacement.span,
      rowStart: rowPlacement.start,
      rowSpan: rowPlacement.span,
    };
    return parsed;
  }, [classes, placementClasses, parentGridCols, parentGridRows, parentGridSizeIsExact, gridCell]);

  // Several selected: each control compares its OWN reader across members (design C6). A Mixed
  // Display drops its token from the merged list → flex/grid controls hide (C13).
  const mixed = {
    display: useMixedValue(readDisplay),
    direction: useMixedValue(readDirection),
    gridCols: useMixedValue(readGridCols),
    gridRows: useMixedValue(readGridRows),
    alignment: useMixedValue(readAlignment),
    aspect: useMixedValue(parseAspectRatio),
    gap: useMixedValue(readGap),
    gapX: useMixedValue(readGapX),
    gapY: useMixedValue(readGapY),
  };
  const mixedSize: Record<Dimension, SizeMixed> = {
    w: { size: useMixedValue(SIZE_READERS.w.size), min: useMixedValue(SIZE_READERS.w.min), max: useMixedValue(SIZE_READERS.w.max) },
    h: { size: useMixedValue(SIZE_READERS.h.size), min: useMixedValue(SIZE_READERS.h.min), max: useMixedValue(SIZE_READERS.h.max) },
  };

  // ========== Parse Size State ==========
  const [widthState, setWidthState] = useState<SizeState>({ mode: 'auto', value: null, unit: 'px', minValue: null, maxValue: null });
  const [heightState, setHeightState] = useState<SizeState>({ mode: 'auto', value: null, unit: 'px', minValue: null, maxValue: null });

  const { aspectRatio, aspectArbitrary } = useMemo(() => {
    const parsed = parseAspectRatio(classes);
    return {
      aspectRatio: parsed.scale,
      aspectArbitrary: parsed.arbitrary
    };
  }, [classes]);

  const [aspectWidth, setAspectWidth] = useState('');
  const [aspectHeight, setAspectHeight] = useState('');
  // Auto-expand gap on initial load if X and Y are different
  const [gapExpanded, setGapExpanded] = useState(() => {
    return gapX !== gapY && gapX !== '' && gapY !== '';
  });

  useEffect(() => {
    if (aspectArbitrary !== null) {
      const parts = aspectArbitrary.split('/');
      if (parts.length === 2) {
        setAspectWidth(parts[0].trim());
        setAspectHeight(parts[1].trim());
      } else {
        setAspectWidth(aspectArbitrary);
        setAspectHeight('');
      }
    } else {
      setAspectWidth('');
      setAspectHeight('');
    }
  }, [aspectArbitrary]);

  useEffect(() => {
    setWidthState(parseSizeState(classes, 'w'));
    setHeightState(parseSizeState(classes, 'h'));
  }, [classes]);

  // ========== Layout Handlers ==========
  const handleLayoutModeChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^(flex|grid|block|inline|inline-block|inline-flex|inline-grid)$/, null);
    newClasses = setClass(newClasses, DIRECTION_RE, null);

    if (value && value !== 'none') {
      newClasses = newClasses + ` ${value}`;
    }
    onClassesChange(newClasses.trim(), OWNS.display);
  }, [classes, onClassesChange]);

  const handleFlexDirectionClick = useCallback((value: string) => {
    if (value && !value.match(/^flex-(row|row-reverse|col|col-reverse)$/)) {
      return;
    }
    let newClasses = setClass(classes, DIRECTION_RE, value || null);
    onClassesChange(newClasses.trim(), OWNS.direction);
  }, [classes, onClassesChange]);

  const handleFlexWrapToggle = useCallback(() => {
    const isCurrentlyWrapped = flexWrap === 'flex-wrap';
    let newClasses = setClass(classes, /^flex-(wrap|wrap-reverse|nowrap)$/, null);
    if (isCurrentlyWrapped) {
      newClasses = newClasses + ' flex-nowrap';
    } else {
      newClasses = newClasses + ' flex-wrap';
    }
    onClassesChange(newClasses.trim(), OWNS.wrap);
  }, [classes, flexWrap, onClassesChange]);

  const handleGapChange = useCallback((value: string) => {
    const trimmedValue = value.trim();

    let newClasses = setClass(classes, /^gap-(?![xy]-)/, null);
    newClasses = setClass(newClasses, /^gap-x-/, null);
    newClasses = setClass(newClasses, /^gap-y-/, null);

    const numValue = parseFloat(trimmedValue);
    if (trimmedValue !== '' && !isNaN(numValue) && numValue >= 0) {
      const gapClass = resolveToClass('gap', numValue, 'px');
      newClasses = newClasses + ' ' + gapClass;
    }
    onClassesChange(newClasses.trim(), OWNS.gap);
  }, [classes, onClassesChange]);

  const handleGapXChange = useCallback((value: string) => {
    const trimmedValue = value.trim();

    // Remove unified gap and gap-x, keep gap-y
    let newClasses = setClass(classes, /^gap-(?![xy]-)/, null);
    newClasses = setClass(newClasses, /^gap-x-/, null);

    const numValue = parseFloat(trimmedValue);
    if (trimmedValue !== '' && !isNaN(numValue) && numValue >= 0) {
      const gapXClass = resolveToClass('gap-x', numValue, 'px');
      newClasses = newClasses + ' ' + gapXClass;
    }
    onClassesChange(newClasses.trim(), OWNS.gapX);
  }, [classes, onClassesChange]);

  const handleGapYChange = useCallback((value: string) => {
    const trimmedValue = value.trim();

    // Remove unified gap and gap-y, keep gap-x
    let newClasses = setClass(classes, /^gap-(?![xy]-)/, null);
    newClasses = setClass(newClasses, /^gap-y-/, null);

    const numValue = parseFloat(trimmedValue);
    if (trimmedValue !== '' && !isNaN(numValue) && numValue >= 0) {
      const gapYClass = resolveToClass('gap-y', numValue, 'px');
      newClasses = newClasses + ' ' + gapYClass;
    }
    onClassesChange(newClasses.trim(), OWNS.gapY);
  }, [classes, onClassesChange]);

  // The container's own column/row count: 1–12, anything else clears it.
  const editGridTemplate = useCallback((axis: 'col' | 'row', value: string) => {
    const parsed = parseInt(value, 10);
    const count = parsed > 0 && parsed <= 12 ? parsed : null;
    if (onGridTemplateChange) return onGridTemplateChange(axis, count);
    const prefix = axis === 'col' ? 'grid-cols-' : 'grid-rows-';
    const rest = setClass(classes, axis === 'col' ? /^grid-cols-/ : /^grid-rows-/, null);
    onClassesChange((count ? `${rest} ${prefix}${count}` : rest).trim(), axis === 'col' ? OWNS.gridCols : OWNS.gridRows);
  }, [classes, onClassesChange, onGridTemplateChange]);
  const handleGridColsChange = useCallback((value: string) => editGridTemplate('col', value), [editGridTemplate]);
  const handleGridRowsChange = useCallback((value: string) => editGridTemplate('row', value), [editGridTemplate]);

  // Grid child placement handlers — Start + Span model. axisEditTokens holds
  // the rules (validation, span preservation, column-first strip); a null
  // return means the input was rejected → no write (task-090). The DesignBar
  // writes the tokens on the canvas's layer; without it the block edits `classes`.
  const editAxisPlacement = useCallback(
    (axis: 'col' | 'row', field: 'start' | 'span', value: string) => {
      const geo = {
        renderedStart: (axis === 'col' ? gridCell?.colStart : gridCell?.rowStart) ?? null,
        renderedSpan: (axis === 'col' ? gridCell?.colSpan : gridCell?.rowSpan) ?? null,
        parentSize: axis === 'col' ? parentGridCols : parentGridRows,
        // one flag covers both axes: geometry delivers both counts or neither
        sizeIsExact: parentGridSizeIsExact,
      };
      if (onPlacementChange) {
        const edit = axisEditTokens(placementClasses ?? getBaseClasses(), axis, field, value, geo);
        if (edit) onPlacementChange(axis, edit.tokens, edit.stripsFixedSize);
        return;
      }
      const result = buildAxisEdit(getBaseClasses(), axis, field, value, geo);
      if (result == null) return;
      pendingClassesRef.current = result;
      onClassesChange(result);
    },
    [getBaseClasses, onClassesChange, onPlacementChange, placementClasses, parentGridCols, parentGridRows, parentGridSizeIsExact, gridCell]
  );

  const handleColStartChange = useCallback((v: string) => editAxisPlacement('col', 'start', v), [editAxisPlacement]);
  const handleColSpanChange = useCallback((v: string) => editAxisPlacement('col', 'span', v), [editAxisPlacement]);
  const handleRowStartChange = useCallback((v: string) => editAxisPlacement('row', 'start', v), [editAxisPlacement]);
  const handleRowSpanChange = useCallback((v: string) => editAxisPlacement('row', 'span', v), [editAxisPlacement]);

  // Arrow-key clamp bound: same D3 rule as buildAxisEdit — only a geometry-
  // sourced track count may bound edits; class-fallback counts cap at 12.
  const colBound = parentGridSizeIsExact && parentGridCols > 0 ? parentGridCols : 12;
  const rowBound = parentGridSizeIsExact && parentGridRows > 0 ? parentGridRows : 12;

  // ========== Alignment Handlers ==========
  const isColumnDirection = flexDirection === 'flex-col' || flexDirection === 'flex-col-reverse';
  const isStretch = align === ITEMS_STRETCH;

  const handleAlignmentClick = useCallback((index: number) => {
    const mapping = getAlignmentForIndex(index, isColumnDirection);
    let newClasses = setClass(classes, JUSTIFY_RE, mapping.justify);
    newClasses = setClass(newClasses, ITEMS_RE, mapping.align);
    onClassesChange(newClasses.trim(), OWNS.alignment);
  }, [classes, onClassesChange, isColumnDirection]);

  const handleAlignmentDoubleClick = useCallback((index: number) => {
    const mapping = getAlignmentForIndex(index, isColumnDirection);
    let newClasses = setClass(classes, JUSTIFY_RE, mapping.justify);
    const currentAlign = align || 'items-start';
    const targetAlign = mapping.align;
    const newAlign = currentAlign === targetAlign ? ITEMS_STRETCH :
                     currentAlign === ITEMS_STRETCH ? targetAlign : ITEMS_STRETCH;
    newClasses = setClass(newClasses, ITEMS_RE, newAlign);
    onClassesChange(newClasses.trim(), OWNS.alignment);
  }, [classes, align, onClassesChange, isColumnDirection]);

  const getAlignmentIndex = useCallback(() => {
    const justifyVal = justify || 'justify-start';
    const alignVal = (align === ITEMS_STRETCH) ? 'items-start' : (align || 'items-start');
    return getIndexFromAlignment(justifyVal, alignVal, isColumnDirection);
  }, [justify, align, isColumnDirection]);

  // ========== Size Handlers ==========
  const handleWidthModeChange = useCallback((mode: SizeMode) => {
    // Skip if mode hasn't changed
    if (mode === widthState.mode && !mixedSize.w.size) return; // Mixed reads 'auto': still apply

    const newState = { ...widthState, mode };
    if (mode === 'fixed' && newState.value === null) {
      newState.value = 100;
    }
    // Pass height state so we can preserve it if needed when removing flex-1
    let newClasses = generateSizeClasses(classes, 'w', newState, heightState);
    onClassesChange(newClasses, OWNS.w);
  }, [classes, widthState, heightState, onClassesChange, mixedSize.w.size]);

  const handleWidthValueChange = useCallback((value: number | null, unit = widthState.unit) => {
    const newState = { ...widthState, mode: 'fixed' as SizeMode, value, unit };
    let newClasses = generateSizeClasses(classes, 'w', newState, heightState);
    onClassesChange(newClasses, OWNS.w);
  }, [classes, widthState, heightState, onClassesChange]);

  const handleWidthConstraintChange = useCallback((type: 'min' | 'max', value: number | null, unit: string) => {
    let newClasses = updateConstraint(classes, 'w', type, value, unit);
    onClassesChange(newClasses, OWNS[`${type}-w`]);
  }, [classes, onClassesChange]);

  const handleWidthAddConstraint = useCallback((type: 'min' | 'max') => {
    const defaultValue = widthState.value || 100;
    let newClasses = updateConstraint(classes, 'w', type, defaultValue, widthState.unit);
    onClassesChange(newClasses, OWNS[`${type}-w`]);
  }, [classes, widthState.value, widthState.unit, onClassesChange]);

  const handleWidthRemoveConstraint = useCallback((type: 'min' | 'max') => {
    let newClasses = updateConstraint(classes, 'w', type, null);
    onClassesChange(newClasses, OWNS[`${type}-w`]);
  }, [classes, onClassesChange]);

  const handleHeightModeChange = useCallback((mode: SizeMode) => {
    // Skip if mode hasn't changed
    if (mode === heightState.mode && !mixedSize.h.size) return;

    const newState = { ...heightState, mode };
    if (mode === 'fixed' && newState.value === null) {
      newState.value = 100;
    }
    // Pass width state so we can preserve it if needed when removing flex-1
    let newClasses = generateSizeClasses(classes, 'h', newState, widthState);
    onClassesChange(newClasses, OWNS.h);
  }, [classes, heightState, widthState, onClassesChange, mixedSize.h.size]);

  const handleHeightValueChange = useCallback((value: number | null, unit = heightState.unit) => {
    const newState = { ...heightState, mode: 'fixed' as SizeMode, value, unit };
    let newClasses = generateSizeClasses(classes, 'h', newState, widthState);
    onClassesChange(newClasses, OWNS.h);
  }, [classes, heightState, widthState, onClassesChange]);

  const handleHeightConstraintChange = useCallback((type: 'min' | 'max', value: number | null, unit: string) => {
    let newClasses = updateConstraint(classes, 'h', type, value, unit);
    onClassesChange(newClasses, OWNS[`${type}-h`]);
  }, [classes, onClassesChange]);

  const handleHeightAddConstraint = useCallback((type: 'min' | 'max') => {
    const defaultValue = heightState.value || 100;
    let newClasses = updateConstraint(classes, 'h', type, defaultValue, heightState.unit);
    onClassesChange(newClasses, OWNS[`${type}-h`]);
  }, [classes, heightState.value, heightState.unit, onClassesChange]);

  const handleHeightRemoveConstraint = useCallback((type: 'min' | 'max') => {
    let newClasses = updateConstraint(classes, 'h', type, null);
    onClassesChange(newClasses, OWNS[`${type}-h`]);
  }, [classes, onClassesChange]);

  // ========== Aspect Ratio Handlers ==========
  const handleAspectRatioChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^aspect-(auto|square|video|\[.+\])$/, null);

    if (value === '') {
      // Auto - no class
    } else if (value === 'custom') {
      const w = aspectWidth || '1';
      const h = aspectHeight || '1';
      newClasses = newClasses + ` aspect-[${w}/${h}]`;
    } else {
      newClasses = newClasses + ` aspect-${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.aspect);
  }, [classes, aspectWidth, aspectHeight, onClassesChange]);

  const handleAspectWidthChange = useCallback((val: string) => {
    setAspectWidth(val);
    let newClasses = setClass(classes, /^aspect-(auto|square|video|\[.+\])$/, null);

    const w = val || '1';
    const h = aspectHeight || '1';
    if (w && h) {
      newClasses = newClasses + ` aspect-[${w}/${h}]`;
    }

    onClassesChange(newClasses.trim(), OWNS.aspect);
  }, [classes, aspectHeight, onClassesChange]);

  const handleAspectHeightChange = useCallback((val: string) => {
    setAspectHeight(val);
    let newClasses = setClass(classes, /^aspect-(auto|square|video|\[.+\])$/, null);

    const w = aspectWidth || '1';
    const h = val || '1';
    if (w && h) {
      newClasses = newClasses + ` aspect-[${w}/${h}]`;
    }

    onClassesChange(newClasses.trim(), OWNS.aspect);
  }, [classes, aspectWidth, onClassesChange]);

  // ========== Computed Values ==========
  const showFlexControls = layoutMode === 'flex' || (layoutMode === 'other' && otherDisplay === 'inline-flex');
  const showGridControls = layoutMode === 'grid' || (layoutMode === 'other' && otherDisplay === 'inline-grid');
  const showAlignmentAndGap = showFlexControls || showGridControls;
  const currentAlignmentIndex = getAlignmentIndex();

  const currentLayoutValue = useMemo(() => {
    if (layoutMode === 'flex') return 'flex';
    if (layoutMode === 'grid') return 'grid';
    if (layoutMode === 'other') return otherDisplay;
    // Default to 'block' when no display class (browser default)
    return 'block';
  }, [layoutMode, otherDisplay]);

  return (
    <div className="pb-2">
      {/* 1. Display Mode */}
      <div className="pr-8">
        <SegmentedControl
          options={layoutModeOptions}
          value={currentLayoutValue}
          mixed={mixed.display}
          onChange={handleLayoutModeChange}
        />
      </div>

      {/* 2. Direction + Wrap (flex only) */}
      {showFlexControls && (
        <div className="flex items-center pt-1">
          {/* Direction segmented control */}
          <div className="flex-1">
            <SegmentedControl
              options={[
                { value: 'flex-row', icon: <ArrowRightIcon className="w-4 h-4" />, title: 'Row' },
                { value: 'flex-col', icon: <ArrowDownIcon className="w-4 h-4" />, title: 'Column' },
                { value: 'flex-row-reverse', icon: <ArrowLeftIcon className="w-4 h-4" />, title: 'Row Reverse' },
                { value: 'flex-col-reverse', icon: <ArrowUpIcon className="w-4 h-4" />, title: 'Column Reverse' }
              ]}
              value={flexDirection || 'flex-row'}
              mixed={mixed.direction}
              onChange={handleFlexDirectionClick}
            />
          </div>

          <IconButton
            onClick={handleFlexWrapToggle}
            title={flexWrap === 'flex-wrap' ? 'Disable wrap' : 'Enable wrap'}
            className={`relative ml-1 mr-1 bg-transparent hover:bg-transparent ${
              flexWrap === 'flex-wrap' ? 'text-accent hover:text-accent' : 'text-text-secondary hover:text-accent'
            }`}
          >
            {flexWrap === 'flex-wrap' && <span className="absolute inset-0 bg-accent opacity-20 rounded" />}
            <WrapIcon className="w-4 h-4 relative z-10" />
          </IconButton>
        </div>
      )}

      {/* Grid Columns/Rows */}
      {showGridControls && (
        <div className="grid grid-cols-2 gap-1 pr-8 pt-1">
          <Field
            icon={<ColumnsIcon className="w-4 h-4" />}
            aria-label="Grid columns"
            mixed={mixed.gridCols}
            value={gridCols}
            onChange={handleGridColsChange}
            onKeyDown={(e) => handleArrowKeys(e, gridCols, handleGridColsChange)}
            placeholder="0"
          />
          <Field
            icon={<RowsIcon className="w-4 h-4" />}
            aria-label="Grid rows"
            mixed={mixed.gridRows}
            value={gridRows}
            onChange={handleGridRowsChange}
            onKeyDown={(e) => handleArrowKeys(e, gridRows, handleGridRowsChange)}
            placeholder="0"
          />
        </div>
      )}

      {/* Grid Child Placement (col/row Start + Span) - show when element is inside a grid container.
          Span (not End): matches Tailwind col-span-N and the canonical normalizeGridClasses form (D1) —
          ColEndIcon/RowEndIcon visuals kept for now, aria-label + title tell the truth. */}
      {isGridChild && (
        <div className="grid grid-cols-2 gap-1 pr-8 pt-1">
          {/* Column start + span welded together */}
          <div className="flex">
            <GridPlacementField
              icon={<ColStartIcon className="w-4 h-4" />}
              ariaLabel="Column start"
              value={colStart}
              onCommit={handleColStartChange}
              min={1}
              max={colBound}
              containerClassName="rounded-r-none border-r-0 flex-1"
            />
            <GridPlacementField
              icon={<ColEndIcon className="w-4 h-4" />}
              ariaLabel="Column span"
              title="Span (number of tracks)"
              value={colSpan}
              onCommit={handleColSpanChange}
              min={1}
              max={colBound}
              containerClassName="rounded-l-none flex-1"
            />
          </div>
          {/* Row start + span welded together */}
          <div className="flex">
            <GridPlacementField
              icon={<RowStartIcon className="w-4 h-4" />}
              ariaLabel="Row start"
              value={rowStart}
              onCommit={handleRowStartChange}
              min={1}
              max={rowBound}
              containerClassName="rounded-r-none border-r-0 flex-1"
            />
            <GridPlacementField
              icon={<RowEndIcon className="w-4 h-4" />}
              ariaLabel="Row span"
              title="Span (number of tracks)"
              value={rowSpan}
              onCommit={handleRowSpanChange}
              min={1}
              max={rowBound}
              containerClassName="rounded-l-none flex-1"
            />
          </div>
        </div>
      )}

      {/* 3. W/H row (flex/grid mode) */}
      {showAlignmentAndGap && (
        <div className="grid grid-cols-2 gap-1 pr-8 pt-1">
          <SizeInput
            dimension="w"
            state={widthState}
            onModeChange={handleWidthModeChange}
            onValueChange={handleWidthValueChange}
            onConstraintChange={handleWidthConstraintChange}
            onAddConstraint={handleWidthAddConstraint}
            onRemoveConstraint={handleWidthRemoveConstraint}
            mixed={mixedSize.w}
          />
          <SizeInput
            dimension="h"
            state={heightState}
            onModeChange={handleHeightModeChange}
            onValueChange={handleHeightValueChange}
            onConstraintChange={handleHeightConstraintChange}
            onAddConstraint={handleHeightAddConstraint}
            onRemoveConstraint={handleHeightRemoveConstraint}
            mixed={mixedSize.h}
          />
        </div>
      )}

      {/* 4. Alignment Grid + Gap/Ratio */}
      {showAlignmentAndGap ? (
        /* Flex/Grid mode: Alignment (left) + Gap+Ratio (right) + expand button */
        <div className="flex items-center pt-1">
          <div className="flex-1 grid grid-cols-2 gap-1">
            {/* Left: Alignment Grid */}
            <div className="grid grid-cols-3 gap-y-[7px] gap-x-1 p-0.5 rounded-[6px] bg-input-fill border border-input-stroke">
              {Array.from({ length: 9 }, (_, idx) => {
                const row = Math.floor(idx / 3);
                const col = idx % 3;
                const itemsIndex = isColumnDirection ? col : row;
                const isThisCellActive = currentAlignmentIndex === idx;

                const justifyIndex = JUSTIFY_VALUES.indexOf(justify as typeof JUSTIFY_VALUES[number] || 'justify-start');
                const isInActiveJustifyPosition = isColumnDirection
                  ? row === justifyIndex
                  : col === justifyIndex;

                // Show proper alignment icon only for selected cell, DotIcon for others (none while Mixed)
                const isSelected = !mixed.alignment && (isThisCellActive || (isStretch && isInActiveJustifyPosition));
                const IconComponent = isSelected
                  ? (isStretch && isInActiveJustifyPosition ? STRETCH_ICON : ITEMS_ICONS[itemsIndex])
                  : DotIcon;

                return (
                  <IconButton
                    key={idx}
                    active={isSelected}
                    className={`w-full h-6 ${
                      isSelected ? '' : 'bg-transparent text-text-secondary hover:text-text-secondary'
                    }`}
                    onClick={() => handleAlignmentClick(idx)}
                    onDoubleClick={() => handleAlignmentDoubleClick(idx)}
                    title={`${isColumnDirection ? JUSTIFY_VALUES[row] : JUSTIFY_VALUES[col]} + ${isColumnDirection ? ITEMS_VALUES[col] : ITEMS_VALUES[row]}${isStretch && isInActiveJustifyPosition ? ' (stretch)' : ''}\nDouble-click to toggle stretch`}
                  >
                    <IconComponent
                      className={`w-4 h-4 ${isSelected && isColumnDirection ? '-rotate-90' : ''}`}
                    />
                  </IconButton>
                );
              })}
            </div>

            {/* Right: Aspect Ratio + Gap controls with expand button */}
            <div className="flex flex-col gap-1">
              {/* Aspect Ratio */}
              <Field
                icon={<RatioIcon className="w-4 h-4" />}
                as="select"
                aria-label="Aspect ratio"
                mixed={mixed.aspect}
                value={aspectRatio}
                onChange={handleAspectRatioChange}
                options={[
                  { value: '', label: 'Auto' },
                  { value: 'square', label: '1:1' },
                  { value: 'video', label: '16:9' },
                  { value: 'custom', label: 'Custom' }
                ]}
              />
              {/* Gap controls - collapsed (single) or expanded (X + Y) */}
              {gapExpanded ? (
                /* Expanded: Gap X and Gap Y stacked */
                <>
                  <Field
                    icon={<GapXIcon className="w-4 h-4" />}
                    aria-label="Horizontal gap"
                    mixed={mixed.gapX}
                    value={gapX || gap}
                    onChange={handleGapXChange}
                    type="number"
                    placeholder="0"
                    min={0}
                  />
                  <Field
                    icon={<GapYIcon className="w-4 h-4" />}
                    aria-label="Vertical gap"
                    mixed={mixed.gapY}
                    value={gapY || gap}
                    onChange={handleGapYChange}
                    type="number"
                    placeholder="0"
                    min={0}
                  />
                </>
              ) : (
                /* Collapsed: Single unified gap */
                <Field
                  icon={<GapIcon className="w-4 h-4" />}
                  aria-label="Gap"
                  mixed={mixed.gap}
                  value={gap}
                  onChange={handleGapChange}
                  type="number"
                  placeholder="0"
                  min={0}
                />
              )}
            </div>
          </div>

          <div className="flex items-end ml-1 pr-1">
            <IconButton
              onClick={() => setGapExpanded(!gapExpanded)}
              aria-label="Separate row and column gaps"
              aria-pressed={gapExpanded}
              title={gapExpanded ? 'Use unified gap' : 'Use separate X/Y gaps'}
              className={`relative bg-transparent hover:bg-transparent ${
                gapExpanded ? 'text-accent hover:text-accent' : 'text-text-secondary hover:text-accent'
              }`}
            >
              {gapExpanded && <span className="absolute inset-0 bg-accent opacity-20 rounded" />}
              <YxGapIcon className="w-4 h-4 relative z-10" />
            </IconButton>
          </div>
        </div>
      ) : (
        /* Block/Other mode: W and H in a row, Ratio below */
        <div className="space-y-1 pr-8 pt-1">
          <div className="grid grid-cols-2 gap-1">
            <SizeInput
              dimension="w"
              state={widthState}
              onModeChange={handleWidthModeChange}
              onValueChange={handleWidthValueChange}
              onConstraintChange={handleWidthConstraintChange}
              onAddConstraint={handleWidthAddConstraint}
              onRemoveConstraint={handleWidthRemoveConstraint}
              mixed={mixedSize.w}
            />
            <SizeInput
              dimension="h"
              state={heightState}
              onModeChange={handleHeightModeChange}
              onValueChange={handleHeightValueChange}
              onConstraintChange={handleHeightConstraintChange}
              onAddConstraint={handleHeightAddConstraint}
              onRemoveConstraint={handleHeightRemoveConstraint}
              mixed={mixedSize.h}
            />
          </div>
          <Field
            as="select"
            icon={<RatioIcon className="w-4 h-4" />}
            aria-label="Aspect ratio"
            mixed={mixed.aspect}
            value={aspectRatio}
            onChange={handleAspectRatioChange}
            options={[
              { value: '', label: 'Auto' },
              { value: 'square', label: '1:1' },
              { value: 'video', label: '16:9' },
              { value: 'custom', label: 'Custom' }
            ]}
          />
          {aspectRatio === 'custom' && (
            <div className="grid grid-cols-2 gap-1">
              <Field
                label="X"
                aria-label="Aspect ratio width"
                value={aspectWidth}
                onChange={handleAspectWidthChange}
                type="number"
                placeholder="4"
                min={1}
              />
              <Field
                label="Y"
                aria-label="Aspect ratio height"
                value={aspectHeight}
                onChange={handleAspectHeightChange}
                type="number"
                placeholder="3"
                min={1}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LayoutAppearanceBlock;
