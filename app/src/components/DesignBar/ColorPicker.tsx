/**
 * Color Picker Component - Tailwind version
 *
 * A dropdown color picker with Tailwind color palette and custom color option.
 * Supports bg-, text-, and border- prefixes.
 */

import React, { useState, useRef, useCallback } from 'react';
import { TailwindColor, getHexForColorClass } from './tailwindColors';
import { CustomColorPicker } from './CustomColorPicker';
import { TailwindPaletteGrid } from './TailwindPaletteGrid';
import { Popover, Button, Swatch, FieldChevron, fieldTrigger } from '@/components/ui';
import { VariablePicker } from './VariablePicker';
import { getColorClass } from '@/core/classes/vocabulary';

// ============================================================================
// Types
// ============================================================================

export type ColorPrefix = 'bg' | 'text' | 'border' | 'divide' | 'outline' | 'ring' | 'shadow' | 'fill' | 'stroke';

interface ColorPickerProps {
  /** Current color class value (e.g., 'bg-theme-error' or 'bg-[#ff0000]') */
  value: string;
  /** Callback when color changes */
  onChange: (colorClass: string, hex: string) => void;
  /** Color class prefix */
  prefix?: ColorPrefix;
  /** Placeholder text when no color selected */
  placeholder?: string;
  /**
   * Computed (inherited) hex to show when NO color class is set. Renders as a
   * muted "inherited" swatch instead of an unset indicator — never the
   * transparent checkerboard, which is reserved for genuinely transparent
   * values (task-094 B4/D6).
   */
  computedHex?: string;
  /** Additional class names for the container */
  className?: string;
  /** Several elements selected with different colours: the trigger reads "Mixed" (no swatch, no inherited hex). */
  mixed?: boolean;
}

// ============================================================================
// Helper Functions
// ============================================================================

// Common theme color names (shadcn/ui, custom themes, etc.)
// These are CSS variables so we can't resolve their hex values
const THEME_COLOR_NAMES = ['border', 'primary', 'secondary', 'muted', 'accent', 'destructive', 'card', 'popover', 'foreground', 'background', 'input', 'ring'];

const parseColorValue = (value: string, prefix: ColorPrefix): { type: 'tailwind' | 'custom' | 'theme' | 'variable' | 'none'; hex: string; tailwindValue: string } => {
  if (!value) {
    return { type: 'none', hex: '', tailwindValue: '' };
  }

  // Handle side-specific colors like border-b-red-600, border-t-[#fff]
  // Pattern: prefix-{side}-{color} where side is t, r, b, l, x, y
  const sideMatch = value.match(new RegExp(`^${prefix}-([trblxy])-(.+)$`));
  const colorPart = sideMatch ? sideMatch[2] : value.replace(new RegExp(`^${prefix}-`), '');

  // Check for CSS variable reference: [var(--name)] or the typed [color:var(--name)]
  const varMatch = colorPart.match(/^\[(?:color:)?var\(--(.+)\)\]$/);
  if (varMatch) {
    return { type: 'variable', hex: '', tailwindValue: varMatch[1] };
  }

  // Check for arbitrary hex color
  const hexMatch = colorPart.match(/^\[(#[0-9a-fA-F]{3,6})\]$/);
  if (hexMatch) {
    return { type: 'custom', hex: hexMatch[1], tailwindValue: '' };
  }

  // Check for arbitrary values (rgba, hsl, etc.)
  if (colorPart.startsWith('[') && colorPart.endsWith(']')) {
    return { type: 'custom', hex: '', tailwindValue: colorPart };
  }

  // Build the lookup class for getHexForColorClass
  const lookupClass = `${prefix}-${colorPart}`;
  const hex = getHexForColorClass(lookupClass, prefix);
  if (hex) {
    return { type: 'tailwind', hex, tailwindValue: colorPart };
  }

  // Check for theme colors (CSS variables - can't resolve hex)
  if (THEME_COLOR_NAMES.includes(colorPart)) {
    return { type: 'theme', hex: '', tailwindValue: colorPart };
  }

  return { type: 'none', hex: '', tailwindValue: '' };
};

// ============================================================================
// Component
// ============================================================================

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  prefix = 'bg',
  placeholder = 'Select color',
  computedHex: computedHexProp,
  className = '',
  mixed = false,
}) => {
  // Mixed reads as unset: no value, no inherited swatch (only the primary's is known), label "Mixed".
  const computedHex = mixed ? undefined : computedHexProp;
  const shownPlaceholder = mixed ? 'Mixed' : placeholder;
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomPicker, setShowCustomPicker] = useState(false);
  const [colorTab, setColorTab] = useState<'solid' | 'variable'>('solid');
  const triggerRef = useRef<HTMLButtonElement>(null);

  const parsed = parseColorValue(mixed ? '' : value, prefix);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setShowCustomPicker(false);
  }, []);

  const handleColorSelect = useCallback((color: TailwindColor) => {
    const colorClass = `${prefix}-${color.value}`;
    onChange(colorClass, color.hex);
    setIsOpen(false);
  }, [prefix, onChange]);

  const handleCustomColorChange = useCallback((hex: string) => {
    // Use vocabulary to get optimized color class (named if exact match, arbitrary otherwise)
    const colorClass = getColorClass(hex, prefix);
    onChange(colorClass, hex);
  }, [prefix, onChange]);

  const handleCustomColorComplete = useCallback(() => {
    setShowCustomPicker(false);
    setIsOpen(false);
  }, []);

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <Button
        ref={triggerRef}
        variant="outline"
        onClick={() => setIsOpen(!isOpen)}
        className={`${fieldTrigger} w-full pl-0 gap-0 justify-start text-xs`}
      >
        {parsed.type === 'none' ? (
          computedHex ? (
            <>
              {/* Inherited: no class set, but the element renders this color */}
              <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
                <div
                  data-testid="color-inherited-swatch"
                  className="w-4 h-4 rounded-sm border border-stroke"
                  style={{ backgroundColor: computedHex }}
                />
              </span>
              <span className="flex-1 text-left text-text-secondary px-1.5">
                {computedHex}
              </span>
            </>
          ) : (
            <>
              {/* Unset with no computed fallback: diagonal slash, NOT the
                  transparent checkerboard (that means "transparent", B4) */}
              <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
                <div
                  data-testid="color-unset-indicator"
                  className="w-4 h-4 rounded-sm border border-stroke"
                  style={{ background: 'linear-gradient(135deg, transparent 45%, #999 45%, #999 55%, transparent 55%)' }}
                />
              </span>
              <span className="flex-1 text-left text-text-secondary px-1.5">
                {shownPlaceholder}
              </span>
            </>
          )
        ) : parsed.type === 'variable' ? (
          <>
            {/* Variable reference - show dashed swatch with variable name */}
            <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
              <Swatch
                className="border-2 border-dashed border-stroke-active"
                color={`var(--${parsed.tailwindValue}, #888)`}
              />
            </span>
            <span className="flex-1 text-left text-text px-1.5 font-mono truncate">
              --{parsed.tailwindValue}
            </span>
          </>
        ) : parsed.type === 'theme' ? (
          <>
            {/* Theme colors are CSS variables - show a gradient placeholder */}
            <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
              <div
                className="w-4 h-4 rounded-sm border border-stroke"
                style={{
                  background: 'linear-gradient(135deg, var(--vscode-editor-foreground) 0%, var(--vscode-editor-background) 100%)'
                }}
              />
            </span>
            <span className="flex-1 text-left text-text px-1.5">
              {parsed.tailwindValue}
            </span>
          </>
        ) : (
          <>
            <span className="w-4 h-4 ml-1.5 flex items-center justify-center shrink-0">
              {/* Swatch's built-in checkerboard handles the transparent case */}
              <Swatch color={parsed.hex === 'transparent' ? 'transparent' : parsed.hex} />
            </span>
            <span className="flex-1 text-left px-1.5">
              {parsed.type === 'custom' ? parsed.hex : parsed.tailwindValue}
            </span>
          </>
        )}
        <FieldChevron />
      </Button>

      {/* Dropdown */}
      <Popover
        isOpen={isOpen}
        onClose={handleClose}
        triggerRef={triggerRef}
        placement="bottom-start"
        width={280}
        maxHeight={360}
      >
        {/* padding lives INSIDE the scroll area — on the popover frame it gets
            clipped by overflow-hidden and cuts the last row */}
        <div className="p-2">
        {showCustomPicker ? (
          <CustomColorPicker
            value={parsed.hex || '#000000'}
            onChange={handleCustomColorChange}
            onClose={handleCustomColorComplete}
          />
        ) : (
          <>
            {/* Tab toggle */}
            <div className="flex gap-1 mb-2">
              <Button
                variant="ghost"
                size="sm"
                label="Solid"
                active={colorTab === 'solid'}
                onClick={() => setColorTab('solid')}
                className="flex-1"
              />
              <Button
                variant="ghost"
                size="sm"
                label="Variable"
                active={colorTab === 'variable'}
                onClick={() => setColorTab('variable')}
                className="flex-1"
              />
            </div>

            {colorTab === 'solid' ? (
              <TailwindPaletteGrid
                isSelected={color => parsed.tailwindValue === color.value}
                onSelect={handleColorSelect}
                onCustomClick={() => setShowCustomPicker(true)}
              />
            ) : (
              <VariablePicker
                prefix={prefix}
                onSelect={(colorClass, hex) => {
                  onChange(colorClass, hex);
                  setIsOpen(false);
                }}
              />
            )}
          </>
        )}
        </div>
      </Popover>
    </div>
  );
};

export default ColorPicker;
