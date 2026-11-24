/**
 * Popover - THE positioning engine. Portal to body, viewport-aware flipping
 * and clamping, click-outside + Escape to close. Flyout tokens (shadow-flyout,
 * z-flyout, rounded-inner).
 *
 * Two modes:
 * - Controlled: pass `isOpen`, `onClose`, `triggerRef` (ported DesignBar/shared API).
 * - Uncontrolled: pass `trigger` (node) and Popover manages its own open state
 *   (ported common/Popover API).
 */
import React, { useState, useRef, useEffect, useCallback, useMemo, createContext, useContext } from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';

export type PopoverPlacement = 'bottom' | 'bottom-start' | 'bottom-end' | 'top' | 'top-start' | 'top-end';

interface Position {
  top: number;
  left: number;
  actualPlacement: PopoverPlacement;
}

interface PopoverCommonProps {
  children: React.ReactNode;
  placement?: PopoverPlacement;
  /** Offset from trigger (px) */
  offset?: number;
  width?: number | 'trigger' | 'auto';
  maxHeight?: number;
  className?: string;
  /** Escape hatch for stacking above modals; default var(--z-flyout) */
  zIndex?: number;
}

interface ControlledPopoverProps extends PopoverCommonProps {
  isOpen: boolean;
  onClose: () => void;
  triggerRef: React.RefObject<HTMLElement | null>;
  trigger?: never;
}

interface UncontrolledPopoverProps extends PopoverCommonProps {
  trigger: React.ReactNode;
  isOpen?: never;
  onClose?: never;
  triggerRef?: never;
}

export type PopoverProps = ControlledPopoverProps | UncontrolledPopoverProps;

/** px of fixed chrome at the bottom of the window (0 when none registered). */
export function chromeBottom(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sq-chrome-bottom')) || 0;
}

function calculatePosition(
  triggerRect: DOMRect,
  popoverWidth: number,
  popoverHeight: number,
  placement: PopoverPlacement,
  offset: number,
): Position {
  const viewportWidth = window.innerWidth;
  // Fixed app chrome at the bottom (the editor footer) publishes its height as
  // --sq-chrome-bottom; a flyout flips/clamps above it instead of under it.
  const viewportHeight = window.innerHeight - chromeBottom();
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  let left: number;
  const alignEnd = placement.endsWith('-end');
  const alignStart = placement.endsWith('-start') || placement === 'bottom' || placement === 'top';

  if (alignEnd) {
    left = triggerRect.right - popoverWidth + scrollX;
  } else if (alignStart && !placement.includes('-')) {
    left = triggerRect.left + (triggerRect.width - popoverWidth) / 2 + scrollX;
  } else {
    left = triggerRect.left + scrollX;
  }

  const isBottomPlacement = placement.startsWith('bottom');
  let actualPlacement = placement;
  let top: number;

  if (isBottomPlacement) {
    top = triggerRect.bottom + offset + scrollY;
    if (top + popoverHeight > viewportHeight + scrollY) {
      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      if (spaceAbove > spaceBelow) {
        top = triggerRect.top - popoverHeight - offset + scrollY;
        actualPlacement = placement.replace('bottom', 'top') as PopoverPlacement;
      }
    }
  } else {
    top = triggerRect.top - popoverHeight - offset + scrollY;
    if (top < scrollY) {
      const spaceBelow = viewportHeight - triggerRect.bottom;
      const spaceAbove = triggerRect.top;
      if (spaceBelow > spaceAbove) {
        top = triggerRect.bottom + offset + scrollY;
        actualPlacement = placement.replace('top', 'bottom') as PopoverPlacement;
      }
    }
  }

  const minLeft = scrollX + 8;
  const maxLeft = viewportWidth + scrollX - popoverWidth - 8;
  left = Math.max(minLeft, Math.min(left, maxLeft));

  const minTop = scrollY + 8;
  const maxTop = viewportHeight + scrollY - popoverHeight - 8;
  top = Math.max(minTop, Math.min(top, maxTop));

  return { top, left, actualPlacement };
}

/**
 * Nested popovers: each one renders into its own portal, so a parent's
 * native click-outside check sees a child's panel as "outside" and closed the
 * parent (unmounting the child) on mousedown — the child's click never landed
 * (a Stack color swatch picked nothing, 2026-09-29). An open panel registers
 * with every ancestor popover; a mousedown inside any descendant panel is
 * inside.
 */
export type RegisterPanel = (el: HTMLElement) => () => void;
/** Exported for Modal: a Popover opened inside a Modal registers with it the same way (its clicks are inside the modal). */
export const PopoverNesting = createContext<RegisterPanel | null>(null);
/** The stacking a host needs its popovers on (Modal: above `z-modal`); a Popover's own `zIndex` wins. */
export const PopoverLayer = createContext<number | string | undefined>(undefined);

function PopoverPanel({
  isOpen,
  onClose,
  triggerRef,
  children,
  placement = 'bottom-start',
  offset = 4,
  width = 'auto',
  maxHeight = 400,
  className = '',
  zIndex,
}: ControlledPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const registerWithParent = useContext(PopoverNesting);
  const layer = useContext(PopoverLayer);
  const descendants = useRef(new Set<HTMLElement>());
  const register = useCallback<RegisterPanel>((el) => {
    descendants.current.add(el);
    const unregisterUp = registerWithParent?.(el);
    return () => { descendants.current.delete(el); unregisterUp?.(); };
  }, [registerWithParent]);
  useEffect(() => {
    const el = popoverRef.current;
    if (!isOpen || !el || !registerWithParent) return;
    return registerWithParent(el);
  }, [isOpen, registerWithParent]);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0, actualPlacement: placement });
  const [measuredWidth, setMeasuredWidth] = useState<number>(0);

  const updatePosition = useCallback(() => {
    if (!isOpen || !triggerRef.current || !popoverRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const popoverRect = popoverRef.current.getBoundingClientRect();

    let popoverWidth: number;
    if (width === 'trigger') {
      popoverWidth = triggerRect.width;
      setMeasuredWidth(triggerRect.width);
    } else if (width === 'auto') {
      popoverWidth = popoverRect.width;
    } else {
      popoverWidth = width;
      setMeasuredWidth(width);
    }

    setPosition(calculatePosition(triggerRect, popoverWidth, popoverRect.height, placement, offset));
  }, [isOpen, triggerRef, placement, offset, width]);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(updatePosition, 0);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, updatePosition]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        ![...descendants.current].some((el) => el.contains(target)) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        onClose();
      }
    };
    // A click into an iframe (the canvas) never reaches this document's mousedown: it moves focus into the frame.
    const handleBlur = () => setTimeout(() => { if (document.activeElement?.tagName === 'IFRAME') onClose(); });
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('blur', handleBlur);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('blur', handleBlur);
    };
  }, [isOpen, onClose, triggerRef]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
      // Local fields run first; a popup close must not also drill up the canvas.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  const widthStyle = useMemo((): React.CSSProperties => {
    if (width === 'trigger' && measuredWidth > 0) return { width: measuredWidth };
    if (typeof width === 'number') return { width };
    return { width: 'fit-content' };
  }, [width, measuredWidth]);

  if (!isOpen) return null;
  const cappedMax = `min(${maxHeight}px, calc(100vh - var(--sq-chrome-bottom, 0px) - 16px))`;

  return createPortal(
    <div
      ref={popoverRef}
      className={cx('fixed bg-bg border border-stroke rounded-outer shadow-flyout overflow-hidden z-flyout', className)}
      style={{
        top: position.top,
        left: position.left,
        ...((zIndex ?? layer) !== undefined ? { zIndex: zIndex ?? layer } : {}),
        maxHeight: cappedMax,
        ...widthStyle,
      }}
    >
      <div className="overflow-y-auto overflow-x-hidden" style={{ maxHeight: cappedMax }}>
        <PopoverNesting.Provider value={register}>{children}</PopoverNesting.Provider>
      </div>
    </div>,
    document.body,
  );
}

export function Popover(props: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const uncontrolledTriggerRef = useRef<HTMLDivElement>(null);

  if (props.trigger === undefined) {
    return <PopoverPanel {...(props as ControlledPopoverProps)} />;
  }

  const { trigger, ...rest } = props;
  return (
    <>
      <div
        ref={uncontrolledTriggerRef}
        onClick={() => setUncontrolledOpen((v) => !v)}
        className="inline-block"
      >
        {trigger}
      </div>
      <PopoverPanel
        {...(rest as PopoverCommonProps)}
        isOpen={uncontrolledOpen}
        onClose={() => setUncontrolledOpen(false)}
        triggerRef={uncontrolledTriggerRef}
      />
    </>
  );
}

export default Popover;
