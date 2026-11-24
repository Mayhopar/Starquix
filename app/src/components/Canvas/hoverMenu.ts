import { useCallback, useEffect, useRef, useState } from 'react';

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

const HOVER_CLOSE_DELAY_MS = 150;

/**
 * A top-bar hover menu (breakpoint / height / theme / zoom): the pointer opens it, leaving chip and menu closes it after
 * a beat. A click opens it too and never toggles: the hover before every click has already opened it, so a toggle shut
 * the menu the user meant to open (finding #32). Escape, an outside click or a pick closes it.
 */
export function useHoverMenu() {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cancelClose = useCallback(() => clearTimeout(closeTimer.current), []);
  const show = useCallback(() => { cancelClose(); setOpen(true); }, [cancelClose]);
  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);
  const close = useExclusiveMenu(open, setOpen); // only one top-bar menu at a time (claiming closes the other one)
  return { open, show, close, scheduleClose, cancelClose };
}
