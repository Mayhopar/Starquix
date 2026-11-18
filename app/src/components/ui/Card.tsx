/**
 * Card - dashboard card surface (ProjectCard / CreateProjectCard shell).
 */
import React, { forwardRef } from 'react';
import { cx } from './cx';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  /** Interactive hover/cursor affordance */
  interactive?: boolean;
  selected?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ children, interactive = false, selected = false, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={cx(
        'bg-bg-contrast border border-stroke rounded-outer overflow-hidden',
        interactive && 'cursor-pointer transition-colors hover:border-stroke-darker',
        selected && 'border-stroke-active',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);

Card.displayName = 'Card';

export default Card;
