/**
 * Swatch - color preview chip with alpha checkerboard underlay.
 *
 * `color` accepts any CSS color (inline style is the legitimate carrier for
 * user-document colors — the lint exempts values that come from data).
 */
import React from 'react';
import { cx } from './cx';

export interface SwatchProps {
  color: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
}

const sizes = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-5 h-5' };

// Checkerboard so translucent colors read correctly.
const checker: React.CSSProperties = {
  backgroundImage:
    'conic-gradient(var(--color-stroke) 0 25%, transparent 0 50%, var(--color-stroke) 0 75%, transparent 0)',
  backgroundSize: '8px 8px',
};

export function Swatch({ color, size = 'md', className = '', title, onClick }: SwatchProps) {
  return (
    <span
      title={title}
      onClick={onClick}
      className={cx('relative inline-block rounded-sm border border-stroke overflow-hidden shrink-0', sizes[size], className)}
      style={checker}
    >
      <span className="absolute inset-0" style={{ backgroundColor: color }} />
    </span>
  );
}
