/**
 * Tooltip - portal to body (never clipped by overflow ancestors), positioned
 * above the trigger, clamped into the viewport. 400ms show delay.
 */
import { useState, useRef, useLayoutEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  content: string;
  children: ReactNode;
}

export function Tooltip({ content, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  const show = () => {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setVisible(true), 400);
  };
  const hide = () => {
    clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !tipRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    const top = Math.max(8, t.top - tip.height - 6);
    const left = Math.min(
      Math.max(8, t.left + t.width / 2 - tip.width / 2),
      window.innerWidth - tip.width - 8,
    );
    setPos({ top, left });
  }, [visible, content]);

  return (
    <span ref={triggerRef} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && createPortal(
        <span
          ref={tipRef}
          className="fixed px-2 py-1 text-xs rounded-inner bg-bg-contrast text-text border border-stroke whitespace-pre-line w-max z-flyout pointer-events-none shadow-flyout"
          style={{ top: pos.top, left: pos.left }}
        >
          {content}
        </span>,
        document.body,
      )}
    </span>
  );
}

export default Tooltip;
