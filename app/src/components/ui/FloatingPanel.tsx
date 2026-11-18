/**
 * FloatingPanel - free-floating chrome surface (Footer flyouts, TelemetryPanel,
 * zoom chip menu). One border/shadow/z recipe; caller positions it via
 * className (`absolute bottom-12 left-2 …`) or style.
 */
import React, { forwardRef } from 'react';
import { cx } from './cx';

export interface FloatingPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const FloatingPanel = forwardRef<HTMLDivElement, FloatingPanelProps>(
  ({ children, className = '', ...props }, ref) => (
    <div
      ref={ref}
      className={cx('bg-bg border border-stroke rounded-outer shadow-flyout z-flyout', className)}
      {...props}
    >
      {children}
    </div>
  ),
);

FloatingPanel.displayName = 'FloatingPanel';

export default FloatingPanel;
