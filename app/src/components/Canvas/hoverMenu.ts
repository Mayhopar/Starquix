import { useCallback, useEffect } from 'react';

// Coordinates the top-bar dropdowns (breakpoint / height / theme / zoom / grid):
// only one may be open — claiming closes the previously-open one instantly,
// so hovering across buttons never stacks overlapping menus.
let current: (() => void) | null = null;

export function claimHoverMenu(close: () => void): void {
  if (current && current !== close) current();
  current = close;
}

export function releaseHoverMenu(close: () => void): void {
  if (current === close) current = null;
}

/** A top-bar menu's `close`, joined to that rule: opening claims, closing or unmounting releases. */
export function useExclusiveMenu(open: boolean, setOpen: (open: boolean) => void): () => void {
  const close = useCallback(() => setOpen(false), [setOpen]);
  useEffect(() => {
    if (open) claimHoverMenu(close);
    else releaseHoverMenu(close);
    return () => releaseHoverMenu(close);
  }, [open, close]);
  return close;
}
