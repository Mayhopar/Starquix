/**
 * IconButton - compact square icon button matching Field/InputContainer sizing
 * (sm 20px, md 24px). For 24–40px round icon buttons use <Button iconOnly>.
 */
import React, { forwardRef } from 'react';
import { cx } from './cx';

export type IconButtonSize = 'sm' | 'md';

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: React.ReactNode;
  active?: boolean;
  size?: IconButtonSize;
}

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'w-5 h-5',
  md: 'w-6 h-6',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ children, active = false, size = 'md', className = '', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cx(
          'flex items-center justify-center rounded-sm transition-colors shrink-0',
          sizeStyles[size],
          active
            ? 'bg-btn-primary-fill-default text-btn-primary-text-default'
            : 'bg-input-fill text-text-secondary hover:text-text hover:bg-bg-hover', // sits in fields: the field's own fill
          disabled && 'opacity-50 pointer-events-none',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

IconButton.displayName = 'IconButton';

export default IconButton;
