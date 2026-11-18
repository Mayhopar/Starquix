// app/src/components/VariablesEditor/VariableColorCell.tsx

import { memo, useState, useCallback, useRef } from 'react';
import { CustomColorPicker } from '@/components/DesignBar/CustomColorPicker';
import { TailwindPaletteGrid } from '@/components/DesignBar/TailwindPaletteGrid';
import { Popover, Swatch } from '@/components/ui';
import type { VariableValue } from '@/core/variables/types';
import { arrowKeyDelta } from './constants';

interface VariableColorCellProps {
  value: VariableValue & { type: 'color' };
  onChange: (value: VariableValue) => void;
}

function clampOpacity(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export const VariableColorCell = memo(function VariableColorCell({ value, onChange }: VariableColorCellProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<'palette' | 'custom'>('palette');
  const swatchRef = useRef<HTMLSpanElement>(null);

  const handleHexChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`;
    if (/^#[0-9a-fA-F]{0,6}$/.test(hex)) {
      onChange({ type: 'color', hex, opacity: value.opacity });
    }
  }, [value.opacity, onChange]);

  const handleHexBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    let hex = e.target.value;
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) hex = value.hex;
    onChange({ type: 'color', hex, opacity: value.opacity });
  }, [value, onChange]);

  const handleOpacityChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '' || raw === '-') return;
    onChange({ type: 'color', hex: value.hex, opacity: clampOpacity(parseInt(raw) || 0) });
  }, [value.hex, onChange]);

  const handleOpacityKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    const delta = arrowKeyDelta(e);
    if (delta === 0) return;
    e.preventDefault();
    onChange({ type: 'color', hex: value.hex, opacity: clampOpacity(value.opacity + delta) });
  }, [value, onChange]);

  const handlePickerChange = useCallback((hex: string) => {
    onChange({ type: 'color', hex, opacity: value.opacity });
  }, [value.opacity, onChange]);

  return (
    <div className="flex items-center h-full gap-1.5">
      <span ref={swatchRef} className="flex shrink-0">
        <Swatch
          size="lg"
          color={value.hex}
          title="Pick color"
          onClick={() => setIsPickerOpen(!isPickerOpen)}
          className="rounded cursor-pointer"
        />
      </span>

      <Popover
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        triggerRef={swatchRef}
        placement="bottom-start"
        width={280}
        maxHeight={360}
      >
        {/* padding lives INSIDE the scroll area — on the popover frame it gets
            clipped by overflow-hidden and cuts the last row */}
        <div className="p-2">
        {pickerTab === 'palette' ? (
          <TailwindPaletteGrid
            hexOnly
            isSelected={color => color.hex.toLowerCase() === value.hex.toLowerCase()}
            onSelect={color => {
              onChange({ type: 'color', hex: color.hex, opacity: value.opacity });
              setIsPickerOpen(false);
            }}
            onCustomClick={() => setPickerTab('custom')}
          />
        ) : (
          <CustomColorPicker
            value={value.hex}
            onChange={handlePickerChange}
            onClose={() => {
              setIsPickerOpen(false);
              setPickerTab('palette');
            }}
          />
        )}
        </div>
      </Popover>

      <input
        type="text"
        value={value.hex}
        onChange={handleHexChange}
        onBlur={handleHexBlur}
        className="flex-1 min-w-0 h-full px-1 text-xs bg-transparent text-text font-mono outline-none"
      />

      <div className="flex items-center shrink-0">
        <input
          type="text"
          inputMode="numeric"
          value={value.opacity}
          onChange={handleOpacityChange}
          onKeyDown={handleOpacityKeyDown}
          className="w-8 h-full text-xs bg-transparent text-text text-right outline-none"
        />
        <span className="text-xs text-text-muted">%</span>
      </div>
    </div>
  );
});
