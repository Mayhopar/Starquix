/**
 * Stroke Block - Tailwind version
 *
 * Controls for border width, color, and style.
 * Supports expandable individual side controls (T, R, B, L).
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { findClass, setClass } from '../utils';
import { ColorPicker } from '../ColorPicker';
import { IndividualIcon, StrokeWidthIcon, BorderTopIcon, BorderRightIcon, BorderBottomIcon, BorderLeftIcon } from '@/assets/icons';
import { SegmentedControl, Field, IconButton } from '@/components/ui';
import { useMixedValue, ownsGroups, type Owns } from '../multi/mixed';
import { OPACITY_SUFFIX } from '../classPatterns';

// ============================================================================
// Constants
// ============================================================================

type Side = 't' | 'r' | 'b' | 'l';
const SIDES: Side[] = ['t', 'r', 'b', 'l'];

// Border style options for SegmentedControl (3 visible + Other dropdown)
const BORDER_STYLE_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  {
    value: 'other',
    label: 'Other',
    dropdown: [
      { value: 'dotted', label: 'Dotted' },
      { value: 'double', label: 'Double' },
      { value: 'none', label: 'None' }
    ]
  }
];

// Side icons map
const SIDE_ICONS: Record<Side, React.FC<{ className?: string }>> = {
  t: BorderTopIcon,
  r: BorderRightIcon,
  b: BorderBottomIcon,
  l: BorderLeftIcon
};

// ============================================================================
// Helpers
// ============================================================================

const parseBorderWidth = (classes: string, side?: Side): number => {
  const sidePrefix = side ? `-${side}` : '';

  // border-0 or border-t-0, etc.
  if (findClass(classes, new RegExp(`^border${sidePrefix}-0$`))) return 0;

  // border-[3px] or border-t-[3px]
  const arbitrary = findClass(classes, new RegExp(`^border${sidePrefix}-\\[\\d+px\\]$`));
  if (arbitrary) {
    const match = arbitrary.match(/\[(\d+)px\]/);
    return match ? parseInt(match[1], 10) : 1;
  }

  // border-2, border-4, border-8 or border-t-2, etc.
  const sized = findClass(classes, new RegExp(`^border${sidePrefix}-(2|4|8)$`));
  if (sized) {
    const match = sized.match(/(\d+)$/);
    return match ? parseInt(match[1], 10) : 1;
  }

  // Just 'border' or 'border-t' = 1px
  if (side) {
    if (findClass(classes, new RegExp(`^border-${side}$`))) return 1;
  } else {
    if (findClass(classes, /^border$/)) return 1;
  }

  return 0;
};

// Standard Tailwind color names
const TAILWIND_COLORS = ['transparent', 'white', 'black', 'slate', 'gray', 'zinc', 'neutral', 'stone', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];

// Common theme color names (shadcn/ui, custom themes, etc.)
const THEME_COLORS = ['border', 'primary', 'secondary', 'muted', 'accent', 'destructive', 'card', 'popover', 'foreground', 'background', 'input', 'ring'];

/** A border colour token for `side` (none = all sides) — the one shape the reader and the writer share. */
const isBorderColor = (token: string, side?: Side): boolean => {
  const prefix = `border${side ? `-${side}` : ''}-`;
  if (!token.startsWith(prefix)) return false;

  const colorPart = token.slice(prefix.length).replace(OPACITY_SUFFIX, '');

  // Width values (0, 2, 4, 8, [Npx]) and style values are not colours
  if (/^(0|2|4|8|\[\d+px\])$/.test(colorPart)) return false;
  if (['solid', 'dashed', 'dotted', 'double', 'none'].includes(colorPart)) return false;

  // Arbitrary value (hex, rgba, hsl, etc.)
  if (colorPart.startsWith('[') && colorPart.endsWith(']')) return true;

  // Theme colors (single word like "border", "primary")
  if (THEME_COLORS.includes(colorPart)) return true;

  // Tailwind colors: "red", "red-500", etc.
  const colorMatch = colorPart.match(/^([a-z]+)(-\d+)?$/);
  return !!colorMatch && TAILWIND_COLORS.includes(colorMatch[1]);
};

const parseBorderColor = (classes: string, side?: Side): string =>
  classes.split(/\s+/).find(token => isBorderColor(token, side)) ?? '';

const parseBorderStyle = (classes: string): string => {
  const token = findClass(classes, /^border-(solid|dashed|dotted|double|none)$/);
  if (!token) return '';

  const match = token.match(/^border-(.+)$/);
  return match ? match[1] : '';
};

/** A side as the fields show it: its own token, else the all-sides one. */
const sideWidth = (classes: string, side: Side): number => parseBorderWidth(classes, side) || parseBorderWidth(classes);
const sideColor = (classes: string, side: Side): string => parseBorderColor(classes, side) || parseBorderColor(classes);

// ============================================================================
// Several selected — each control's own reader ("Mixed", design C6) and what
// each write owns (only those tokens change on every member, design §2)
// ============================================================================

const perSide = <T,>(read: (classes: string, side: Side) => T) =>
  Object.fromEntries(SIDES.map(side => [side, (classes: string) => read(classes, side)])) as Record<Side, (classes: string) => T>;
const READ = {
  widths: (classes: string) => SIDES.map(side => sideWidth(classes, side)),
  colors: (classes: string) => SIDES.map(side => sideColor(classes, side)),
  /** No style token = solid (what the control shows). */
  style: (classes: string) => parseBorderStyle(classes) || 'solid',
  sideWidth: perSide(sideWidth),
  sideColor: perSide(sideColor),
};
const widthGroup = (side?: Side) => `standalone:borderWidth${side ? side.toUpperCase() : ''}`;
/** The auto `border-black` a width edit adds is no width token → never owned: members keep their colour. */
const OWNS = {
  /** All sides: the general width and the four side widths (a side override must not survive "all"). */
  width: ownsGroups(widthGroup(), ...SIDES.map(widthGroup)),
  sideWidth: (side: Side) => ownsGroups(widthGroup(side)),
  color: (token: string) => isBorderColor(token) || SIDES.some(side => isBorderColor(token, side)),
  sideColor: (side: Side): Owns => token => isBorderColor(token, side),
  style: ownsGroups('standalone:borderStyle'),
};

const SIDE_NAMES: Record<Side, string> = { t: 'Top', r: 'Right', b: 'Bottom', l: 'Left' };

// Check if sides have different values
const sidesAreDifferent = (classes: string): boolean => {
  const widths = SIDES.map(s => parseBorderWidth(classes, s));
  const allSame = widths.every(w => w === widths[0]);
  if (!allSame) return true;

  const colors = SIDES.map(s => parseBorderColor(classes, s));
  return !colors.every(c => c === colors[0]);
};

// ============================================================================
// Component
// ============================================================================

interface StrokeBlockProps {
  classes: string;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
}

export const StrokeBlock: React.FC<StrokeBlockProps> = ({
  classes,
  onClassesChange
}) => {
  // Parse all values using useMemo
  const {
    borderWidth,
    borderColorClass,
    borderStyle,
    sideWidths,
    sideColors,
    shouldExpand,
    collapsedWidthDisplay,
    collapsedColorDisplay,
    hasDifferentWidths,
    hasDifferentColors
  } = useMemo(() => {
    const width = parseBorderWidth(classes);
    const color = parseBorderColor(classes);
    const style = parseBorderStyle(classes) || 'solid';

    const sideW: Record<Side, number> = {
      t: sideWidth(classes, 't'), r: sideWidth(classes, 'r'), b: sideWidth(classes, 'b'), l: sideWidth(classes, 'l')
    };

    const sideC: Record<Side, string> = {
      t: sideColor(classes, 't'), r: sideColor(classes, 'r'), b: sideColor(classes, 'b'), l: sideColor(classes, 'l')
    };

    // Check if widths are different
    const widthValues = SIDES.map(s => sideW[s]);
    const differentWidths = !widthValues.every(w => w === widthValues[0]);

    // Check if colors are different
    const colorValues = SIDES.map(s => sideC[s]);
    const differentColors = !colorValues.every(c => c === colorValues[0]);

    // Create comma-separated display for collapsed mode
    const widthDisplay = differentWidths ? widthValues.join(', ') : String(widthValues[0]);

    // For colors, extract just the color name for display
    const colorDisplay = differentColors
      ? colorValues.map(c => c.replace(/^border-[trbl]-/, '').replace(/^border-/, '') || '-').join(', ')
      : '';

    return {
      borderWidth: width,
      borderColorClass: color,
      borderStyle: style,
      sideWidths: sideW,
      sideColors: sideC,
      shouldExpand: sidesAreDifferent(classes),
      collapsedWidthDisplay: widthDisplay,
      collapsedColorDisplay: colorDisplay,
      hasDifferentWidths: differentWidths,
      hasDifferentColors: differentColors
    };
  }, [classes]);

  const [expanded, setExpanded] = useState(false);

  // Several selected: each control compares its OWN reader across members (design C6).
  const mixed = {
    width: useMixedValue(READ.widths),
    color: useMixedValue(READ.colors),
    style: useMixedValue(READ.style),
    sideWidth: { t: useMixedValue(READ.sideWidth.t), r: useMixedValue(READ.sideWidth.r), b: useMixedValue(READ.sideWidth.b), l: useMixedValue(READ.sideWidth.l) },
    sideColor: { t: useMixedValue(READ.sideColor.t), r: useMixedValue(READ.sideColor.r), b: useMixedValue(READ.sideColor.b), l: useMixedValue(READ.sideColor.l) },
  };

  // Auto-expand when sides are different
  useEffect(() => {
    if (shouldExpand) setExpanded(true);
  }, [shouldExpand]);

  // Handle width change - immediate update
  const handleBorderWidthChange = useCallback((value: string, side?: Side) => {
    const width = parseInt(value, 10);
    const sidePrefix = side ? `-${side}` : '';

    // Remove old border width classes for this side
    let newClasses = classes;
    if (side) {
      newClasses = setClass(newClasses, new RegExp(`^border-${side}(-0|-2|-4|-8|-\\[\\d+px\\])?$`), null);
    } else {
      newClasses = setClass(newClasses, /^border(-0|-2|-4|-8|-\[\d+px\])?$/, null);
    }

    if (!isNaN(width) && width > 0) {
      // Add width class
      let widthClass = '';
      if (width === 1) {
        widthClass = `border${sidePrefix}`;
      } else if ([2, 4, 8].includes(width)) {
        widthClass = `border${sidePrefix}-${width}`;
      } else {
        widthClass = `border${sidePrefix}-[${width}px]`;
      }
      newClasses = newClasses + ` ${widthClass}`;

      // Auto-assign black color if no color is set
      // Check both side-specific and general color
      const sideColor = side ? parseBorderColor(newClasses, side) : null;
      const generalColor = parseBorderColor(newClasses);
      const hasColor = sideColor || generalColor;

      if (!hasColor) {
        if (side) {
          newClasses = newClasses + ` border-${side}-black`;
        } else {
          newClasses = newClasses + ' border-black';
        }
      }
    }

    onClassesChange(newClasses.trim(), side ? OWNS.sideWidth(side) : OWNS.width);
  }, [classes, onClassesChange]);

  const handleBorderColorChange = useCallback((colorClass: string, hex: string, side?: Side) => {
    // Remove old border color classes for this side (widths, styles and unknown classes stay)
    let newClasses = classes.split(/\s+/).filter(token => token && !isBorderColor(token, side)).join(' ');

    if (colorClass) {
      // Replace the prefix if we're setting a side-specific color
      if (side && colorClass.startsWith('border-')) {
        const colorPart = colorClass.replace('border-', '');
        newClasses = newClasses + ` border-${side}-${colorPart}`;
      } else {
        newClasses = newClasses + ` ${colorClass}`;
      }
    }

    onClassesChange(newClasses.trim(), side ? OWNS.sideColor(side) : OWNS.color);
  }, [classes, onClassesChange]);

  const handleBorderStyleChange = useCallback((style: string) => {
    let newClasses = setClass(classes, /^border-(solid|dashed|dotted|double|none)$/, null);

    if (style && style !== 'solid') {
      newClasses = newClasses + ` border-${style}`;
    }

    onClassesChange(newClasses.trim(), OWNS.style);
  }, [classes, onClassesChange]);

  return (
    <div className="space-y-1">
      {/* Width/Color inputs with expand button */}
      <div className="flex items-start">
        {/* Input area */}
        <div className="flex-1">
          {expanded ? (
            /* Expanded: 4 side inputs stacked */
            <div className="space-y-1">
              {SIDES.map(side => {
                const SideIcon = SIDE_ICONS[side];
                return (
                  <div key={side} className="grid grid-cols-3 gap-1">
                    <Field
                      icon={<SideIcon className="w-4 h-4" />}
                      aria-label={`${SIDE_NAMES[side]} stroke width`}
                      mixed={mixed.sideWidth[side]}
                      value={String(sideWidths[side])}
                      onChange={(val) => handleBorderWidthChange(val, side)}
                      type="number"
                      placeholder="0"
                      min={0}
                    />
                    <div className="col-span-2">
                      <ColorPicker
                        value={sideColors[side]}
                        mixed={mixed.sideColor[side]}
                        onChange={(colorClass, hex) => handleBorderColorChange(colorClass, hex, side)}
                        prefix="border"
                        placeholder="None"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Collapsed: Width and Color side by side */
            <div className="grid grid-cols-3 gap-1">
              <Field
                icon={<StrokeWidthIcon className="w-4 h-4" />}
                aria-label="Stroke width"
                mixed={mixed.width}
                value={hasDifferentWidths ? collapsedWidthDisplay : String(borderWidth)}
                onChange={(val) => handleBorderWidthChange(val)}
                type={hasDifferentWidths ? 'text' : 'number'}
                placeholder="0"
                min={0}
                disabled={hasDifferentWidths}
              />
              <div className="col-span-2">
                <ColorPicker
                  value={hasDifferentColors ? '' : borderColorClass}
                  mixed={mixed.color}
                  onChange={(colorClass, hex) => handleBorderColorChange(colorClass, hex)}
                  prefix="border"
                  placeholder={hasDifferentColors ? collapsedColorDisplay : 'None'}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center h-7 ml-1 pr-1">
          <IconButton
            onClick={() => setExpanded(!expanded)}
            title={expanded ? 'Collapse to all sides' : 'Expand to individual sides'}
            className={`relative rounded ${
              expanded
                ? 'text-accent bg-accent/20 hover:bg-accent/30 hover:text-accent'
                : 'bg-transparent text-text-secondary hover:text-text hover:bg-bg-hover'
            }`}
          >
            <IndividualIcon className="w-4 h-4" />
          </IconButton>
        </div>
      </div>

      {/* Border Style - always visible */}
      <div className="pr-8 pb-2">
        <SegmentedControl
          options={BORDER_STYLE_OPTIONS}
          value={borderStyle}
          mixed={mixed.style}
          onChange={handleBorderStyleChange}
        />
      </div>
    </div>
  );
};

export default StrokeBlock;
