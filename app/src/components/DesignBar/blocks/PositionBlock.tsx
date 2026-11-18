/**
 * Position Block - Tailwind version
 *
 * Controls for CSS position and inset values (top/right/bottom/left).
 * Note: z-index is in AppearanceBlock.
 */

import React, { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { GestureHostContext } from '@/components/ui/valueGesture';
import { findClass, setClass } from '../utils';
import { resolveToClass } from '@/core/classes/vocabulary';
import { SegmentedControl } from '@/components/ui';
import { Field, Row } from '@/components/ui';
import { InsetTopIcon, InsetBottomIcon, InsetLeftIcon, InsetRightIcon } from '@/assets/icons';
import { useMixedValue, ownsGroups, type Owns } from '../multi/mixed';

// ============================================================================
// Constants
// ============================================================================

/** One undo step per typed value: a keystroke burst quieter than this commits
 *  once. Long enough to bridge normal typing, short enough to feel live. */
const INSET_COMMIT_DEBOUNCE_MS = 500;

const POSITION_OPTIONS = [
  { label: 'Static', value: 'static' },
  {
    label: 'Other',
    value: 'other',
    dropdown: [
      { label: 'Relative', value: 'relative' },
      { label: 'Absolute', value: 'absolute' },
      { label: 'Fixed', value: 'fixed' },
      { label: 'Sticky', value: 'sticky' }
    ]
  }
];

// ============================================================================
// Helpers
// ============================================================================

const parsePosition = (classes: string): string => {
  const token = findClass(classes, /^(static|relative|absolute|fixed|sticky)$/);
  return token || 'static';
};

const parseInset = (classes: string, side: 'top' | 'right' | 'bottom' | 'left' | 'inset'): string => {
  // Check for full inset first
  if (side === 'inset') {
    const insetToken = findClass(classes, /^inset-(.+)$/);
    if (insetToken) {
      const match = insetToken.match(/^inset-(.+)$/);
      return match ? match[1] : '';
    }
    return '';
  }

  // Check for specific side
  const pattern = new RegExp(`^${side}-(.+)$`);
  const token = findClass(classes, pattern);

  if (!token) return '';

  const match = token.match(pattern);
  if (!match) return '';

  const value = match[1];

  // Handle arbitrary values
  const arbitrary = value.match(/^\[(-?\d+)px\]$/);
  if (arbitrary) {
    return arbitrary[1];
  }

  // Handle numeric scale values (top-4 = 16px)
  const num = parseFloat(value);
  if (!isNaN(num)) {
    return `${num * 4}`;
  }

  // Handle special values
  if (value === 'full') return '100%';
  if (value === 'auto') return 'auto';
  if (value === '0') return '0';
  if (value === 'px') return '1';

  // Handle fractions
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) {
    return `${Math.round((parseInt(fraction[1]) / parseInt(fraction[2])) * 100)}%`;
  }

  return '';
};

type Side = 'top' | 'right' | 'bottom' | 'left';

// ============================================================================
// Several selected — each control's own reader ("Mixed", design C6) and what
// each write owns (only those tokens change on every member, design §2)
// ============================================================================

const INSET_READERS: Record<Side, (classes: string) => string> = {
  top: c => parseInset(c, 'top'), right: c => parseInset(c, 'right'),
  bottom: c => parseInset(c, 'bottom'), left: c => parseInset(c, 'left'),
};
const OWNS = {
  position: ownsGroups('standalone:position'),
  /** Negative insets are `unique:` groups in Tailwind's table — a regex owns both signs. */
  inset: (side: Side): Owns => {
    const re = new RegExp(`^-?${side}-`);
    return token => re.test(token);
  },
};

// ============================================================================
// Component
// ============================================================================

interface PositionBlockProps {
  classes: string;
  /** `owns` = the tokens this write owns (multi-select: only they change on each member). */
  onClassesChange: (classes: string, owns?: Owns) => void;
}

export const PositionBlock: React.FC<PositionBlockProps> = ({
  classes,
  onClassesChange
}) => {
  const [position, setPosition] = useState<string>('static');
  const [top, setTop] = useState<string>('');
  const [right, setRight] = useState<string>('');
  const [bottom, setBottom] = useState<string>('');
  const [left, setLeft] = useState<string>('');
  // Several selected: each control compares its OWN reader across members (design C6). A Mixed inset
  // being typed shows the typed value until its debounced commit lands (else each keystroke restarts
  // from the empty "Mixed" field).
  const mixed = {
    position: useMixedValue(parsePosition),
    top: useMixedValue(INSET_READERS.top),
    right: useMixedValue(INSET_READERS.right),
    bottom: useMixedValue(INSET_READERS.bottom),
    left: useMixedValue(INSET_READERS.left),
  };
  const [typing, setTyping] = useState<Side | null>(null);
  const insetMixed = (side: Side) => mixed[side] && typing !== side;

  // Sync from classes
  useEffect(() => {
    setTyping(null);
    setPosition(parsePosition(classes));
    setTop(parseInset(classes, 'top'));
    setRight(parseInset(classes, 'right'));
    setBottom(parseInset(classes, 'bottom'));
    setLeft(parseInset(classes, 'left'));
  }, [classes]);

  const handlePositionChange = useCallback((newPosition: string) => {
    setPosition(newPosition);

    let newClasses = setClass(classes, /^(static|relative|absolute|fixed|sticky)$/, null);

    if (newPosition !== 'static') {
      newClasses = newClasses + ` ${newPosition}`;
    }

    onClassesChange(newClasses.trim(), OWNS.position);
  }, [classes, onClassesChange]);

  // C7 (2026-08-26): committing per keystroke made typing "200" three undo
  // steps in BOTH runtimes (each intermediate value snapshotted / on disk).
  // A typing burst coalesces into ONE commit per side; the latest `classes` /
  // `onClassesChange` are read through refs at fire time so the debounced
  // commit never composes against a stale prop.
  const classesRef = useRef(classes);
  classesRef.current = classes;
  const onClassesChangeRef = useRef(onClassesChange);
  onClassesChangeRef.current = onClassesChange;
  const pendingInset = useRef<{
    side: 'top' | 'right' | 'bottom' | 'left';
    value: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const commitInset = useCallback((side: Side, value: string) => {
    // Remove old inset class for this side
    const pattern = new RegExp(`^${side}-(.+)$`);
    let newClasses = setClass(classesRef.current, pattern, null);

    // Add new class if value is set
    if (value !== '' && value !== 'auto') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        const insetClass = resolveToClass(side, numValue, 'px');
        newClasses = newClasses + ' ' + insetClass;
      }
    }

    onClassesChangeRef.current(newClasses.trim(), OWNS.inset(side));
  }, []);

  const flushPendingInset = useCallback(() => {
    const p = pendingInset.current;
    if (!p) return;
    pendingInset.current = null;
    clearTimeout(p.timer);
    commitInset(p.side, p.value);
  }, [commitInset]);

  // Deselecting (or closing the panel) right after typing must not lose the
  // edit — flush whatever is still pending on unmount.
  useEffect(() => flushPendingInset, [flushPendingInset]);

  // Under a value gesture host (every DesignBar) the number field itself coalesces: typed text settles into ONE commit, a stepper
  // burst into one, and the class sink routes each call by scope. A second 500 ms coalescer on top would delay the commit
  // by half a second. Without a host (a bare block) the legacy coalescer below stays.
  const gestureHost = useContext(GestureHostContext);

  const handleInsetChange = useCallback((side: Side, value: string) => {
    // Update local state (instant echo — only the COMMIT is coalesced)
    setTyping(side);
    switch (side) {
      case 'top': setTop(value); break;
      case 'right': setRight(value); break;
      case 'bottom': setBottom(value); break;
      case 'left': setLeft(value); break;
    }
    if (gestureHost) { commitInset(side, value); return; }

    const p = pendingInset.current;
    if (p && p.side !== side) {
      flushPendingInset(); // a different side's burst ends now, in order
    } else if (p) {
      clearTimeout(p.timer);
    }
    pendingInset.current = {
      side,
      value,
      timer: setTimeout(() => {
        pendingInset.current = null;
        commitInset(side, value);
      }, INSET_COMMIT_DEBOUNCE_MS),
    };
  }, [commitInset, flushPendingInset, gestureHost]);

  const isPositioned = position !== 'static';

  return (
    <div className="space-y-1 pr-8 pb-2">
      {/* Position Type - Segmented Control */}
      <SegmentedControl
        options={POSITION_OPTIONS}
        value={position}
        mixed={mixed.position}
        onChange={handlePositionChange}
      />

      {/* Inset Values (only show when positioned) */}
      {isPositioned && (
        <div>
          <Row title="Inset" size="sm" />
          <div className="grid grid-cols-2 gap-1 pb-2">
            {/* Left column: Top and Bottom (vertical insets) */}
            <Field
              aria-label="Top inset"
              mixed={insetMixed('top')}
              icon={<InsetTopIcon className="w-4 h-4" />}
              value={top}
              onChange={(v) => handleInsetChange('top', v)}
              type="number"
              placeholder="-"
            />
            <Field
              aria-label="Left inset"
              mixed={insetMixed('left')}
              icon={<InsetLeftIcon className="w-4 h-4" />}
              value={left}
              onChange={(v) => handleInsetChange('left', v)}
              type="number"
              placeholder="-"
            />
            <Field
              aria-label="Bottom inset"
              mixed={insetMixed('bottom')}
              icon={<InsetBottomIcon className="w-4 h-4" />}
              value={bottom}
              onChange={(v) => handleInsetChange('bottom', v)}
              type="number"
              placeholder="-"
            />
            <Field
              aria-label="Right inset"
              mixed={insetMixed('right')}
              icon={<InsetRightIcon className="w-4 h-4" />}
              value={right}
              onChange={(v) => handleInsetChange('right', v)}
              type="number"
              placeholder="-"
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default PositionBlock;
