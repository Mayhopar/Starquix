/**
 * FROZEN copy of the sq-post-layout-v1 class literals (articleTokens.ts at
 * 1e14c6c1). Never edit: upgradePostLayout() finds these exact strings in an
 * untouched v1 PostLayout.astro and swaps in the current ones.
 */
/** v1 HEADER.coverWide — the only header literal the upgrade swaps. */
export const V1_COVER_WIDE = 'block mt-8 sm:mt-10 aspect-[16/9] object-cover rounded-lg relative left-1/2 -translate-x-1/2 w-[min(64rem,calc(100vw-2.5rem))] max-w-none';
export const V1_BODY = [
  'text-[1.125rem] md:text-[1.25rem] leading-[1.6] [overflow-wrap:break-word] pb-16',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
  '[&_p]:my-[1.4em]',
  '[&_h2]:text-[1.75rem] md:[&_h2]:text-[2rem] [&_h2]:leading-[1.2] [&_h2]:font-bold [&_h2]:tracking-[-0.015em] [&_h2]:mt-[1.8em] [&_h2]:mb-[0.4em]',
  '[&_h3]:text-[1.375rem] md:[&_h3]:text-[1.5rem] [&_h3]:leading-[1.3] [&_h3]:font-bold [&_h3]:mt-[1.6em] [&_h3]:mb-[0.3em]',
  '[&_h4]:text-[1.125rem] md:[&_h4]:text-[1.25rem] [&_h4]:font-bold [&_h4]:mt-[1.4em] [&_h4]:mb-[0.2em]',
  '[&_:is(ul,ol)]:my-[1.2em] [&_:is(ul,ol)]:pl-[1.5em] [&_ul]:list-disc [&_ol]:list-decimal [&_li]:my-[0.35em] [&_li]:pl-[0.2em] [&_li>:is(ul,ol)]:my-[0.2em] [&_li>p]:my-0',
  '[&_blockquote]:my-[1.6em] [&_blockquote]:mx-0 [&_blockquote]:[border-left:3px_solid_color-mix(in_srgb,currentColor_20%,transparent)] [&_blockquote]:pl-[1.2em] [&_blockquote]:text-[1.1em] [&_blockquote]:italic [&_blockquote>p]:my-[0.6em]',
  '[&_a]:text-inherit [&_a]:underline [&_a]:underline-offset-[3px] [&_a]:decoration-[1px] [&_a]:decoration-[color:color-mix(in_srgb,currentColor_40%,transparent)] hover:[&_a]:decoration-current',
  '[&_strong]:font-semibold',
  '[&_:not(pre)>code]:text-[0.9em] [&_:not(pre)>code]:px-[0.3em] [&_:not(pre)>code]:py-[0.1em] [&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-[color-mix(in_srgb,currentColor_8%,transparent)]',
  '[&_pre]:my-[1.6em] [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:text-[0.85em] [&_pre]:leading-[1.55] [&_pre]:max-w-full [&_pre]:bg-[color-mix(in_srgb,currentColor_6%,transparent)]',
  '[&_[data-sq-unit=media]]:my-[1.6em]',
  '[&_:is(img,video)]:max-w-full [&_:is(img,video)]:h-auto [&_img]:rounded-md',
  '[&_figure]:my-[2em] [&_figcaption]:mt-3 [&_figcaption]:text-[0.875rem] [&_figcaption]:opacity-60 [&_figcaption]:text-center',
  "[&_hr]:my-[2.5em] [&_hr]:border-0 [&_hr]:h-auto [&_hr]:text-center [&_hr]:before:content-['•_•_•'] [&_hr]:before:tracking-[0.6em] [&_hr]:before:opacity-60",
  '[&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_table]:text-[0.9em] [&_:is(th,td)]:[border-bottom:1px_solid_color-mix(in_srgb,currentColor_15%,transparent)] [&_:is(th,td)]:px-3 [&_:is(th,td)]:py-2 [&_th]:text-left',
  'print:[&_[data-sq-stack]]:!bg-transparent',
].join(' ');

/** v1's subtitle pick line in the frontmatter script. */
export const V1_SUBTITLE_PICK = "pick('description', 'subtitle', 'excerpt')";
