/**
 * Pen Style Block (task-107)
 *
 * Fill color / stroke color / stroke width for pen (bezier path) elements.
 * Edits `fill-*`, `stroke-*` and `stroke-[Npx]` WRAPPER classes — the inner
 * SVG <path> carries no paint attributes, so both properties inherit via CSS.
 * Transparent swatch maps to the SVG-canonical `fill-none` / `stroke-none`.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { findClass, setClass } from '../utils';
import { ColorPicker } from '../ColorPicker';
import { Row, Field } from '@/components/ui';
import { COLOR_FAMILIES } from '@/core/classes/vocabulary';
import { ARBITRARY_PATTERNS } from '@/core/classes/constants';

// Color-name union from the canonical vocabulary (plus the SVG specials).
const COLOR_NAMES = ['none', 'current', 'transparent', 'white', 'black', ...Object.keys(COLOR_FAMILIES)].join('|');
const FILL_COLOR_RE = new RegExp(`^fill-(?:${COLOR_NAMES})(?:-\\d+)?(?:\\/\\d+)?$|^fill-\\[#[0-9a-fA-F]+\\](?:\\/\\d+)?$`);
const STROKE_COLOR_RE = new RegExp(`^stroke-(?:${COLOR_NAMES})(?:-\\d+)?(?:\\/\\d+)?$|^stroke-\\[#[0-9a-fA-F]+\\](?:\\/\\d+)?$`);
// Width find/replace uses THE shared classifier — a private twin would drift
// (e.g. stroke-[3rem] classified as width upstream but missed here).
const STROKE_WIDTH_RE = ARBITRARY_PATTERNS['standalone:strokeWidth'];

function parseStrokeWidth(classes: string): string {
  const token = findClass(classes, STROKE_WIDTH_RE);
  return token?.match(/([\d.]+)/)?.[1] ?? '';
}

interface PenStyleBlockProps {
  classes: string;
  onClassesChange: (classes: string) => void;
}

export const PenStyleBlock: React.FC<PenStyleBlockProps> = ({ classes, onClassesChange }) => {
  const fillToken = findClass(classes, FILL_COLOR_RE) || '';
  const strokeToken = findClass(classes, STROKE_COLOR_RE) || '';
  const [width, setWidth] = useState(() => parseStrokeWidth(classes));

  // External class changes (undo, reselect) re-sync the width draft.
  useEffect(() => {
    setWidth(parseStrokeWidth(classes));
  }, [classes]);

  const handleFillChange = useCallback(
    (colorClass: string) => {
      const next = setClass(classes, FILL_COLOR_RE, null);
      // transparent/cleared → fill-none: an SVG path with NO fill paints black,
      // so absence is not "none" here.
      const token = !colorClass || colorClass === 'fill-transparent' ? 'fill-none' : colorClass;
      onClassesChange(`${next} ${token}`.trim());
    },
    [classes, onClassesChange],
  );

  const handleStrokeChange = useCallback(
    (colorClass: string) => {
      const next = setClass(classes, STROKE_COLOR_RE, null);
      const token = !colorClass || colorClass === 'stroke-transparent' ? 'stroke-none' : colorClass;
      onClassesChange(`${next} ${token}`.trim());
    },
    [classes, onClassesChange],
  );

  const commitWidth = useCallback(() => {
    const n = parseFloat(width);
    if (!Number.isFinite(n) || n <= 0 || String(n) === parseStrokeWidth(classes)) return;
    const next = setClass(classes, STROKE_WIDTH_RE, null);
    onClassesChange(`${next} stroke-[${n}px]`.trim());
  }, [width, classes, onClassesChange]);

  return (
    <div className="space-y-1 pr-8 pb-2">
      <div data-testid="pen-fill-picker">
        <Row title="Fill" size="sm" />
        <ColorPicker value={fillToken} onChange={handleFillChange} prefix="fill" placeholder="None" />
      </div>
      <div data-testid="pen-stroke-picker">
        <Row title="Stroke" size="sm" />
        <ColorPicker value={strokeToken} onChange={handleStrokeChange} prefix="stroke" placeholder="None" />
      </div>
      <div>
        <Row title="Stroke width" size="sm" />
        <Field
          type="number"
          min={0}
          step={0.5}
          value={width}
          onChange={setWidth}
          onBlur={commitWidth}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
};

export default PenStyleBlock;
