/**
 * Spacing Block - Figma-style
 *
 * Compact controls for margin and padding.
 * Default: X (horizontal) and Y (vertical) inputs
 * Expanded: Individual T, R, B, L inputs
 * Supports multiple units: px, %, vh, vw, rem, em
 * Supports auto margins for centering (mx-auto, ml-auto, etc.)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { parseSpacing, createSpacingClass, setClass, findClass } from '../utils';
import { optimizeSpacingClasses, type FourSides } from '@/core/classes/vocabulary';
import { Field, UnitField, IconButton, type UnitFieldProps } from '@/components/ui';
import { Row } from '@/components/ui';
import {
  PaddingXIcon,
  PaddingYIcon,
  PaddingTopIcon,
  PaddingRightIcon,
  PaddingBottomIcon,
  PaddingLeftIcon,
  MarginXIcon,
  MarginYIcon,
  MarginTopIcon,
  MarginRightIcon,
  MarginBottomIcon,
  MarginLeftIcon,
  IndividualIcon
} from '@/assets/icons';
import { useMixedValue, useMultiMembers, type Owns } from '../multi/mixed';

type Side = 't' | 'r' | 'b' | 'l';
type SpacingType = 'p' | 'm';
type SpacingField = Side | 'x' | 'y';

interface SpacingValue {
  value: string;
  unit: string;
  isAuto?: boolean;
}

interface SpacingValues {
  t: SpacingValue;
  r: SpacingValue;
  b: SpacingValue;
  l: SpacingValue;
}

const UNIT_OPTIONS = [
  { value: 'px', label: 'px' },
  { value: '%', label: '%' },
  { value: 'vh', label: 'vh' },
  { value: 'vw', label: 'vw' },
  { value: 'rem', label: 'rem' },
  { value: 'em', label: 'em' }
];

const UNIT_OPTIONS_WITH_AUTO = [
  ...UNIT_OPTIONS,
  { value: 'auto', label: 'auto' }
];


// Parse auto margin from classes
const parseAutoMargin = (classes: string, side: Side): boolean => {
  // Check for individual side auto: mt-auto, mr-auto, mb-auto, ml-auto
  if (findClass(classes, new RegExp(`^m${side}-auto$`))) {
    return true;
  }
  // Check for axis auto: mx-auto affects l and r, my-auto affects t and b
  if ((side === 'l' || side === 'r') && findClass(classes, /^mx-auto$/)) {
    return true;
  }
  if ((side === 't' || side === 'b') && findClass(classes, /^my-auto$/)) {
    return true;
  }
  return false;
};

/** One side as the block reads it (side → axis → all; margin auto) — the per-field "Mixed" reader. */
const sideValue = (classes: string, type: SpacingType, side: Side): string => {
  if (type === 'm' && parseAutoMargin(classes, side)) return 'auto';
  const own = parseSpacing(classes, type, side);
  const axis = parseSpacing(classes, type, side === 't' || side === 'b' ? 'y' : 'x');
  const v = own.value !== null ? own : axis.value !== null ? axis : parseSpacing(classes, type, '');
  return v.value === null ? '' : `${v.value}${v.unit}`;
};
const FIELD_SIDES: Record<SpacingField, Side[]> = { y: ['t', 'b'], x: ['l', 'r'], t: ['t'], r: ['r'], b: ['b'], l: ['l'] };
/** Stable module-level readers per (type, field): Y compares T+B, X compares L+R (design C6). */
const READERS = Object.fromEntries((['p', 'm'] as const).map(type => [type, Object.fromEntries(
  (Object.keys(FIELD_SIDES) as SpacingField[]).map(field =>
    [field, (classes: string) => FIELD_SIDES[field].map(side => sideValue(classes, type, side))]),
)])) as Record<SpacingType, Record<SpacingField, (classes: string) => string[]>>;

/** What an edit of `sides` owns: those sides' utilities only (margin incl. negative and auto) — never the
 *  axis or all-sides shorthand, which members keep (side utilities win over them in Tailwind's order). */
const ownsSides = (type: SpacingType, sides: Side[]): Owns => {
  const re = new RegExp(`^${type === 'm' ? '-?m' : 'p'}[${sides.join('')}]-`);
  return token => re.test(token);
};

const SIDE_NAMES: Record<Side, string> = { t: 'top', r: 'right', b: 'bottom', l: 'left' };

// Icon mapping for padding sides (swapped: top↔bottom, left↔right)
const PADDING_ICONS = {
  t: PaddingBottomIcon,
  r: PaddingLeftIcon,
  b: PaddingTopIcon,
  l: PaddingRightIcon
};

// Icon mapping for margin sides
const MARGIN_ICONS = {
  t: MarginTopIcon,
  r: MarginRightIcon,
  b: MarginBottomIcon,
  l: MarginLeftIcon
};

// Helper for arrow key handling on inputs
const handleArrowKeys = (
  e: React.KeyboardEvent<HTMLInputElement>,
  currentValue: string,
  onChange: (value: string) => void,
  allowNegative: boolean = false
) => {
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const numValue = parseFloat(currentValue) || 0;
    const newValue = e.key === 'ArrowUp' ? numValue + step : numValue - step;
    // Padding can't be negative, margin can
    const finalValue = allowNegative ? newValue : Math.max(0, newValue);
    onChange(finalValue.toString());
  }
};

/**
 * Numeric spacing input. Padding is purely numeric → UnitField (type=number);
 * margin stays a text input so typing "auto" keeps working (the number input
 * would swallow it). Both pass the custom arrow-key handler through.
 */
const SpacingField: React.FC<UnitFieldProps & { spacingType: SpacingType }> = ({ spacingType, ...props }) =>
  spacingType === 'p' ? <UnitField {...props} /> : <Field {...props} type="text" />;

/** Unit dropdown rendered in the Field trailing slot. */
const unitSelectClass =
  'w-4 h-4 text-3xs text-text-secondary bg-transparent outline-none cursor-pointer appearance-none text-center';

// Compact spacing control (Figma-style)
interface SpacingControlProps {
  label: string;
  type: SpacingType;
  values: SpacingValues;
  expanded: boolean;
  onToggleExpand: () => void;
  onValueChange: (side: Side | 'x' | 'y', value: string, unit: string, isAuto?: boolean) => void;
  /** Several selected: which fields differ across members (they read "Mixed"). */
  mixed: Record<SpacingField, boolean>;
}

const SpacingControl: React.FC<SpacingControlProps> = ({
  label,
  type,
  values,
  expanded,
  onToggleExpand,
  onValueChange,
  mixed
}) => {
  // Calculate X and Y values for collapsed mode
  const xSame = values.l.value === values.r.value && values.l.unit === values.r.unit && values.l.isAuto === values.r.isAuto;
  const ySame = values.t.value === values.b.value && values.t.unit === values.b.unit && values.t.isAuto === values.b.isAuto;
  const xValue = xSame ? values.l : (values.l.value || values.l.isAuto ? values.l : values.r);
  const yValue = ySame ? values.t : (values.t.value || values.t.isAuto ? values.t : values.b);
  const xMixed = (values.l.value !== '' || values.l.isAuto) && (values.r.value !== '' || values.r.isAuto) && !xSame;
  const yMixed = (values.t.value !== '' || values.t.isAuto) && (values.b.value !== '' || values.b.isAuto) && !ySame;

  return (
    <div className="mb-2">
      {/* Header with label */}
      <Row title={label} size="sm" className="text-text-muted" />

      {/* Inputs with expand button */}
      <div className="flex items-start">
        {/* Input area */}
        <div className="flex-1">
          {expanded ? (
            /* Expanded: 4 individual inputs in 2x2 grid */
            <div className="grid grid-cols-2 gap-1">
              {(['t', 'l', 'b', 'r'] as Side[]).map(side => {
                const Icon = type === 'p' ? PADDING_ICONS[side] : MARGIN_ICONS[side];
                return values[side].isAuto && type === 'm' && !mixed[side] ? (
                  <div key={side} className="flex items-center h-7 border border-input-stroke rounded-inner overflow-hidden bg-input-fill">
                    <span className="w-4 h-4 ml-1 flex items-center justify-center shrink-0 text-text-secondary">
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="flex-1 flex items-center">
                      <span className="flex-1 py-1 px-1 text-xs text-text">auto</span>
                      <IconButton
                        size="sm"
                        onClick={() => onValueChange(side, '', 'px', false)}
                        className="w-auto h-auto px-1 bg-transparent hover:bg-transparent text-3xs text-text-secondary hover:text-text"
                        title="Remove auto"
                      >
                        ×
                      </IconButton>
                    </div>
                  </div>
                ) : (
                  <SpacingField
                    key={side}
                    spacingType={type}
                    aria-label={`${label} ${SIDE_NAMES[side]}`}
                    mixed={mixed[side]}
                    icon={<Icon className="w-4 h-4" />}
                    value={values[side].value}
                    onChange={val => {
                      if (val.toLowerCase() === 'auto' && type === 'm') {
                        onValueChange(side, '', 'px', true);
                      } else {
                        onValueChange(side, val, values[side].unit, false);
                      }
                    }}
                    onKeyDown={e => handleArrowKeys(e, values[side].value, val => onValueChange(side, val, values[side].unit, false), type === 'm')}
                    placeholder={type === 'm' ? 'auto' : '0'}
                    trailing={
                      <select
                        className={unitSelectClass}
                        value={values[side].unit}
                        // A unit alone on a Mixed field has no value to carry: it would clear every member.
                        onChange={(e) => { if (!mixed[side]) onValueChange(side, values[side].value, e.target.value, false); }}
                      >
                        {(type === 'm' ? UNIT_OPTIONS_WITH_AUTO : UNIT_OPTIONS).map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    }
                  />
                );
              })}
            </div>
          ) : (
            /* Collapsed: Y and X inputs side by side */
            <div className="grid grid-cols-2 gap-1">
              {yValue.isAuto && type === 'm' && !mixed.y ? (
                <div className="flex items-center h-7 border border-input-stroke rounded-inner overflow-hidden bg-input-fill">
                  <span className="w-4 h-4 ml-1 flex items-center justify-center shrink-0 text-text-secondary">
                    <MarginYIcon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 flex items-center">
                    <span className="flex-1 py-1 px-1 text-xs text-text">auto</span>
                    <IconButton
                      size="sm"
                      onClick={() => onValueChange('y', '', 'px', false)}
                      className="w-auto h-auto px-1 bg-transparent hover:bg-transparent text-3xs text-text-secondary hover:text-text"
                      title="Remove auto"
                    >
                      ×
                    </IconButton>
                  </div>
                </div>
              ) : (
                <SpacingField
                  spacingType={type}
                  aria-label={`${label} Y`}
                  mixed={mixed.y}
                  icon={type === 'p' ? <PaddingYIcon className="w-4 h-4" /> : <MarginYIcon className="w-4 h-4" />}
                  value={yMixed ? '' : yValue.value}
                  onChange={val => {
                    if (val.toLowerCase() === 'auto' && type === 'm') {
                      onValueChange('y', '', 'px', true);
                    } else {
                      onValueChange('y', val, yValue.unit, false);
                    }
                  }}
                  onKeyDown={e => handleArrowKeys(e, yValue.value, val => onValueChange('y', val, yValue.unit, false), type === 'm')}
                  placeholder={yMixed ? '~' : (type === 'm' ? 'auto' : '0')}
                  trailing={
                    <select
                      className={unitSelectClass}
                      value={yValue.unit}
                      onChange={(e) => {
                        if (mixed.y && e.target.value !== 'auto') return; // no value to carry on a Mixed field
                        if (e.target.value === 'auto' && type === 'm') {
                          onValueChange('y', '', 'px', true);
                        } else {
                          onValueChange('y', yValue.value, e.target.value, false);
                        }
                      }}
                    >
                      {(type === 'm' ? UNIT_OPTIONS_WITH_AUTO : UNIT_OPTIONS).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  }
                />
              )}
              {xValue.isAuto && type === 'm' && !mixed.x ? (
                <div className="flex items-center h-7 border border-input-stroke rounded-inner overflow-hidden bg-input-fill">
                  <span className="w-4 h-4 ml-1 flex items-center justify-center shrink-0 text-text-secondary">
                    <MarginXIcon className="w-4 h-4" />
                  </span>
                  <div className="flex-1 flex items-center">
                    <span className="flex-1 py-1 px-1 text-xs text-text">auto</span>
                    <IconButton
                      size="sm"
                      onClick={() => onValueChange('x', '', 'px', false)}
                      className="w-auto h-auto px-1 bg-transparent hover:bg-transparent text-3xs text-text-secondary hover:text-text"
                      title="Remove auto"
                    >
                      ×
                    </IconButton>
                  </div>
                </div>
              ) : (
                <SpacingField
                  spacingType={type}
                  aria-label={`${label} X`}
                  mixed={mixed.x}
                  icon={type === 'p' ? <PaddingXIcon className="w-4 h-4" /> : <MarginXIcon className="w-4 h-4" />}
                  value={xMixed ? '' : xValue.value}
                  onChange={val => {
                    if (val.toLowerCase() === 'auto' && type === 'm') {
                      onValueChange('x', '', 'px', true);
                    } else {
                      onValueChange('x', val, xValue.unit, false);
                    }
                  }}
                  onKeyDown={e => handleArrowKeys(e, xValue.value, val => onValueChange('x', val, xValue.unit, false), type === 'm')}
                  placeholder={xMixed ? '~' : (type === 'm' ? 'auto' : '0')}
                  trailing={
                    <select
                      className={unitSelectClass}
                      value={xValue.unit}
                      onChange={(e) => {
                        if (mixed.x && e.target.value !== 'auto') return; // no value to carry on a Mixed field
                        if (e.target.value === 'auto' && type === 'm') {
                          onValueChange('x', '', 'px', true);
                        } else {
                          onValueChange('x', xValue.value, e.target.value, false);
                        }
                      }}
                    >
                      {(type === 'm' ? UNIT_OPTIONS_WITH_AUTO : UNIT_OPTIONS).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  }
                />
              )}
            </div>
          )}
        </div>

        <div className="flex items-center h-7 ml-1 pr-1">
          <IconButton
            onClick={onToggleExpand}
            title={expanded ? 'Collapse to X/Y' : 'Expand to individual sides'}
            className={
              expanded
                ? 'text-accent bg-accent/20 hover:bg-accent/30 hover:text-accent'
                : 'bg-transparent text-text-secondary hover:text-text hover:bg-bg-hover'
            }
          >
            <IndividualIcon className="w-4 h-4" />
          </IconButton>
        </div>
      </div>
    </div>
  );
};

// Main component
interface SpacingBlockProps {
  classes: string;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
}

export const SpacingBlock: React.FC<SpacingBlockProps> = ({
  classes,
  onClassesChange
}) => {
  // Parse all values using useMemo. Precedence: individual side → axis
  // shorthand (px/py, mx/my) → all-sides shorthand (p-*, m-*). Without the
  // all-sides fallback, a class like `p-10` reads as 0 on every side.
  const { padding, margin, shouldExpandPadding, shouldExpandMargin } = useMemo(() => {
    const ptRaw = parseSpacing(classes, 'p', 't');
    const prRaw = parseSpacing(classes, 'p', 'r');
    const pbRaw = parseSpacing(classes, 'p', 'b');
    const plRaw = parseSpacing(classes, 'p', 'l');

    const pxRaw = parseSpacing(classes, 'p', 'x');
    const pyRaw = parseSpacing(classes, 'p', 'y');
    const pAll = parseSpacing(classes, 'p', '');

    const px = pxRaw.value !== null ? pxRaw : pAll;
    const py = pyRaw.value !== null ? pyRaw : pAll;

    const pt = ptRaw.value !== null ? ptRaw : py;
    const pb = pbRaw.value !== null ? pbRaw : py;
    const pl = plRaw.value !== null ? plRaw : px;
    const pr = prRaw.value !== null ? prRaw : px;

    const mtRaw = parseSpacing(classes, 'm', 't');
    const mrRaw = parseSpacing(classes, 'm', 'r');
    const mbRaw = parseSpacing(classes, 'm', 'b');
    const mlRaw = parseSpacing(classes, 'm', 'l');

    const mxRaw = parseSpacing(classes, 'm', 'x');
    const myRaw = parseSpacing(classes, 'm', 'y');
    const mAll = parseSpacing(classes, 'm', '');

    const mx = mxRaw.value !== null ? mxRaw : mAll;
    const my = myRaw.value !== null ? myRaw : mAll;

    const mt = mtRaw.value !== null ? mtRaw : my;
    const mb = mbRaw.value !== null ? mbRaw : my;
    const ml = mlRaw.value !== null ? mlRaw : mx;
    const mr = mrRaw.value !== null ? mrRaw : mx;

    const mtAuto = parseAutoMargin(classes, 't');
    const mrAuto = parseAutoMargin(classes, 'r');
    const mbAuto = parseAutoMargin(classes, 'b');
    const mlAuto = parseAutoMargin(classes, 'l');

    // Auto-expand if sides have different values or units
    const pxMixed = pt.value !== null && pb.value !== null && (pt.value !== pb.value || pt.unit !== pb.unit);
    const pyMixed = pl.value !== null && pr.value !== null && (pl.value !== pr.value || pl.unit !== pr.unit);
    const mxMixed = ((mt.value !== null || mtAuto) && (mb.value !== null || mbAuto)) &&
      (mt.value !== mb.value || mt.unit !== mb.unit || mtAuto !== mbAuto);
    const myMixed = ((ml.value !== null || mlAuto) && (mr.value !== null || mrAuto)) &&
      (ml.value !== mr.value || ml.unit !== mr.unit || mlAuto !== mrAuto);

    return {
      padding: {
        t: { value: pt.value !== null ? `${pt.value}` : '', unit: pt.unit, isAuto: false },
        r: { value: pr.value !== null ? `${pr.value}` : '', unit: pr.unit, isAuto: false },
        b: { value: pb.value !== null ? `${pb.value}` : '', unit: pb.unit, isAuto: false },
        l: { value: pl.value !== null ? `${pl.value}` : '', unit: pl.unit, isAuto: false }
      } as SpacingValues,
      margin: {
        t: { value: mtAuto ? '' : (mt.value !== null ? `${mt.value}` : ''), unit: mt.unit, isAuto: mtAuto },
        r: { value: mrAuto ? '' : (mr.value !== null ? `${mr.value}` : ''), unit: mr.unit, isAuto: mrAuto },
        b: { value: mbAuto ? '' : (mb.value !== null ? `${mb.value}` : ''), unit: mb.unit, isAuto: mbAuto },
        l: { value: mlAuto ? '' : (ml.value !== null ? `${ml.value}` : ''), unit: ml.unit, isAuto: mlAuto }
      } as SpacingValues,
      shouldExpandPadding: pxMixed || pyMixed,
      shouldExpandMargin: mxMixed || myMixed
    };
  }, [classes]);

  // Several selected: each field compares its own reader across members (design C6). Fixed hook order.
  const isMulti = !!useMultiMembers();
  const mixedPadding: Record<SpacingField, boolean> = {
    y: useMixedValue(READERS.p.y), x: useMixedValue(READERS.p.x),
    t: useMixedValue(READERS.p.t), r: useMixedValue(READERS.p.r), b: useMixedValue(READERS.p.b), l: useMixedValue(READERS.p.l),
  };
  const mixedMargin: Record<SpacingField, boolean> = {
    y: useMixedValue(READERS.m.y), x: useMixedValue(READERS.m.x),
    t: useMixedValue(READERS.m.t), r: useMixedValue(READERS.m.r), b: useMixedValue(READERS.m.b), l: useMixedValue(READERS.m.l),
  };

  const [paddingExpanded, setPaddingExpanded] = useState(false);
  const [marginExpanded, setMarginExpanded] = useState(false);

  // Auto-expand when parsing detects mixed-value padding/margin — but NOT
  // while the user is actively editing one of the compact inputs. Holding ↑
  // on the Y input diverges Y from X, flips `shouldExpandPadding` true, and
  // the auto-expand would unmount the Y input mid-edit, killing focus and
  // routing further keys to the iframe. Guard via `document.activeElement`:
  // if the user's caret is currently in an input, defer the expand.
  useEffect(() => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const isUserTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    if (isUserTyping) return;
    if (shouldExpandPadding) setPaddingExpanded(true);
    if (shouldExpandMargin) setMarginExpanded(true);
  }, [shouldExpandPadding, shouldExpandMargin]);

  const updateClasses = useCallback((type: SpacingType, sides: Side[], value: string, unit: string, isAuto?: boolean) => {
    if (isMulti) {
      // Several selected: write ONLY the edited sides, raw, owning exactly them (design §2). Rebuilding
      // all four sides from the merged view would read Mixed sides as empty and wipe them.
      const num = value !== '' ? parseFloat(value) : null;
      const tokens = sides.flatMap(side => {
        if (isAuto && type === 'm') return [`m${side}-auto`];
        if (num === null || isNaN(num)) return [];
        const cls = createSpacingClass(type, side, num, unit);
        return cls ? [cls] : [];
      });
      onClassesChange(tokens.join(' '), ownsSides(type, sides));
      return;
    }
    let newClasses = classes;

    // Get current values for all sides to enable axis optimization
    const currentValues = type === 'p' ? padding : margin;

    // Build the new four-sides state
    const newSidesState: Record<Side, { value: number | null; unit: string; isAuto: boolean }> = {
      t: { value: currentValues.t.value !== '' ? parseFloat(currentValues.t.value) : null, unit: currentValues.t.unit, isAuto: currentValues.t.isAuto || false },
      r: { value: currentValues.r.value !== '' ? parseFloat(currentValues.r.value) : null, unit: currentValues.r.unit, isAuto: currentValues.r.isAuto || false },
      b: { value: currentValues.b.value !== '' ? parseFloat(currentValues.b.value) : null, unit: currentValues.b.unit, isAuto: currentValues.b.isAuto || false },
      l: { value: currentValues.l.value !== '' ? parseFloat(currentValues.l.value) : null, unit: currentValues.l.unit, isAuto: currentValues.l.isAuto || false },
    };

    // Apply the change to the affected sides
    const numValue = value !== '' ? parseFloat(value) : null;
    sides.forEach(side => {
      newSidesState[side] = {
        value: isAuto ? null : numValue,
        unit: unit,
        isAuto: isAuto || false
      };
    });

    // Remove ALL existing spacing classes for this type (individual, axis, and shorthand)
    const prefix = type === 'm' ? '-?m' : 'p';
    newClasses = setClass(newClasses, new RegExp(`^${prefix}t-`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}r-`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}b-`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}l-`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}x-`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}y-`), null);
    newClasses = setClass(newClasses, new RegExp(`^${prefix}-(?!t|r|b|l|x|y)`), null);
    if (type === 'm') {
      newClasses = setClass(newClasses, /^mt-auto$/, null);
      newClasses = setClass(newClasses, /^mr-auto$/, null);
      newClasses = setClass(newClasses, /^mb-auto$/, null);
      newClasses = setClass(newClasses, /^ml-auto$/, null);
      newClasses = setClass(newClasses, /^mx-auto$/, null);
      newClasses = setClass(newClasses, /^my-auto$/, null);
      newClasses = setClass(newClasses, /^m-auto$/, null);
    }

    // Check if any sides have auto values (margin only)
    const hasAnyAuto = type === 'm' && (
      newSidesState.t.isAuto || newSidesState.r.isAuto ||
      newSidesState.b.isAuto || newSidesState.l.isAuto
    );

    // Check if all sides have values (non-null, non-auto)
    const allSidesHaveValues = !hasAnyAuto &&
      newSidesState.t.value !== null &&
      newSidesState.r.value !== null &&
      newSidesState.b.value !== null &&
      newSidesState.l.value !== null;

    if (allSidesHaveValues) {
      // Use axis optimization when all sides have values
      const fourSides: FourSides = {
        top: { value: newSidesState.t.value!, unit: newSidesState.t.unit },
        right: { value: newSidesState.r.value!, unit: newSidesState.r.unit },
        bottom: { value: newSidesState.b.value!, unit: newSidesState.b.unit },
        left: { value: newSidesState.l.value!, unit: newSidesState.l.unit },
      };
      const optimizedClasses = optimizeSpacingClasses(type, fourSides);
      newClasses = newClasses + ' ' + optimizedClasses.join(' ');
    } else {
      // Partial axis optimization: check if x-axis or y-axis can be collapsed
      const lState = newSidesState.l;
      const rState = newSidesState.r;
      const tState = newSidesState.t;
      const bState = newSidesState.b;

      // Check x-axis: left and right both have equal numeric values (not auto, not null)
      const canCollapseX = !lState.isAuto && !rState.isAuto &&
        lState.value !== null && rState.value !== null &&
        lState.value === rState.value && lState.unit === rState.unit;

      // Check y-axis: top and bottom both have equal numeric values (not auto, not null)
      const canCollapseY = !tState.isAuto && !bState.isAuto &&
        tState.value !== null && bState.value !== null &&
        tState.value === bState.value && tState.unit === bState.unit;

      // Handle x-axis (left + right)
      if (canCollapseX) {
        const xClass = createSpacingClass(type, 'x', lState.value!, lState.unit);
        if (xClass) {
          newClasses = newClasses + ' ' + xClass;
        }
      } else {
        // Handle left and right individually
        if (lState.isAuto && type === 'm') {
          newClasses = newClasses + ' ml-auto';
        } else if (lState.value !== null && !isNaN(lState.value)) {
          const lClass = createSpacingClass(type, 'l', lState.value, lState.unit);
          if (lClass) newClasses = newClasses + ' ' + lClass;
        }
        if (rState.isAuto && type === 'm') {
          newClasses = newClasses + ' mr-auto';
        } else if (rState.value !== null && !isNaN(rState.value)) {
          const rClass = createSpacingClass(type, 'r', rState.value, rState.unit);
          if (rClass) newClasses = newClasses + ' ' + rClass;
        }
      }

      // Handle y-axis (top + bottom)
      if (canCollapseY) {
        const yClass = createSpacingClass(type, 'y', tState.value!, tState.unit);
        if (yClass) {
          newClasses = newClasses + ' ' + yClass;
        }
      } else {
        // Handle top and bottom individually
        if (tState.isAuto && type === 'm') {
          newClasses = newClasses + ' mt-auto';
        } else if (tState.value !== null && !isNaN(tState.value)) {
          const tClass = createSpacingClass(type, 't', tState.value, tState.unit);
          if (tClass) newClasses = newClasses + ' ' + tClass;
        }
        if (bState.isAuto && type === 'm') {
          newClasses = newClasses + ' mb-auto';
        } else if (bState.value !== null && !isNaN(bState.value)) {
          const bClass = createSpacingClass(type, 'b', bState.value, bState.unit);
          if (bClass) newClasses = newClasses + ' ' + bClass;
        }
      }
    }

    onClassesChange(newClasses.trim());
  }, [classes, padding, margin, onClassesChange, isMulti]);

  const handlePaddingChange = useCallback((sideOrAxis: Side | 'x' | 'y', value: string, unit: string, isAuto?: boolean) => {
    if (sideOrAxis === 'x') {
      // X = left and right
      updateClasses('p', ['l', 'r'], value, unit, isAuto);
    } else if (sideOrAxis === 'y') {
      // Y = top and bottom
      updateClasses('p', ['t', 'b'], value, unit, isAuto);
    } else {
      // Individual side
      updateClasses('p', [sideOrAxis], value, unit, isAuto);
    }
  }, [updateClasses]);

  const handleMarginChange = useCallback((sideOrAxis: Side | 'x' | 'y', value: string, unit: string, isAuto?: boolean) => {
    if (sideOrAxis === 'x') {
      // X = left and right
      updateClasses('m', ['l', 'r'], value, unit, isAuto);
    } else if (sideOrAxis === 'y') {
      // Y = top and bottom
      updateClasses('m', ['t', 'b'], value, unit, isAuto);
    } else {
      // Individual side
      updateClasses('m', [sideOrAxis], value, unit, isAuto);
    }
  }, [updateClasses]);

  return (
    <div>
      <SpacingControl
        label="Padding"
        type="p"
        values={padding}
        expanded={paddingExpanded}
        onToggleExpand={() => setPaddingExpanded(!paddingExpanded)}
        onValueChange={handlePaddingChange}
        mixed={mixedPadding}
      />
      <SpacingControl
        label="Margin"
        type="m"
        values={margin}
        expanded={marginExpanded}
        onToggleExpand={() => setMarginExpanded(!marginExpanded)}
        onValueChange={handleMarginChange}
        mixed={mixedMargin}
      />
    </div>
  );
};

export default SpacingBlock;
