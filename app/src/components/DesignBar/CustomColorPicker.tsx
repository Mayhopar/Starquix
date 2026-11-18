/**
 * Custom Color Picker (Figma-style) - Tailwind version
 *
 * A color picker with saturation/brightness square, hue slider, and hex input.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { rgbToHex } from './utils';
import { Button, Swatch } from '@/components/ui';

// ============================================================================
// Color Conversion Utilities
// ============================================================================

interface HSV {
  h: number; // 0-360
  s: number; // 0-100
  v: number; // 0-100
}

interface RGB {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
}

const hexToRgb = (hex: string): RGB => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    // Try 3-character hex
    const shortResult = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(hex);
    if (shortResult) {
      return {
        r: parseInt(shortResult[1] + shortResult[1], 16),
        g: parseInt(shortResult[2] + shortResult[2], 16),
        b: parseInt(shortResult[3] + shortResult[3], 16)
      };
    }
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  };
};

const rgbToHsv = (rgb: RGB): HSV => {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;

  let h = 0;
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;

  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        break;
      case g:
        h = ((b - r) / d + 2) * 60;
        break;
      case b:
        h = ((r - g) / d + 4) * 60;
        break;
    }
  }

  return { h, s, v };
};

const hsvToRgb = (hsv: HSV): RGB => {
  const h = hsv.h / 360;
  const s = hsv.s / 100;
  const v = hsv.v / 100;

  let r = 0, g = 0, b = 0;

  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);

  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }

  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
};

const hsvToHex = (hsv: HSV): string => rgbToHex(hsvToRgb(hsv));
const hexToHsv = (hex: string): HSV => rgbToHsv(hexToRgb(hex));

// ============================================================================
// Component
// ============================================================================

interface CustomColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}

export const CustomColorPicker: React.FC<CustomColorPickerProps> = ({
  value,
  onChange,
  onClose
}) => {
  const [hsv, setHsv] = useState<HSV>(() => hexToHsv(value || '#000000'));
  const [hexInput, setHexInput] = useState(value || '#000000');

  const saturationRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const isDraggingSaturation = useRef(false);
  const isDraggingHue = useRef(false);

  // Update hex input when HSV changes (local state only, don't call onChange)
  useEffect(() => {
    const newHex = hsvToHex(hsv);
    setHexInput(newHex);
  }, [hsv]);

  // Commit color change (called on mouseup, not during drag)
  const commitColor = useCallback(() => {
    const newHex = hsvToHex(hsv);
    onChange(newHex);
  }, [hsv, onChange]);

  // Saturation/Brightness picker handlers
  const handleSaturationMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingSaturation.current = true;
    handleSaturationMove(e.nativeEvent);
  }, []);

  const handleSaturationMove = useCallback((e: MouseEvent | React.MouseEvent['nativeEvent']) => {
    if (!saturationRef.current) return;

    const rect = saturationRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const s = (x / rect.width) * 100;
    const v = 100 - (y / rect.height) * 100;

    setHsv(prev => ({ ...prev, s, v }));
  }, []);

  // Hue slider handlers
  const handleHueMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingHue.current = true;
    handleHueMove(e.nativeEvent);
  }, []);

  const handleHueMove = useCallback((e: MouseEvent | React.MouseEvent['nativeEvent']) => {
    if (!hueRef.current) return;

    const rect = hueRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const h = (x / rect.width) * 360;

    setHsv(prev => ({ ...prev, h }));
  }, []);

  // Global mouse move/up handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSaturation.current) {
        handleSaturationMove(e);
      } else if (isDraggingHue.current) {
        handleHueMove(e);
      }
    };

    const handleMouseUp = () => {
      const wasDragging = isDraggingSaturation.current || isDraggingHue.current;
      isDraggingSaturation.current = false;
      isDraggingHue.current = false;
      // Commit color on mouseup after dragging
      if (wasDragging) {
        commitColor();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleSaturationMove, handleHueMove, commitColor]);

  // Hex input handler
  const handleHexChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    let input = e.target.value;
    setHexInput(input);

    // Normalize input
    if (!input.startsWith('#')) {
      input = '#' + input;
    }

    // Validate and update
    if (/^#[0-9a-fA-F]{6}$/.test(input) || /^#[0-9a-fA-F]{3}$/.test(input)) {
      setHsv(hexToHsv(input));
    }
  }, []);

  // RGB input handlers
  const handleRgbChange = useCallback((channel: 'r' | 'g' | 'b', value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;

    const rgb = hsvToRgb(hsv);
    rgb[channel] = Math.max(0, Math.min(255, num));
    setHsv(rgbToHsv(rgb));
  }, [hsv]);

  const currentRgb = hsvToRgb(hsv);
  const currentHex = hsvToHex(hsv);
  const hueColor = hsvToHex({ h: hsv.h, s: 100, v: 100 });

  return (
    <div className="p-1">
      {/* Saturation/Brightness Box */}
      <div
        ref={saturationRef}
        onMouseDown={handleSaturationMouseDown}
        className="relative w-full h-[150px] rounded-sm cursor-crosshair mb-3"
        style={{
          background: `
            linear-gradient(to top, #000, transparent),
            linear-gradient(to right, #fff, ${hueColor})
          `
        }}
      >
        <div
          className="absolute w-3 h-3 rounded-full border-2 border-white -translate-x-1/2 -translate-y-1/2 pointer-events-none"
          style={{
            left: `${hsv.s}%`,
            top: `${100 - hsv.v}%`,
            backgroundColor: currentHex,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)'
          }}
        />
      </div>

      {/* Hue Slider */}
      <div
        ref={hueRef}
        onMouseDown={handleHueMouseDown}
        className="relative w-full h-3 rounded-md cursor-pointer mb-3"
        style={{
          background: 'linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)'
        }}
      >
        <div
          className="absolute w-1 h-4 -top-0.5 rounded-sm border-2 border-white -translate-x-1/2 pointer-events-none"
          style={{
            left: `${(hsv.h / 360) * 100}%`,
            backgroundColor: hueColor,
            boxShadow: '0 0 0 1px rgba(0,0,0,0.3), 0 2px 4px rgba(0,0,0,0.2)'
          }}
        />
      </div>

      {/* Color Preview and Hex Input */}
      <div className="flex gap-2 items-center mb-2">
        <Swatch color={currentHex} className="w-8 h-8" />
        <div className="flex flex-1 border border-input-stroke rounded-sm overflow-hidden bg-input-fill">
          <span className="pl-2 py-1 text-3xs text-text-secondary">
            HEX
          </span>
          <input
            type="text"
            value={hexInput}
            onChange={handleHexChange}
            onBlur={commitColor}
            className="flex-1 py-1 px-1.5 text-xs bg-transparent text-text outline-none min-w-0"
            maxLength={7}
          />
        </div>
      </div>

      {/* RGB Inputs */}
      <div className="flex gap-2 mb-2">
        <div className="flex flex-1 border border-input-stroke rounded-sm overflow-hidden bg-input-fill">
          <span className="pl-2 py-1 text-3xs text-text-secondary">
            R
          </span>
          <input
            type="number"
            value={currentRgb.r}
            onChange={e => handleRgbChange('r', e.target.value)}
            onBlur={commitColor}
            className="flex-1 py-1 px-1.5 text-xs bg-transparent text-text outline-none min-w-0"
            min={0}
            max={255}
          />
        </div>
        <div className="flex flex-1 border border-input-stroke rounded-sm overflow-hidden bg-input-fill">
          <span className="pl-2 py-1 text-3xs text-text-secondary">
            G
          </span>
          <input
            type="number"
            value={currentRgb.g}
            onChange={e => handleRgbChange('g', e.target.value)}
            onBlur={commitColor}
            className="flex-1 py-1 px-1.5 text-xs bg-transparent text-text outline-none min-w-0"
            min={0}
            max={255}
          />
        </div>
        <div className="flex flex-1 border border-input-stroke rounded-sm overflow-hidden bg-input-fill">
          <span className="pl-2 py-1 text-3xs text-text-secondary">
            B
          </span>
          <input
            type="number"
            value={currentRgb.b}
            onChange={e => handleRgbChange('b', e.target.value)}
            onBlur={commitColor}
            className="flex-1 py-1 px-1.5 text-xs bg-transparent text-text outline-none min-w-0"
            min={0}
            max={255}
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          label="Back"
          onClick={onClose}
          className="flex-1 font-normal bg-bg"
        />
        <Button
          variant="primary"
          size="sm"
          label="Done"
          onClick={() => { commitColor(); onClose(); }}
          className="flex-1 font-normal"
        />
      </div>
    </div>
  );
};

export default CustomColorPicker;
