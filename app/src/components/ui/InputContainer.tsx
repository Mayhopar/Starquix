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
