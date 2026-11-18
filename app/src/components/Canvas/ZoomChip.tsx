import { ChevronDownIcon as SharedChevronDownIcon } from '@/assets/icons';
import { useCallback, useRef, useState } from 'react';
import { Button, Menu, MenuItem } from '@/components/ui';
import { dispatchZoomCommand, type ZoomCommandAction } from './zoomCommands';
import { useExclusiveMenu } from './hoverMenu';
import { isMac } from '@/utils/platform';

interface ZoomChipProps {
  /** Flushed canvas scale (lags ~150ms during gestures — Canvas also writes
   *  the label text directly via labelRef inside its transform rAF). */
  scale: number;
  labelRef?: React.Ref<HTMLSpanElement>;
}

const HOVER_CLOSE_DELAY_MS = 150;

/**
 * Zoom percentage readout + dropdown menu next to the breakpoint/theme
 * buttons. Opens on hover like them. Menu items dispatch 'sq:zoom-command' —
 * the same single command path the keyboard shortcuts use; Canvas.tsx is the
 * one listener.
 */
export function ZoomChip({ scale, labelRef }: ZoomChipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  useExclusiveMenu(open, setOpen); // only one top-bar menu at a time (claiming closes the other one)

  const mac = isMac();
  const items: Array<{ action: ZoomCommandAction; label: string; hint: string }> = [
    { action: 'in', label: 'Zoom in', hint: mac ? '⌘+' : 'Ctrl +' },
    { action: 'out', label: 'Zoom out', hint: mac ? '⌘−' : 'Ctrl −' },
    { action: 'reset', label: 'Zoom to 100%', hint: mac ? '⌘0' : 'Ctrl 0' },
    { action: 'fit', label: 'Zoom to fit', hint: '⇧1' },
  ];

  return (
    <div onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-label="Zoom options"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="px-2 gap-1 font-normal tabular-nums"
        icon={<span ref={labelRef}>{Math.round(scale * 100)}%</span>}
        iconRight={
          <SharedChevronDownIcon className="w-4 h-4" />
        }
      />
      <Menu isOpen={open} onClose={() => setOpen(false)} triggerRef={triggerRef} placement="bottom-end" width="auto">
        <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onClick={() => setOpen(false)}>
          {items.map((item) => (
            <MenuItem
              key={item.action}
              label={item.label}
              shortcut={item.hint}
              onSelect={() => dispatchZoomCommand(item.action)}
            />
          ))}
        </div>
      </Menu>
    </div>
  );
}
