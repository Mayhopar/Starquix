/**
 * Unified Class System - Constants
 *
 * Property prefixes and standalone class groups for replacement logic.
 */

// Prefixes that appear in class strings (not 'xs' for breakpoint, not 'default' for state)
export const BREAKPOINT_PREFIXES = ['sm', 'md', 'lg', 'xl', '2xl'] as const;
export const STATE_PREFIXES = ['hover', 'focus', 'active', 'disabled'] as const;
export const THEME_PREFIXES = ['dark'] as const;

/**
 * Known Tailwind property prefixes.
 * Sorted by length (longest first) for matching.
 */
export const PROPERTY_PREFIXES = [
  // Negative margins (must come before positive)
  '-m-', '-mx-', '-my-', '-mt-', '-mr-', '-mb-', '-ml-',
  // Spacing
  'p-', 'px-', 'py-', 'pt-', 'pr-', 'pb-', 'pl-',
  'm-', 'mx-', 'my-', 'mt-', 'mr-', 'mb-', 'ml-',
  // Sizing
  'w-', 'h-', 'min-w-', 'max-w-', 'min-h-', 'max-h-', 'size-',
  // Layout
  'flex-', 'grid-cols-', 'grid-rows-', 'grid-flow-', 'grid-', 'gap-', 'gap-x-', 'gap-y-',
  // Grid child placement (col-start/end and row-start/end are separate properties)
  'col-start-', 'col-end-', 'col-span-', 'col-',
  'row-start-', 'row-end-', 'row-span-', 'row-',
  'space-x-', 'space-y-',
  'justify-', 'items-', 'self-', 'place-', 'content-', 'order-',
  // Typography
  'text-', 'font-', 'leading-', 'tracking-', 'indent-',
  'decoration-', 'underline-offset-',
  // Colors & Backgrounds
  'bg-', 'from-', 'via-', 'to-',
  'border-', 'border-t-', 'border-r-', 'border-b-', 'border-l-',
  'border-x-', 'border-y-',
  'ring-', 'ring-offset-',
  'outline-', 'outline-offset-',
  'shadow-',
  'divide-', 'divide-x-', 'divide-y-',
  // Effects
  'opacity-', 'mix-blend-', 'bg-blend-',
  'blur-', 'brightness-', 'contrast-', 'grayscale-', 'hue-rotate-',
  'invert-', 'saturate-', 'sepia-', 'drop-shadow-',
  'backdrop-blur-', 'backdrop-brightness-', 'backdrop-contrast-',
  'backdrop-grayscale-', 'backdrop-opacity-', 'backdrop-saturate-',
  // Border radius
  'rounded-', 'rounded-t-', 'rounded-r-', 'rounded-b-', 'rounded-l-',
  'rounded-tl-', 'rounded-tr-', 'rounded-br-', 'rounded-bl-',
  'rounded-s-', 'rounded-e-',
  // Position
  'top-', 'right-', 'bottom-', 'left-',
  'inset-', 'inset-x-', 'inset-y-',
  'start-', 'end-',
  'z-',
  // Transforms
  'scale-', 'scale-x-', 'scale-y-',
  'rotate-',
  'translate-x-', 'translate-y-',
  'skew-x-', 'skew-y-',
  'origin-',
  // Transitions
  'transition-', 'duration-', 'ease-', 'delay-',
  // Interactivity
  'cursor-', 'select-', 'pointer-events-', 'resize-',
  'scroll-m-', 'scroll-p-',
  'snap-', 'touch-', 'will-change-',
  // Other
  'aspect-', 'columns-',
  'object-',
  'overflow-', 'overflow-x-', 'overflow-y-',
  'overscroll-',
  'float-', 'clear-',
  'fill-', 'stroke-',
  'accent-', 'caret-',
].sort((a, b) => b.length - a.length); // Sort by length, longest first

/**
 * Classes that are whole words (no prefix pattern) - grouped by what they replace.
 */
export const STANDALONE_GROUPS: Record<string, string[]> = {
  position: ['static', 'relative', 'absolute', 'fixed', 'sticky'],
  display: [
    'block', 'inline-block', 'inline', 'flex', 'inline-flex',
    'grid', 'inline-grid', 'hidden', 'contents', 'flow-root', 'list-item', 'table'
  ],
  visibility: ['visible', 'invisible', 'collapse'],
  flexDirection: ['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse'],
  flexWrap: ['flex-wrap', 'flex-nowrap', 'flex-wrap-reverse'],
  flexGrow: ['grow', 'grow-0'],
  flexShrink: ['shrink', 'shrink-0'],
  textAlign: ['text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end'],
  // Text sizes must be separate from text colors (both use text- prefix)
  textSize: [
    'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl',
    'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl',
    'text-7xl', 'text-8xl', 'text-9xl'
  ],
  // text-wrap must be separate from text colors (both use text- prefix) (task-265)
  textWrap: ['text-wrap', 'text-nowrap', 'text-balance', 'text-pretty'],
  textTransform: ['uppercase', 'lowercase', 'capitalize', 'normal-case'],
  textDecoration: ['underline', 'overline', 'line-through', 'no-underline'],
  textOverflow: ['truncate', 'text-ellipsis', 'text-clip'],
  fontStyle: ['italic', 'not-italic'],
  // Font family must be separate from font weight (both use font- prefix)
  fontFamily: ['font-sans', 'font-serif', 'font-mono'],
  // Font weight must be separate from font family (both use font- prefix)
  fontWeight: [
    'font-thin', 'font-extralight', 'font-light', 'font-normal',
    'font-medium', 'font-semibold', 'font-bold', 'font-extrabold', 'font-black'
  ],
  fontSmoothing: ['antialiased', 'subpixel-antialiased'],
  whitespace: [
    'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre',
    'whitespace-pre-line', 'whitespace-pre-wrap', 'whitespace-break-spaces'
  ],
  wordBreak: ['break-normal', 'break-words', 'break-all', 'break-keep'],
  borderStyle: [
    'border-solid', 'border-dashed', 'border-dotted',
    'border-double', 'border-hidden', 'border-none'
  ],
  // Border width classes - all sides
  borderWidth: ['border', 'border-0', 'border-2', 'border-4', 'border-8'],
  // Border width classes - individual sides
  borderWidthT: ['border-t', 'border-t-0', 'border-t-2', 'border-t-4', 'border-t-8'],
  borderWidthR: ['border-r', 'border-r-0', 'border-r-2', 'border-r-4', 'border-r-8'],
  borderWidthB: ['border-b', 'border-b-0', 'border-b-2', 'border-b-4', 'border-b-8'],
  borderWidthL: ['border-l', 'border-l-0', 'border-l-2', 'border-l-4', 'border-l-8'],
  borderWidthX: ['border-x', 'border-x-0', 'border-x-2', 'border-x-4', 'border-x-8'],
  borderWidthY: ['border-y', 'border-y-0', 'border-y-2', 'border-y-4', 'border-y-8'],
  outlineStyle: ['outline-none', 'outline', 'outline-dashed', 'outline-dotted', 'outline-double'],
  boxSizing: ['box-border', 'box-content'],
  tableLayout: ['table-auto', 'table-fixed'],
  captionSide: ['caption-top', 'caption-bottom'],
  borderCollapse: ['border-collapse', 'border-separate'],
  isolation: ['isolate', 'isolation-auto'],
  objectFit: ['object-contain', 'object-cover', 'object-fill', 'object-none', 'object-scale-down'],
  // Background sub-properties (all share bg- prefix but control different CSS properties)
  bgSize: ['bg-cover', 'bg-contain', 'bg-auto'],
  bgPosition: [
    'bg-center', 'bg-top', 'bg-bottom', 'bg-left', 'bg-right',
    'bg-left-top', 'bg-left-bottom', 'bg-right-top', 'bg-right-bottom'
  ],
  bgRepeat: ['bg-repeat', 'bg-no-repeat', 'bg-repeat-x', 'bg-repeat-y', 'bg-repeat-round', 'bg-repeat-space'],
  bgAttachment: ['bg-fixed', 'bg-local', 'bg-scroll'],
  bgOrigin: ['bg-origin-border', 'bg-origin-padding', 'bg-origin-content'],
  bgClip: ['bg-clip-border', 'bg-clip-padding', 'bg-clip-content', 'bg-clip-text'],
};

// What makes font-[…] a weight; any other font-[…] is a family (see ARBITRARY_PATTERNS).
const FONT_WEIGHT_VALUE = String.raw`(\d+|number:[^\]]+|(var|clamp|calc|min|max)\([^\]]+\))`;

/**
 * Regex patterns for classes that have a prefix followed by arbitrary value.
 * These are checked after standalone groups but before generic prefix matching.
 * Key is the property group name, value is the regex pattern.
 */
export const ARBITRARY_PATTERNS: Record<string, RegExp> = {
  // Text size with arbitrary values: text-[18px], text-[1.5vw], text-[clamp(1rem,2vw,3rem)], etc.
  // Match numeric values with any CSS unit (px, rem, em, vw, vh, %, etc.) or sizing functions
  // Excludes color values (starting with # or color functions like rgb/hsl) and a bare
  // var(): Tailwind 3.4 compiles text-[var(--x)] to `color` (task-262).
  'standalone:textSize': /^text-\[\d+(\.\d+)?[a-z%]*\]$|^text-\[(clamp|calc|min|max)\([^\]]+\)\]$/,
  // Border width with arbitrary values: border-[3px], border-[thin], border-[calc(...)], etc.
  // Match numeric values, CSS keywords (thin/medium/thick), or sizing functions
  // Excludes color values (starting with # or color functions) and a bare var():
  // Tailwind 3.4 compiles border-[var(--x)] to `border-color` (task-263).
  'standalone:borderWidth': /^border-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  'standalone:borderWidthT': /^border-t-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  'standalone:borderWidthR': /^border-r-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  'standalone:borderWidthB': /^border-b-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  'standalone:borderWidthL': /^border-l-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  'standalone:borderWidthX': /^border-x-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  'standalone:borderWidthY': /^border-y-\[(\d+(\.\d+)?[a-z%]*|thin|medium|thick|(clamp|calc|min|max)\([^\]]+\))\]$/,
  // Background image with arbitrary URL: bg-[url('...')], bg-[url("...")], bg-[url(...)]
  'standalone:bgImage': /^bg-\[url\(/,
  // Stroke WIDTH must be separate from stroke COLOR (both use stroke-):
  // stroke-0/1/2 presets + stroke-[3px] arbitrary. Colors (stroke-gray-900,
  // stroke-[#hex]) fall through to the 'stroke-' prefix group. (task-107)
  'standalone:strokeWidth': /^stroke-(\d+(\.\d+)?|\[\d+(\.\d+)?[a-z%]*\])$/,
  // font-[…] is a WEIGHT when the value is a number, number:…, or a var()/math
  // function, and a FAMILY otherwise: font-["Inter"], font-[Inter], font-[system-ui],
  // font-[Inter,sans-serif], font-[family-name:var(--heading)]. That is what the sites'
  // Tailwind 3.4.19 emits (compiled 2026-11-12) for every value that renders; what it
  // turns into an invalid font-weight (font-[Open_Sans], font-[100px]) counts as a
  // family here. Same slots as the named classes, so a pick replaces them.
  // (task-112, task-264)
  'standalone:fontFamily': new RegExp(String.raw`^font-\[(?!${FONT_WEIGHT_VALUE}\]$)[^\]]+\]$`),
  'standalone:fontWeight': new RegExp(String.raw`^font-\[${FONT_WEIGHT_VALUE}\]$`),
};
