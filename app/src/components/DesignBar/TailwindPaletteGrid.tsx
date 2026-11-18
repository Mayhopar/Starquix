/**
 * Tailwind Palette Grid
 *
 * Shared swatch grid (base colors + color families + "Custom Color" button).
 * Used by DesignBar ColorPicker (class-domain) and VariableColorCell (hex-domain).
 */

import React from 'react';
import { Button } from '@/components/ui';
import { COLOR_FAMILIES, BASE_COLORS, TailwindColor } from './tailwindColors';
import { ColorIcon } from '@/assets/icons';

// Checkerboard pattern for transparent colors
export const TransparentPattern: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <div
    className="rounded-sm border border-stroke"
    style={{
      width: size,
      height: size,
      background: `
        linear-gradient(45deg, #ccc 25%, transparent 25%),
        linear-gradient(-45deg, #ccc 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #ccc 75%),
        linear-gradient(-45deg, transparent 75%, #ccc 75%)
      `,
      backgroundSize: `${size / 2}px ${size / 2}px`,
      backgroundPosition: `0 0, 0 ${size / 4}px, ${size / 4}px -${size / 4}px, -${size / 4}px 0px`
    }}
  />
);

interface TailwindPaletteGridProps {
  /** Returns true when a swatch should render as selected */
  isSelected: (color: TailwindColor) => boolean;
  onSelect: (color: TailwindColor) => void;
  onCustomClick: () => void;
  /** Hide swatches without a real hex (transparent) — for hex-only consumers like variables */
  hexOnly?: boolean;
}

export const TailwindPaletteGrid: React.FC<TailwindPaletteGridProps> = ({
  isSelected,
  onSelect,
  onCustomClick,
  hexOnly = false
}) => {
  const baseColors = hexOnly ? BASE_COLORS.filter(c => c.hex.startsWith('#')) : BASE_COLORS;

  // Grid swatches size to their fr track (fixed 22px overflows an 11-col grid
  // in a 280px popover); base-row swatches stay fixed in their flex row.
  const renderSwatch = (color: TailwindColor, sizeClass = 'w-full aspect-square') => {
    const isTransparent = color.value === 'transparent';
    return (
      <Button
        key={color.value}
        variant="ghost"
        onClick={() => onSelect(color)}
        title={color.value}
        className={`h-auto p-0 ${sizeClass} rounded-sm border border-stroke shrink-0 bg-transparent hover:bg-transparent active:bg-transparent ${
          isSelected(color) ? 'ring-2 ring-stroke-active ring-offset-1' : ''
        }`}
        style={{ backgroundColor: isTransparent ? 'transparent' : color.hex }}
      >
        {isTransparent && <TransparentPattern size={20} />}
      </Button>
    );
  };

  return (
    <>
      {/* Base Colors */}
      <div className="text-3xs text-text-secondary capitalize mb-1 mt-2">Base</div>
      <div className="flex gap-1 mb-2">
        {baseColors.map(color => renderSwatch(color, 'w-[22px] h-[22px]'))}
      </div>

      {/* Color Families */}
      {COLOR_FAMILIES.map(family => (
        <div key={family.name}>
          <div className="text-3xs text-text-secondary capitalize mb-1 mt-2">{family.name}</div>
          <div className="grid grid-cols-11 gap-1 mb-2">
            {family.shades.map(color => renderSwatch(color))}
          </div>
        </div>
      ))}

      {/* Custom Color Button */}
      <Button
        variant="ghost"
        onClick={onCustomClick}
        icon={<ColorIcon className="w-4 h-4" />}
        label="Custom Color"
        className="w-full h-auto mt-2 gap-1 py-1.5 px-1.5 border border-dashed border-stroke rounded-sm font-normal text-xs text-text-secondary hover:text-text-secondary bg-transparent hover:bg-transparent active:bg-transparent"
      />
    </>
  );
};
