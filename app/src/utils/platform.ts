// app/src/utils/platform.ts
/**
 * Platform detection utilities
 */

/**
 * Returns true if the current platform is macOS.
 * Uses navigator.platform for accurate detection.
 */
export function isMac(): boolean {
  return navigator.platform.toUpperCase().indexOf('MAC') >= 0;
}

/**
 * Returns the appropriate modifier key for the current platform.
 * On Mac: metaKey (Command), on Windows/Linux: ctrlKey
 */
export function getModifierKey(event: KeyboardEvent): boolean {
  return isMac() ? event.metaKey : event.ctrlKey;
}

/** A shortcut as this platform names it: '⌘⇧Z' on a Mac, 'Ctrl+Shift+Z' elsewhere (Windows). '⌃G' → 'Ctrl+G'. */
export function shortcutLabel(mac: string): string {
  return isMac() ? mac : mac.replace('⌘', 'Ctrl+').replace('⌃', 'Ctrl+').replace('⇧', 'Shift+').replace('⌥', 'Alt+');
}
