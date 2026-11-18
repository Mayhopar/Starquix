/**
 * Skeleton - the loading state's shapes. A list shows its loading state as ITS OWN rows with `<Row skeleton>` (the kit
 * draws every slot and text as these shapes, in the real geometry); use these directly only for shapes that aren't rows.
 *
 * - `Skeleton`: a pulsing placeholder, aria-hidden. Size AND radius come from `className` (w-*, h-*, rounded-full /
 *   rounded-inner) — no default radius, because cx's twMerge doesn't know our radius tokens and two would race.
 * - `SkeletonText`: real words as a bar — transparent text on a pulsing bar, so the bar is exactly as wide as the words
 *   will be (no guessed widths); centered in `line` (the text's line height).
 *
 * @example
 * <Skeleton className="w-4 h-4 rounded-full" />
 * <SkeletonText line="h-5">GitHub Pages</SkeletonText>
 */
import React from 'react';
import { cx } from './cx';

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return <span aria-hidden className={cx('block bg-stroke animate-pulse', className)} />;
}

export function SkeletonText({ children, line = 'h-5', bar = 'h-3' }: { children: React.ReactNode; line?: string; bar?: string }) {
  return (
    <span aria-hidden className={cx('flex items-center min-w-0', line)}>
      <span className={cx('max-w-full overflow-hidden whitespace-nowrap leading-none select-none rounded-inner bg-stroke animate-pulse',
        'text-transparent [&_*]:text-transparent', bar)}>{children}</span>
    </span>
  );
}

export default Skeleton;
