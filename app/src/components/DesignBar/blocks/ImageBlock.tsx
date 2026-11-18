/**
 * object-fit / object-position class helpers (task-144: the ImageBlock UI is
 * retired — Fill's Media tab is THE image surface in every runtime; FillBlock
 * imports these parse/set helpers and the option lists from here).
 */

import { findClass, setClass } from '../utils';

// Corner classes: Tailwind uses object-left-top order; UI values use top-left
// (same remap as FillBlock's bg-* position handling).
const OBJECT_FIT_RE = /^object-(fill|cover|contain|none|scale-down)$/;
const OBJECT_POSITION_RE = /^object-(center|top|bottom|left|right|left-top|left-bottom|right-top|right-bottom)$/;

export const parseObjectFit = (classes: string): string =>
  findClass(classes, OBJECT_FIT_RE)?.replace('object-', '') ?? '';

export const parseObjectPosition = (classes: string): string => {
  const token = findClass(classes, OBJECT_POSITION_RE);
  if (!token) return '';
  return token.replace('object-', '')
    .replace('left-top', 'top-left').replace('left-bottom', 'bottom-left')
    .replace('right-top', 'top-right').replace('right-bottom', 'bottom-right');
};

// Always writes an explicit class (even the browser default) so mergeClasses can
// override base classes — same rationale as FillBlock's handleImageSizeChange.
export const setObjectFit = (classes: string, fit: string): string =>
  (setClass(classes, OBJECT_FIT_RE, null) + ` object-${fit || 'fill'}`).trim();

export const setObjectPosition = (classes: string, position: string): string => {
  const tw = (position || 'center')
    .replace('top-left', 'left-top').replace('top-right', 'right-top')
    .replace('bottom-left', 'left-bottom').replace('bottom-right', 'right-bottom');
  return (setClass(classes, OBJECT_POSITION_RE, null) + ` object-${tw}`).trim();
};

export const OBJECT_FIT_OPTIONS = [
  { value: 'fill', label: 'Fill' },
  { value: 'cover', label: 'Cover' },
  { value: 'contain', label: 'Contain' }
];

// Same 9 values/labels as FillBlock's BG_POSITION_OPTIONS
export const OBJECT_POSITION_OPTIONS = [
  { value: 'center', label: 'Center' },
  { value: 'top', label: 'Top' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' },
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-right', label: 'Bottom Right' }
];
