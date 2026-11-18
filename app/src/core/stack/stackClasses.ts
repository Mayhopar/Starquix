/**
 * Stack layout classes — the ONE list the editor and Stack.astro share.
 * Stack.astro runs inside the user's project and cannot import this file, so
 * it carries literal copies; stackClasses.parity.test.ts fails on drift.
 * Tailwind only scans literals: never build these strings dynamically.
 */
export type StackDirection = 'column' | 'row';
export type StackRatio = '1:1' | '2:1' | '1:2';
export type StackWidth = 'reading' | 'wide' | 'edge';

export const ROW_BASE = 'grid grid-cols-1 items-start gap-8 lg:gap-12 [&>*]:min-w-0 [&>*>:first-child]:mt-0 [&>*>:last-child]:mb-0';
export const ROW_RATIO: Record<StackRatio, string> = {
  '1:1': 'lg:grid-cols-2',
  '2:1': 'lg:grid-cols-[2fr_1fr]',
  '1:2': 'lg:grid-cols-[1fr_2fr]',
};
/**
 * Widths follow the ALIGNMENT LINES (core/post/articleTokens.ts LINES):
 * content lands on text (39.5rem measure), wide (64rem) or full (viewport);
 * gutter 1.25rem / 1.5rem from sm. wide = a 64rem content box + one gutter
 * each side (= the classic cover); edge = the viewport, content inset to the
 * wide line (EDGE_INSET) except an uncolored column, which bleeds (full media).
 */
export const TOP_WIDTH: Record<StackWidth, string> = {
  reading: 'w-full',
  wide: 'relative left-1/2 -translate-x-1/2 w-[min(66.5rem,100vw)] sm:w-[min(67rem,100vw)] px-5 sm:px-6',
  edge: 'relative left-1/2 -translate-x-1/2 w-screen',
};
/** Edge row / colored edge band: content box = the wide line. */
export const EDGE_INSET = 'px-[max(1.25rem,calc((100vw-64rem)/2))] sm:px-[max(1.5rem,calc((100vw-64rem)/2))]';
/** Colored at reading width: the band reaches the column's gutter (inside a PostLayout), its text stays on the text line. */
export const READING_COLORED = '[[data-sq-post-layout]_&]:-mx-5 sm:[[data-sq-post-layout]_&]:-mx-6 px-5 sm:px-6';
/** Column children: neutralize a nested Stack's breakout (P3) — it fills the parent's content, capped at the wide line. */
export const COLUMN_NESTED = '[&>[data-sq-stack]]:left-0 [&>[data-sq-stack]]:translate-x-0 [&>[data-sq-stack]]:mx-auto [&>[data-sq-stack]]:w-full [&>[data-sq-stack]]:max-w-[64rem] [&>[data-sq-stack]:not([data-sq-colored])]:px-0';
/** Column wider than reading: text stays on the text line (P4). `&&` outranks the article's own blockquote/pre/table margins. */
export const COLUMN_TEXT_CAP = '[&&>:is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table)]:mx-auto [&&>:is(p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,pre,table)]:max-w-[39.5rem]';
/** Any Stack carrying a bg-* class (side padding comes from its width rule). */
export const COLORED = '[&>:first-child]:mt-0 [&>:last-child]:mb-0 [&:not(:has(*))]:py-6 [[data-sq-colored]+&]:mt-0 [&:has(+[data-sq-colored])]:mb-0 [[data-sq-block]:has(>[data-sq-colored])+[data-sq-block]>&]:mt-0 [[data-sq-block]:has(+[data-sq-block]>[data-sq-colored])>&]:mb-0';
/** Band padding: a reading-width band is a callout (32/40), wider ones are sections (48/64). */
export const COLORED_PAD: Record<'reading' | 'band', string> = {
  reading: 'py-8 md:py-10',
  band: 'py-12 md:py-16',
};
/** Text color reaches headings/links/captions and beats typography-plugin vars. */
export const COLORED_TEXT = '[--tw-prose-body:currentColor] [--tw-prose-headings:currentColor] [--tw-prose-links:currentColor] [--tw-prose-bold:currentColor] [--tw-prose-quotes:currentColor] [--tw-prose-captions:currentColor] [&_:is(h1,h2,h3,h4,h5,h6,figcaption,blockquote)]:text-inherit [&_a]:text-inherit [&_a]:underline';
/**
 * Soft corners only while the band is narrower than the screen (a rounded band
 * touching both screen edges looks broken); flat where two bands touch. Edge bands stay square.
 */
const JOIN = '[[data-sq-colored]+&]:rounded-t-none [&:has(+[data-sq-colored])]:rounded-b-none [[data-sq-block]:has(>[data-sq-colored])+[data-sq-block]>&]:rounded-t-none [[data-sq-block]:has(+[data-sq-block]>[data-sq-colored])>&]:rounded-b-none';
export const COLORED_ROUND: Record<'reading' | 'wide', string> = {
  reading: `min-[680px]:rounded-xl ${JOIN}`,
  wide: `min-[1072px]:rounded-xl ${JOIN}`,
};
export const TOP_SPACING = 'my-12 md:my-16 box-border [&>:first-child]:mt-0 [&>:last-child]:mb-0';
/** Media never overflows its slot, even on a site without a CSS reset. */
export const MEDIA_FIT = '[&_img]:max-w-full [&_img]:h-auto [&_video]:max-w-full [&_video]:h-auto';

export const ALL_SHARED_CLASS_STRINGS: string[] = [
  ROW_BASE, ...Object.values(ROW_RATIO), ...Object.values(TOP_WIDTH),
  EDGE_INSET, READING_COLORED, COLUMN_NESTED, COLUMN_TEXT_CAP, COLORED, ...Object.values(COLORED_PAD), COLORED_TEXT, TOP_SPACING, MEDIA_FIT, ...Object.values(COLORED_ROUND),
];
