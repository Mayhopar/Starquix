import { OpacityIcon as SharedOpacityIcon } from '@/assets/icons';
/**
 * Appearance Block - Opacity, Z-Index, Scale, Border Radius, Visibility, Overflow, Cursor controls
 *
 * Layout:
 * - Row 1: [Opacity icon + input %] [Z + input]
 * - Row 2: [Scale icon + input %] [Radius icon + input] (+ 4 corner inputs 2x2 when expanded)
 * - Row 3: Visibility pill buttons
 * - Row 4: Overflow pill buttons
 * - Row 5: Cursor pill buttons
 */

import React, { useState, useCallback, useMemo } from 'react';
import { findClass, setClass } from '../utils';
import { resolveToClass, optimizeBorderRadiusClasses } from '@/core/classes/vocabulary';
import { IndividualIcon, ScaleIcon, RadiusTlIcon, RadiusTrIcon, RadiusBlIcon, RadiusBrIcon } from '@/assets/icons';
import { SegmentedControl, Field, InputGroup, Row, IconButton } from '@/components/ui';
import { useMixedValue, useMultiMembers, ownsGroups, type Owns } from '../multi/mixed';

// ============================================================================
// Icons
// ============================================================================

const OpacityIcon: React.FC<{ className?: string }> = ({ className }) => (
  <SharedOpacityIcon className={className} />
);


// ============================================================================
// Constants
// ============================================================================

const VISIBILITY_OPTIONS = [
  { value: 'visible', label: 'Visible' },
  {
    value: 'other',
    label: 'Other',
    dropdown: [
      { value: 'invisible', label: 'Invisible' },
      { value: 'hidden', label: 'Hidden' }
    ]
  }
];

const OVERFLOW_OPTIONS = [
  { value: '', label: 'Visible' },
  {
    value: 'other',
    label: 'Other',
    dropdown: [
      { value: 'hidden', label: 'Hidden' },
      { value: 'scroll', label: 'Scroll' },
      { value: 'auto', label: 'Auto' }
    ]
  }
];

const CURSOR_SELECT_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'pointer', label: 'Pointer' },
  { value: 'move', label: 'Move' },
  { value: 'text', label: 'Text' },
  { value: 'wait', label: 'Wait' },
  { value: 'not-allowed', label: 'Not allowed' },
  { value: 'grab', label: 'Grab' }
];

type Corner = 'tl' | 'tr' | 'bl' | 'br';
const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

// Regex patterns - defined once for reuse
const ROUNDED_GENERAL_PATTERN = /^rounded(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\[\d+px\])?$/;
const ROUNDED_ARBITRARY_PATTERN = /^rounded-\[(\d+)px\]$/;
// Uniform scale only (scale-x-*/scale-y-* untouched)
const SCALE_PATTERN = /^scale-(\d+|\[\d*\.?\d+%?\])$/;
const TW_SCALE_STEPS = new Set([0, 50, 75, 90, 95, 100, 105, 110, 125, 150]);

// ============================================================================
// Helpers
// ============================================================================

const parseOpacity = (classes: string): number => {
  const token = findClass(classes, /^opacity-(\d+|\[\d+(?:\.\d+)?%?\])$/);
  if (!token) return 100;

  const match = token.match(/^opacity-(.+)$/);
  if (!match) return 100;

  const suffix = match[1];

  // Arbitrary value: opacity-[0.5] or opacity-[50%]
  const arbitrary = suffix.match(/^\[(\d+(?:\.\d+)?)(%)?\]$/);
  if (arbitrary) {
    const val = parseFloat(arbitrary[1]);
    if (arbitrary[2] === '%') return val;
    return val <= 1 ? val * 100 : val;
  }

  // Standard scale (0-100)
  const num = parseInt(suffix, 10);
  return !isNaN(num) ? num : 100;
};

// scale-110 → 110, scale-[1.2] → 120, scale-[120%] → 120; none → 100
const parseScale = (classes: string): number => {
  const token = findClass(classes, SCALE_PATTERN);
  const m = token?.match(/^scale-(?:(\d+)|\[(\d*\.?\d+)(%)?\])$/);
  if (!m) return 100;
  if (m[1]) return parseInt(m[1], 10);
  const val = parseFloat(m[2]);
  return Math.round(m[3] ? val : val * 100);
};

const parseZIndex = (classes: string): string => {
  const arbitraryToken = findClass(classes, /^z-\[.+\]$/);
  if (arbitraryToken) {
    const match = arbitraryToken.match(/^z-\[(.+)\]$/);
    return match ? match[1] : '';
  }

  const token = findClass(classes, /^z-(\d+)$/);
  if (!token) return '';

  const match = token.match(/^z-(\d+)$/);
  return match ? match[1] : '';
};

const parseRounded = (classes: string): number => {
  // Check for arbitrary value: rounded-[8px]
  const arbitraryToken = findClass(classes, ROUNDED_ARBITRARY_PATTERN);
  if (arbitraryToken) {
    const match = arbitraryToken.match(ROUNDED_ARBITRARY_PATTERN);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Check for scale values and convert to approximate px
  if (findClass(classes, /^rounded-none$/)) return 0;
  if (findClass(classes, /^rounded-sm$/)) return 2;
  if (findClass(classes, /^rounded$/)) return 4;
  if (findClass(classes, /^rounded-md$/)) return 6;
  if (findClass(classes, /^rounded-lg$/)) return 8;
  if (findClass(classes, /^rounded-xl$/)) return 12;
  if (findClass(classes, /^rounded-2xl$/)) return 16;
  if (findClass(classes, /^rounded-3xl$/)) return 24;
  if (findClass(classes, /^rounded-full$/)) return 9999;

  return 0;
};

// Parse corner-specific radius, returns null if not explicitly set
const parseCornerRoundedExplicit = (classes: string, corner: Corner): number | null => {
  // Check for arbitrary value: rounded-tl-[8px]
  const arbitraryPattern = new RegExp(`^rounded-${corner}-\\[(\\d+)px\\]$`);
  const arbitraryToken = findClass(classes, arbitraryPattern);
  if (arbitraryToken) {
    const match = arbitraryToken.match(arbitraryPattern);
    return match ? parseInt(match[1], 10) : 0;
  }

  // Check for scale values
  if (findClass(classes, new RegExp(`^rounded-${corner}-none$`))) return 0;
  if (findClass(classes, new RegExp(`^rounded-${corner}-sm$`))) return 2;
  if (findClass(classes, new RegExp(`^rounded-${corner}$`))) return 4;
  if (findClass(classes, new RegExp(`^rounded-${corner}-md$`))) return 6;
  if (findClass(classes, new RegExp(`^rounded-${corner}-lg$`))) return 8;
  if (findClass(classes, new RegExp(`^rounded-${corner}-xl$`))) return 12;
  if (findClass(classes, new RegExp(`^rounded-${corner}-2xl$`))) return 16;
  if (findClass(classes, new RegExp(`^rounded-${corner}-3xl$`))) return 24;
  if (findClass(classes, new RegExp(`^rounded-${corner}-full$`))) return 9999;

  return null; // Not explicitly set
};

const hasCornerSpecificClasses = (classes: string): boolean => {
  for (const corner of CORNERS) {
    if (parseCornerRoundedExplicit(classes, corner) !== null) return true;
  }
  return false;
};

const parseVisibility = (classes: string): string => {
  if (findClass(classes, /^hidden$/)) return 'hidden';
  if (findClass(classes, /^invisible$/)) return 'invisible';
  return 'visible';
};

const parseOverflow = (classes: string): string => {
  const token = findClass(classes, /^overflow-(visible|hidden|scroll|auto)$/);
  if (!token) return '';
  const match = token.match(/^overflow-(.+)$/);
  return match && match[1] !== 'visible' ? match[1] : '';
};

const parseCursor = (classes: string): string => {
  const token = findClass(classes, /^cursor-(default|pointer|move|text|wait|help|not-allowed|grab|grabbing)$/);
  if (!token) return '';
  const match = token.match(/^cursor-(.+)$/);
  return match && match[1] !== 'default' ? match[1] : '';
};

// Helper to remove all rounded classes
const removeAllRoundedClasses = (classes: string): string => {
  let result = classes;
  // Remove general rounded
  result = setClass(result, ROUNDED_GENERAL_PATTERN, null);
  // Remove corner-specific
  for (const corner of CORNERS) {
    result = setClass(result, new RegExp(`^rounded-${corner}(-none|-sm|-md|-lg|-xl|-2xl|-3xl|-full|-\\[\\d+px\\])?$`), null);
  }
  return result;
};

/** Each corner as the fields show it: its own token, else the general radius. */
const cornerValues = (classes: string): Record<Corner, number> => {
  const general = parseRounded(classes);
  const value = (corner: Corner) => parseCornerRoundedExplicit(classes, corner) ?? general;
  return { tl: value('tl'), tr: value('tr'), bl: value('bl'), br: value('br') };
};

// ============================================================================
// Several selected — each control's own reader ("Mixed", design C6) and what
// each write owns (only those tokens change on every member, design §2)
// ============================================================================

const CORNER_READERS: Record<Corner, (classes: string) => number> = {
  tl: c => cornerValues(c).tl, tr: c => cornerValues(c).tr, bl: c => cornerValues(c).bl, br: c => cornerValues(c).br,
};
const ownsCorner = (corner: Corner): Owns => {
  const re = new RegExp(`^rounded-${corner}(-|$)`);
  return token => re.test(token);
};
const OWNS = {
  opacity: ownsGroups('opacity-'),
  z: ownsGroups('z-'),
  /** Uniform scale only (scale-x-/scale-y- are their own groups). */
  scale: ownsGroups('scale-'),
  /** Every radius token: general, sides and corners. */
  radius: (t: string) => /^rounded(-|$)/.test(t),
  corner: { tl: ownsCorner('tl'), tr: ownsCorner('tr'), bl: ownsCorner('bl'), br: ownsCorner('br') },
  visibility: (t: string) => /^(visible|invisible|hidden)$/.test(t),
  overflow: ownsGroups('overflow-'),
  cursor: ownsGroups('cursor-'),
};

const CORNER_NAMES: Record<Corner, string> = { tl: 'Top-left', tr: 'Top-right', bl: 'Bottom-left', br: 'Bottom-right' };

// ============================================================================
// Component
// ============================================================================

interface AppearanceBlockProps {
  classes: string;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
}

export const AppearanceBlock: React.FC<AppearanceBlockProps> = ({
  classes,
  onClassesChange
}) => {
  // Parse all values
  const {
    opacity,
    scale,
    zIndex,
    rounded,
    cornerRounded,
    hasCornerClasses,
    allCornersEqual,
    visibility,
    overflow,
    cursor
  } = useMemo(() => {
    const generalRounded = parseRounded(classes);
    const hasCorners = hasCornerSpecificClasses(classes);
    const corners = cornerValues(classes);

    const allEqual = corners.tl === corners.tr &&
                     corners.tr === corners.bl &&
                     corners.bl === corners.br;

    return {
      opacity: parseOpacity(classes),
      scale: parseScale(classes),
      zIndex: parseZIndex(classes),
      rounded: generalRounded,
      cornerRounded: corners,
      hasCornerClasses: hasCorners,
      allCornersEqual: allEqual,
      visibility: parseVisibility(classes),
      overflow: parseOverflow(classes),
      cursor: parseCursor(classes)
    };
  }, [classes]);

  const [expanded, setExpanded] = useState(false);

  // Several selected: each control compares its OWN reader across members (design C6).
  const isMulti = !!useMultiMembers();
  const mixed = {
    opacity: useMixedValue(parseOpacity),
    z: useMixedValue(parseZIndex),
    scale: useMixedValue(parseScale),
    radius: useMixedValue(cornerValues),
    tl: useMixedValue(CORNER_READERS.tl),
    tr: useMixedValue(CORNER_READERS.tr),
    bl: useMixedValue(CORNER_READERS.bl),
    br: useMixedValue(CORNER_READERS.br),
    visibility: useMixedValue(parseVisibility),
    overflow: useMixedValue(parseOverflow),
    cursor: useMixedValue(parseCursor),
  };

  // Handlers
  const handleOpacityChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^opacity-(\d+|\[.+\])$/, null);

    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue >= 0 && numValue <= 100) {
      if (numValue === 100) {
        // 100% is default, no class needed
      } else {
        const opacityClass = resolveToClass('opacity', numValue);
        newClasses = newClasses + ' ' + opacityClass;
      }
    }

    onClassesChange(newClasses.trim(), OWNS.opacity);
  }, [classes, onClassesChange]);

  const handleScaleChange = useCallback((value: string) => {
    let newClasses = setClass(classes, SCALE_PATTERN, null);
    const n = parseInt(value, 10);
    // 100% is default, no class needed; off-scale values go arbitrary (Tailwind v3 + v4)
    if (!isNaN(n) && n >= 0 && n !== 100) {
      newClasses += TW_SCALE_STEPS.has(n) ? ` scale-${n}` : ` scale-[${n / 100}]`;
    }
    onClassesChange(newClasses.trim(), OWNS.scale);
  }, [classes, onClassesChange]);

  const handleZIndexChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^z-(auto|\d+|\[.+\])$/, null);

    if (value !== '') {
      const numValue = parseInt(value, 10);
      if (!isNaN(numValue)) {
        const zClass = resolveToClass('z', numValue);
        newClasses = newClasses + ' ' + zClass;
      }
    }

    onClassesChange(newClasses.trim(), OWNS.z);
  }, [classes, onClassesChange]);

  const handleRoundedChange = useCallback((value: string) => {
    // Remove all rounded classes
    let newClasses = removeAllRoundedClasses(classes);

    // Add new class if value is valid
    const numValue = parseInt(value, 10);
    if (!isNaN(numValue) && numValue > 0) {
      const radiusClass = resolveToClass('rounded', numValue, 'px');
      newClasses = newClasses + ' ' + radiusClass;
    }

    onClassesChange(newClasses.trim(), OWNS.radius);
  }, [classes, onClassesChange]);

  const handleCornerRoundedChange = useCallback((corner: Corner, value: string) => {
    const numValue = parseInt(value, 10);
    const cornerValue = !isNaN(numValue) && numValue >= 0 ? numValue : 0;

    // Several selected: ONLY this corner's token (0 stays explicit: a member's general radius must not show
    // through) — never re-normalized from the shown values, which are Mixed/merged (design §2).
    if (isMulti) {
      onClassesChange(resolveToClass(`rounded-${corner}`, cornerValue, 'px'), OWNS.corner[corner]);
      return;
    }

    // Remove all rounded classes first
    let newClasses = removeAllRoundedClasses(classes);

    // Get current effective values for all corners
    const currentValues = {
      tl: cornerRounded.tl,
      tr: cornerRounded.tr,
      bl: cornerRounded.bl,
      br: cornerRounded.br
    };

    // Update the changed corner
    currentValues[corner] = cornerValue;

    // Use vocabulary to optimize corner classes
    const optimizedClasses = optimizeBorderRadiusClasses(currentValues);
    newClasses = newClasses + ' ' + optimizedClasses.join(' ');

    onClassesChange(newClasses.trim(), OWNS.radius);
  }, [classes, cornerRounded, onClassesChange, isMulti]);

  // Handle expand/collapse with class conversion
  const handleToggleExpand = useCallback(() => {
    if (isMulti) { setExpanded(!expanded); return; } // UI-only while ≥2 are selected (design §2)
    if (!expanded) {
      // Expanding: convert single rounded to 4 corner classes
      if (rounded > 0 && !hasCornerClasses) {
        let newClasses = removeAllRoundedClasses(classes);
        const cornerClasses = optimizeBorderRadiusClasses({
          tl: rounded, tr: rounded, bl: rounded, br: rounded
        });
        newClasses = newClasses + ' ' + cornerClasses.join(' ');
        onClassesChange(newClasses.trim(), OWNS.radius);
      }
      setExpanded(true);
    } else {
      // Collapsing: always allow, convert to single if all same
      if (allCornersEqual) {
        let newClasses = removeAllRoundedClasses(classes);
        if (cornerRounded.tl > 0) {
          const radiusClass = resolveToClass('rounded', cornerRounded.tl, 'px');
          newClasses = newClasses + ' ' + radiusClass;
        }
        onClassesChange(newClasses.trim(), OWNS.radius);
      }
      // If corners are different, keep corner classes but collapse UI
      setExpanded(false);
    }
  }, [expanded, rounded, cornerRounded, hasCornerClasses, allCornersEqual, classes, onClassesChange, isMulti]);

  const handleVisibilityChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^(visible|invisible|hidden)$/, null);

    if (value === 'hidden') {
      newClasses = newClasses + ' hidden';
    } else if (value === 'invisible') {
      newClasses = newClasses + ' invisible';
    }
    // visible is default, no class needed

    onClassesChange(newClasses.trim(), OWNS.visibility);
  }, [classes, onClassesChange]);

  const handleOverflowChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^overflow-(visible|hidden|scroll|auto)$/, null);

    if (value) {
      newClasses = newClasses + ` overflow-${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.overflow);
  }, [classes, onClassesChange]);

  const handleCursorChange = useCallback((value: string) => {
    let newClasses = setClass(classes, /^cursor-(default|pointer|move|text|wait|help|not-allowed|grab|grabbing)$/, null);

    if (value) {
      newClasses = newClasses + ` cursor-${value}`;
    }

    onClassesChange(newClasses.trim(), OWNS.cursor);
  }, [classes, onClassesChange]);

  return (
    <div className="pb-2 gap-y-1 flex flex-col">
      {/* Row 1: Opacity + Z-Index */}
      <InputGroup layout="dual" className='pr-8'>
        <Field
          icon={<OpacityIcon className="w-4 h-4" />}
          aria-label="Opacity"
          mixed={mixed.opacity}
          value={opacity}
          onChange={handleOpacityChange}
          unit="%"
          type="number"
          min={0}
          max={100}
        />
        <Field
          label="Z"
          aria-label="Z index"
          mixed={mixed.z}
          value={zIndex}
          onChange={handleZIndexChange}
          type="number"
          placeholder="auto"
        />
      </InputGroup>

      {/* Row 2: Scale + Border Radius (+ 2x2 corner grid when expanded) with expand button */}
      <div className="flex items-start">
        {/* Input area */}
        <div className="flex-1 flex flex-col gap-y-1">
          <InputGroup layout="dual">
            <Field
              icon={<ScaleIcon className="w-4 h-4" />}
              aria-label="Scale"
              title="Scale"
              mixed={mixed.scale}
              value={scale}
              onChange={handleScaleChange}
              unit="%"
              type="number"
              min={0}
            />
            <Field
              icon={<RadiusTlIcon className="w-4 h-4" />}
              aria-label="Corner radius"
              mixed={mixed.radius}
              value={allCornersEqual ? rounded : ''}
              onChange={handleRoundedChange}
              type="number"
              placeholder={allCornersEqual ? '0' : `${cornerRounded.tl}, ${cornerRounded.tr}, ${cornerRounded.bl}, ${cornerRounded.br}`}
              min={0}
            />
          </InputGroup>
          {expanded && (
            /* Expanded: 4 corner inputs in 2x2 grid */
            <div className="grid grid-cols-2 gap-1">
              <Field
                icon={<RadiusTlIcon className="w-4 h-4" />}
                aria-label={`${CORNER_NAMES.tl} radius`}
                mixed={mixed.tl}
                value={cornerRounded.tl}
                onChange={(v) => handleCornerRoundedChange('tl', v)}
                type="number"
                placeholder="0"
                min={0}
              />
              <Field
                icon={<RadiusTrIcon className="w-4 h-4" />}
                aria-label={`${CORNER_NAMES.tr} radius`}
                mixed={mixed.tr}
                value={cornerRounded.tr}
                onChange={(v) => handleCornerRoundedChange('tr', v)}
                type="number"
                placeholder="0"
                min={0}
              />
              <Field
                icon={<RadiusBlIcon className="w-4 h-4" />}
                aria-label={`${CORNER_NAMES.bl} radius`}
                mixed={mixed.bl}
                value={cornerRounded.bl}
                onChange={(v) => handleCornerRoundedChange('bl', v)}
                type="number"
                placeholder="0"
                min={0}
              />
              <Field
                icon={<RadiusBrIcon className="w-4 h-4" />}
                aria-label={`${CORNER_NAMES.br} radius`}
                mixed={mixed.br}
                value={cornerRounded.br}
                onChange={(v) => handleCornerRoundedChange('br', v)}
                type="number"
                placeholder="0"
                min={0}
              />
            </div>
          )}
        </div>

        <div className="flex items-center h-7 ml-1 pr-1">
          <IconButton
            onClick={handleToggleExpand}
            title={expanded ? 'Collapse to single input' : 'Expand to individual corners'}
            className={`relative rounded bg-transparent hover:bg-transparent ${
              expanded ? 'text-accent hover:text-accent' : 'text-text-secondary hover:text-accent'
            }`}
          >
            {expanded && <span className="absolute inset-0 bg-accent opacity-20 rounded" />}
            <IndividualIcon className="w-4 h-4 relative z-10" />
          </IconButton>
        </div>
      </div>

      {/* Row 4: Visibility (no label) */}
      <div className="pr-8">
        <SegmentedControl
          options={VISIBILITY_OPTIONS}
          value={visibility}
          mixed={mixed.visibility}
          onChange={handleVisibilityChange}
        />
      </div>

      {/* Row 5: Overflow */}
      <div className="pr-8">
        <Row title="Overflow" size="sm" />
        <SegmentedControl
          options={OVERFLOW_OPTIONS}
          value={overflow}
          mixed={mixed.overflow}
          onChange={handleOverflowChange}
        />
      </div>

      {/* Row 6: Cursor */}
      <div className="pr-8">
        <Row title="Cursor" size="sm" />
        <Field
          as="select"
          aria-label="Cursor"
          mixed={mixed.cursor}
          value={cursor}
          onChange={handleCursorChange}
          options={CURSOR_SELECT_OPTIONS}
        />
      </div>
    </div>
  );
};

export default AppearanceBlock;
