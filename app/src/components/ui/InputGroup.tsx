/**
 * InputGroup - layout container for related Fields (dual X/Y, quad T/R/B/L, row).
 */
import React from 'react';
import { cx } from './cx';

export type InputGroupLayout = 'dual' | 'quad' | 'row';
export type InputGroupGap = 1 | 2 | 4;

export interface InputGroupProps {
  layout: InputGroupLayout;
  gap?: InputGroupGap;
  children: React.ReactNode;
  className?: string;
}

const gapStyles: Record<InputGroupGap, string> = { 1: 'gap-1', 2: 'gap-2', 4: 'gap-4' };

const layoutStyles: Record<InputGroupLayout, string> = {
  dual: 'grid grid-cols-2',
  quad: 'grid grid-cols-2',
  row: 'flex',
};

export const InputGroup: React.FC<InputGroupProps> = ({ layout, gap = 1, children, className = '' }) => (
  <div className={cx(layoutStyles[layout], gapStyles[gap], className)}>{children}</div>
);

export default InputGroup;
