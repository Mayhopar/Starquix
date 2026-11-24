/** THE identity of a shortcut key (see shortcutKey.js): lowercase, the layout's Latin letter or digit, else the physical key. */
export function shortcutKey(e: { key: string; code: string; altKey?: boolean }): string;
