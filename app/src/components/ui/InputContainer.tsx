/**
 * InputContainer - internal layout shell for Field (leading/trailing 16×16
 * slots around an input/select). Not part of the public kit API — compose
 * Field instead; exported only for the migration shims.
 */
import React from 'react';
import { cx } from './cx';

export type InputSize = 'sm' | 'md' | 'lg';

export interface InputContainerProps {
  children: React.ReactNode;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  size?: InputSize;
  className?: string;
  disabled?: boolean;
  /** If false, trailing slot ignores clicks (decorative icons like chevrons) */
  trailingInteractive?: boolean;
  /** Error state: error-colored border */
  error?: boolean;
}

const sizeStyles: Record<InputSize, { box: string; text: string; slot: string }> = {
  sm: { box: 'h-6', text: 'text-xs', slot: 'w-4 h-4' },
  md: { box: 'h-7', text: 'text-xs', slot: 'w-4 h-4' },
  // A window field (the Figma Input): outlined on the surface in Light (filled half a step lighter in Dark — owner),
  // 24px slots that hold icon buttons.
  lg: { box: 'h-8 bg-input-fill-window', text: 'text-sm', slot: 'min-w-6 h-6 gap-1' },
};

// The box's control is its first input / select / textarea (a Field's slots come after it or hold none); anything else
// interactive in the box (a slot's button, a unit select) is a deliberate sub-target that keeps its own clicks.
const CONTROL = 'input, select, textarea';
const SUB_TARGET = 'input, select, textarea, button, a[href], label, [role="button"], [role="switch"], [role="combobox"], [tabindex], [contenteditable="true"]';

/** The control, when the event landed on the box's ring, padding, slot text/icon, prefix, unit or chevron. A portal
 *  rendered inside the box (a pill's popover) bubbles here through React but is not in the box; an inner box that took
 *  the press already prevented its default. */
function deadZoneControl(e: React.MouseEvent<HTMLElement>): HTMLElement | null {
  const box = e.currentTarget;
  const target = e.target as Element;
  if (e.button !== 0 || e.defaultPrevented || !box.contains(target)) return null;
  const hit = target.closest(SUB_TARGET);
  return hit && box.contains(hit) ? null : box.querySelector<HTMLElement>(CONTROL);
}

/** A press anywhere in the box acts on the control: focus it (caret at the near end) or open the select. */
function pressBox(e: React.MouseEvent<HTMLElement>) {
  const control = deadZoneControl(e);
  if (!control) return;
  e.preventDefault(); // else the press blurs the control for the shell
  control.focus();
  if (control instanceof HTMLSelectElement) {
    try { control.showPicker(); } catch { /* not supported / no user activation: focused is the fallback */ }
  } else if ((control as HTMLInputElement).selectionStart != null) {
    const input = control as HTMLInputElement; // also a textarea; number/date inputs have no selection (null)
    if (input.selectionStart === input.selectionEnd) {
      const end = e.clientX < input.getBoundingClientRect().left ? 0 : input.value.length;
      input.setSelectionRange(end, end);
    }
  }
}

/** A click in the box reaches the control (a read-only field opens its menu): re-dispatched there and the box's own
 *  click dropped, default included (in a link it would navigate past the handlers that cancel it), so it acts once. */
function clickBox(e: React.MouseEvent<HTMLElement>) {
  const control = deadZoneControl(e);
  if (!control) return;
  e.preventDefault();
  e.stopPropagation();
  control.click();
}

/** The same whole-box hit target for a field-looking box that cannot be a Field (a table cell, the chat composer):
 *  `<td {...fieldBox}>`. */
export const fieldBox = { onMouseDown: pressBox, onClick: clickBox };

export const InputContainer: React.FC<InputContainerProps> = ({
  children,
  leading,
  trailing,
  size = 'md',
  className = '',
  disabled = false,
  trailingInteractive = true,
  error = false,
}) => {
  const styles = sizeStyles[size];

  return (
    <div
      onMouseDown={pressBox}
      onClick={clickBox}
      className={cx(
        'flex items-center rounded-inner bg-input-fill border border-input-stroke min-w-0 overflow-hidden',
        styles.box,
        error && 'border-error',
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {leading != null && (
        <span className={cx(styles.text, styles.slot, 'ml-1 flex items-center justify-center shrink-0 text-text-secondary')}>
          {leading}
        </span>
      )}
      {children}
      {trailing != null && (
        <span
          className={cx(
            styles.text,
            styles.slot,
            'mr-1 flex items-center justify-center shrink-0 text-text-secondary',
            !trailingInteractive && 'pointer-events-none',
          )}
        >
          {trailing}
        </span>
      )}
    </div>
  );
};

export default InputContainer;
