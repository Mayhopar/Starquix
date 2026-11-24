// Element/class predicates shared by the single-element and multi-select Design Bar panels.

export const TEXT_ELEMENTS = new Set([
  'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'label', 'li', 'td', 'th',
  'dt', 'dd', 'figcaption', 'blockquote', 'q', 'cite', 'em', 'strong', 'small',
  'mark', 'del', 'ins', 'sub', 'sup', 'code', 'pre', 'abbr', 'time', 'b', 'i', 'u', 's'
]);

// Regex patterns for detecting class categories
export const CLASS_PATTERNS = {
  // Anchored to a token's start: group-hover:bg-… is not a fill of this element.
  fill: /(^|\s)bg-/,
  stroke: /(^|\s)(border|outline|ring)([-\s]|$)/,
  effects: /(^|\s|:)(shadow|blur|backdrop-blur|grayscale|invert|sepia|brightness-|contrast-|saturate-)/
} as const;

/** Fill gradient directions (the Fill block's Gradient tab, single and multi). */
export const GRADIENT_DIRECTIONS = [
  { value: 'to-t', label: 'Top' },
  { value: 'to-tr', label: 'Top Right' },
  { value: 'to-r', label: 'Right' },
  { value: 'to-br', label: 'Bottom Right' },
  { value: 'to-b', label: 'Bottom' },
  { value: 'to-bl', label: 'Bottom Left' },
  { value: 'to-l', label: 'Left' },
  { value: 'to-tl', label: 'Top Left' }
];
