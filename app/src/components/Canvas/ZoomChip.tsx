import { ChevronDownIcon as SharedChevronDownIcon } from '@/assets/icons';
import { useRef } from 'react';
import { Button, Menu, MenuItem } from '@/components/ui';
import { dispatchZoomCommand, type ZoomCommandAction } from './zoomCommands';
import { useHoverMenu } from './hoverMenu';
import { isMac } from '@/utils/platform';

interface ZoomChipProps {
  /** Flushed canvas scale (lags ~150ms during gestures — Canvas also writes
   *  the label text directly via labelRef inside its transform rAF). */
  scale: number;
  labelRef?: React.Ref<HTMLSpanElement>;
}

/**
 * Zoom percentage readout + dropdown menu next to the breakpoint/theme
 * buttons. Opens on hover like them. Menu items dispatch 'sq:zoom-command' —
 * the same single command path the keyboard shortcuts use; Canvas.tsx is the
 * one listener.
 */
export function ZoomChip({ scale, labelRef }: ZoomChipProps) {
  const { open, show, close, scheduleClose, cancelClose } = useHoverMenu();
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const mac = isMac();
  const items: Array<{ action: ZoomCommandAction; label: string; hint: string }> = [
    { action: 'in', label: 'Zoom in', hint: mac ? '⌘+' : 'Ctrl +' },
    { action: 'out', label: 'Zoom out', hint: mac ? '⌘−' : 'Ctrl −' },
    { action: 'reset', label: 'Zoom to 100%', hint: mac ? '⌘0' : 'Ctrl 0' },
    { action: 'fit', label: 'Zoom to fit', hint: '⇧1' },
  ];

  return (
    <div onMouseEnter={show} onMouseLeave={scheduleClose}>
      <Button
        ref={triggerRef}
        variant="secondary"
        size="sm"
        aria-label="Zoom options"
        aria-expanded={open}
        onClick={show}
        className="px-2 gap-1 font-normal tabular-nums"
        icon={<span ref={labelRef}>{Math.round(scale * 100)}%</span>}
        iconRight={
          <SharedChevronDownIcon className="w-4 h-4" />
        }
      />
      <Menu isOpen={open} onClose={close} triggerRef={triggerRef} placement="bottom-end" width="auto">
        <div onMouseEnter={cancelClose} onMouseLeave={scheduleClose} onClick={close}>
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
