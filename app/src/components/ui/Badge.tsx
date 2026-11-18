/**
 * Badge - small status pill. Micro type sizes only (text-2xs / text-3xs).
 */
import React from 'react';
import { cx } from './cx';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
  title?: string;
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-bg-contrast text-text-muted border border-stroke',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  accent: 'bg-btn-primary-fill-default text-btn-primary-text-default',
};

export function Badge({ children, variant = 'default', size = 'md', className = '', title }: BadgeProps) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap shrink-0',
        size === 'md' ? 'text-2xs px-1.5 py-px' : 'text-3xs px-1 py-px',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
