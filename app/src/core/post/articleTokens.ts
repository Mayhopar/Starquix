/**
 * The post article look (design docs/plans/2026-09-28-post-article-look-design.md).
 * ONE source for the PostLayout class literals (written into the user's
 * project — Tailwind scans literals, never build these dynamically) and the
 * editor's matching CSS numbers (PostBodyEditor.css reads the same scale;
 * articleTokens.parity.test.ts guards both).
 *
 * Colors are currentColor + opacity only, so a site's own theme (dark mode
 * included) carries through. No font-family anywhere (A2: site fonts).
 */

/**
 * ALIGNMENT LINES (owner 2026-09-30: "all the spacing must be calculated and
 * must lead to alignment of everything"). Every block's CONTENT edge lands on
 * one of three lines, all derived from these numbers:
 *   text = the reading measure: the 680px column minus one gutter each side
 *          (632px at ≥640px viewports, viewport − 2·gutter below)
 *   wide = 64rem, never closer than one gutter to the viewport edge
 *   full = the viewport — bleeds only (hero cover, uncolored edge media, band backgrounds)
 * gutter = 1.25rem (<640px) / 1.5rem (≥640px). A colored band's BACKGROUND
 * reaches one gutter past its content, so the text inside a band stays on the
 * text line. Stack.astro / stackClasses.ts carry the same numbers.
 */
export const LINES = { columnPx: 680, measureRem: 39.5, wideRem: 64, gutterRem: [1.25, 1.5] } as const;

/** The reading column: a 680px box, the gutter inside it → the text line. */
export const COLUMN = 'mx-auto w-full max-w-[680px] px-5 sm:px-6 box-border';

/** Header blocks. */
export const HEADER = {
  base: 'pt-10 sm:pt-16 pb-8 sm:pb-10',
  title: 'text-[2rem] sm:text-[2.75rem] leading-[1.12] font-bold tracking-[-0.02em] [overflow-wrap:anywhere] m-0',
  titleEmpty: 'opacity-40',
  subtitle: 'mt-3 text-[1.25rem] sm:text-[1.375rem] leading-[1.4] opacity-70 [overflow-wrap:anywhere] m-0',
  meta: 'mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.9375rem] leading-[1.4]',
  metaQuiet: 'opacity-60',
  avatar: 'h-10 w-10 rounded-full object-cover shrink-0',
  author: 'font-medium',
  /** a separator travels WITH its item, so a wrap never strands a lone dot */
  metaItem: 'inline-flex items-center gap-3 whitespace-nowrap',
  dot: 'opacity-40',
  centered: 'text-center [&_.sq-meta]:justify-center',
  /** cover at column width (centered header) */
  cover: 'block mt-8 sm:mt-10 w-full aspect-[16/9] object-cover rounded-lg',
  /** cover wider than the column (classic header) — breaks out, never past the viewport */
  coverWide: 'block mt-8 sm:mt-10 aspect-[16/9] object-cover rounded-lg relative left-1/2 -translate-x-1/2 w-[min(64rem,calc(100vw-2.5rem))] sm:w-[min(64rem,calc(100vw-3rem))] max-w-none',
  /** edge to edge whatever the site's body margin; never taller than most of the screen */
  coverHero: 'block relative left-1/2 -translate-x-1/2 w-screen max-w-none aspect-[16/9] sm:aspect-[21/9] max-h-[70vh] object-cover',
} as const;

/**
 * Body typography — descendant variants so text inside Stack slots follows
 * the same rhythm. 18px → 20px, line-height 1.6.
 *
 * SPACING = one margin-top per block, chosen by what comes before it; every
 * margin-bottom is 0. It never relies on margin collapse: the project's own
 * base CSS makes every div `flow-root` (cssGenerator SQ_BASE_CSS), and the
 * dev render wraps components in `div[data-sq-block]`, so collapse-based
 * spacing doubled (122px after a layout) and stranded headings (measured
 * 2026-09-30). A first child never has a "previous" → 0 automatically, which
 * also top-aligns the columns of a side-by-side layout.
 *
 * Priority is SPECIFICITY, never stylesheet order (Tailwind's order across
 * arbitrary variants depends on scan order). Each tier repeats `&` to outrank
 * the one before; the numbers in [] are the resulting (classes, elements):
 * Unit u = the body size (18px, 20px from md); px below are at 20px.
 *   T1 [1,1]  text → 1.4u (28) · block (quote/code/figure/table/media) → 1.6u (32)
 *   T2 [3,1]  after a block → 1.6u (32)
 *   T3 [5,1]  divider, both sides → 2.4u (48)
 *   T4 [6,1]  before a heading → h1/h2 2.8u (56) · h3 2u (40) · h4–h6 1.4u (28)
 *   T5 [7+]   layout (Stack), both sides → --sq-section: 3rem / 4rem from md (48 / 64)
 *   T6 [10,1] right after a heading → h1/h2 0.8u (16) · h3–h6 0.5u (10): a
 *             heading always sits closer to what it introduces than to what precedes it
 *   T7 [12+]  colored band right after a colored band → 0 (they join)
 *   T8 [14+]  the columns of a side-by-side layout → 0 (grid cells)
 */
export const SPACE = [
  '[&>:first-child]:mt-0',
  '[&_:where(p,ul,ol,blockquote,pre,figure,table,hr,h1,h2,h3,h4,h5,h6)]:my-0 [&_[data-sq-stack]]:mb-0 [&_[data-sq-block]>[data-sq-stack]]:my-0',
  // T1
  '[&_*+:is(p,ul,ol)]:mt-[calc(var(--sq-u)*1.4)] [&_*+:is(blockquote,pre,figure,table)]:mt-[calc(var(--sq-u)*1.6)] [&_*+[data-sq-unit=media]]:mt-[calc(var(--sq-u)*1.6)] [&_*+[data-sq-block]]:mt-[calc(var(--sq-u)*1.6)]',
  // T2
  '[&&&_:is(blockquote,pre,figure,table)+*]:mt-[calc(var(--sq-u)*1.6)] [&&&_[data-sq-unit=media]+*]:mt-[calc(var(--sq-u)*1.6)] [&&&_[data-sq-block]+*]:mt-[calc(var(--sq-u)*1.6)]',
  // T3
  '[&&&&&_*+hr]:mt-[calc(var(--sq-u)*2.4)] [&&&&&_hr+*]:mt-[calc(var(--sq-u)*2.4)]',
  // T4
  '[&&&&&&_*+:is(h1,h2)]:mt-[calc(var(--sq-u)*2.8)] [&&&&&&_*+h3]:mt-[calc(var(--sq-u)*2)] [&&&&&&_*+:is(h4,h5,h6)]:mt-[calc(var(--sq-u)*1.4)]',
  // T5 — build: the Stack is the sibling; dev: its data-sq-block wrapper is
  '[&&&&&&&_*+[data-sq-stack]]:mt-[var(--sq-section)] [&&&&&&&_[data-sq-stack]+*]:mt-[var(--sq-section)]',
  '[&&&&&&&_*+[data-sq-block]:has(>[data-sq-stack])]:mt-[var(--sq-section)] [&&&&&&&_[data-sq-block]:has(>[data-sq-stack])+*]:mt-[var(--sq-section)]',
  // T6
  '[&&&&&&&&&&_:is(h1,h2)+*]:mt-[calc(var(--sq-u)*0.8)] [&&&&&&&&&&_:is(h3,h4,h5,h6)+*]:mt-[calc(var(--sq-u)*0.5)]',
  // T7
  '[&&&&&&&&&&&&_[data-sq-colored]+[data-sq-colored]]:mt-0 [&&&&&&&&&&&&_[data-sq-block]:has(>[data-sq-colored])+[data-sq-block]:has(>[data-sq-colored])]:mt-0',
  // T8 — the columns of a side-by-side layout are grid cells, never spaced blocks (dev stamps them data-sq-block)
  '[&&&&&&&&&&&&&&_[data-sq-stack=row]>*]:mt-0',
].join(' ');

/**
 * Media width written as a col-span class (DesignBar, older posts) lands on the
 * same lines: 12 = wide, full = the viewport (top-level only; dev wraps the
 * component in div[data-sq-block]). Default col-span-8 = the text line.
 */
const LEGACY_SPAN = [
  '[&>.col-span-12]:relative [&>.col-span-12]:left-1/2 [&>.col-span-12]:-translate-x-1/2 [&>.col-span-12]:max-w-none [&>.col-span-12]:w-[min(64rem,calc(100vw-2.5rem))] sm:[&>.col-span-12]:w-[min(64rem,calc(100vw-3rem))]',
  '[&>[data-sq-block]>.col-span-12]:relative [&>[data-sq-block]>.col-span-12]:left-1/2 [&>[data-sq-block]>.col-span-12]:-translate-x-1/2 [&>[data-sq-block]>.col-span-12]:max-w-none [&>[data-sq-block]>.col-span-12]:w-[min(64rem,calc(100vw-2.5rem))] sm:[&>[data-sq-block]>.col-span-12]:w-[min(64rem,calc(100vw-3rem))]',
  '[&>.col-span-full]:relative [&>.col-span-full]:left-1/2 [&>.col-span-full]:-translate-x-1/2 [&>.col-span-full]:max-w-none [&>.col-span-full]:w-screen',
  '[&>[data-sq-block]>.col-span-full]:relative [&>[data-sq-block]>.col-span-full]:left-1/2 [&>[data-sq-block]>.col-span-full]:-translate-x-1/2 [&>[data-sq-block]>.col-span-full]:max-w-none [&>[data-sq-block]>.col-span-full]:w-screen',
].join(' ');

export const BODY = [
  'text-[1.125rem] md:text-[1.25rem] leading-[1.6] [overflow-wrap:break-word] pb-16',
  // SPACE's two units, set by the page (the editor pane sets them by its own width):
  // u = body text size (every gap is the same px whatever a block's own font size), section = layout gap
  '[--sq-u:1.125rem] md:[--sq-u:1.25rem] [--sq-section:3rem] md:[--sq-section:4rem]',
  SPACE,
  LEGACY_SPAN,
  '[&_:is(h1,h2)]:text-[1.75rem] md:[&_:is(h1,h2)]:text-[2rem] [&_:is(h1,h2)]:leading-[1.2] [&_:is(h1,h2)]:font-bold [&_:is(h1,h2)]:tracking-[-0.015em]',
  '[&_h3]:text-[1.375rem] md:[&_h3]:text-[1.5rem] [&_h3]:leading-[1.3] [&_h3]:font-bold',
  '[&_:is(h4,h5,h6)]:text-[1.125rem] md:[&_:is(h4,h5,h6)]:text-[1.25rem] [&_:is(h4,h5,h6)]:leading-[1.4] [&_:is(h4,h5,h6)]:font-bold',
  '[&_:is(ul,ol)]:pl-[1.5em] [&_ul]:list-disc [&_ol]:list-decimal [&_li]:my-[0.35em] [&_li]:pl-[0.2em] [&_li>:is(ul,ol)]:my-[0.2em] [&_li>p]:my-0',
  '[&_blockquote]:mx-0 [&_blockquote]:[border-left:3px_solid_color-mix(in_srgb,currentColor_20%,transparent)] [&_blockquote]:pl-[1.2em] [&_blockquote]:text-[1.1em] [&_blockquote]:italic [&_blockquote>p]:my-[0.6em]',
  '[&_a]:text-inherit [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:decoration-[1px] [&_a]:decoration-[color:color-mix(in_srgb,currentColor_40%,transparent)] hover:[&_a]:decoration-current',
  '[&_strong]:font-semibold',
  '[&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:px-[0.3em] [&_:not(pre)>code]:py-[0.1em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-[color-mix(in_srgb,currentColor_8%,transparent)]',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-[0.85em] [&_pre]:leading-[1.55] [&_pre]:max-w-full [&_pre]:bg-[color-mix(in_srgb,currentColor_6%,transparent)]',
  '[&_:is(img,video)]:max-w-full [&_:is(img,video)]:h-auto [&_img]:rounded-md',
  '[&_figcaption]:mt-3 [&_figcaption]:text-[0.875rem] [&_figcaption]:opacity-60 [&_figcaption]:text-center',
  "[&_hr]:border-0 [&_hr]:h-auto [&_hr]:text-center [&_hr]:before:content-['•_•_•'] [&_hr]:before:tracking-[0.6em] [&_hr]:before:opacity-60",
  '[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[0.9em] [&_:is(th,td)]:[border-bottom:1px_solid_color-mix(in_srgb,currentColor_15%,transparent)] [&_:is(th,td)]:px-3 [&_:is(th,td)]:py-2 [&_th]:text-left [&&_:is(th,td):first-child]:pl-0',
  'print:[&_[data-sq-stack]]:!bg-transparent',
].join(' ');

/** Editor mirror — numbers only (px / unitless), read by PostBodyEditor.css via CSS vars. */
export const EDITOR_SCALE = {
  measurePx: 680,
  bodyPx: 20,
  lineHeight: 1.6,
  h2Px: 32,
  h3Px: 24,
  titlePx: 44,
  subtitlePx: 22,
} as const;

export const ALL_ARTICLE_CLASS_STRINGS: string[] = [COLUMN, ...Object.values(HEADER), BODY];
