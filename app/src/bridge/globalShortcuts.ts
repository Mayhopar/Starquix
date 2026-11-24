/**
 * THE list of single-key (no-modifier) editor shortcuts.
 *
 * Why it lives in `bridge/`: whenever keyboard focus sits inside the preview
 * iframe, the parent's own `document` keydown listener NEVER fires — a
 * cross-origin iframe keeps its keystrokes. The only way a shortcut survives is
 * the bridge forwarding it as a `KEYBOARD_EVENT` postMessage, which the parent
 * re-dispatches (viewportMessages/textEditing.ts → handleKeyboardEvent).
 *
 * Modifier combos (⌘K, ⌘Z, ⌘S, …) and the control keys (Escape/Enter/Tab/
 * Backspace/Delete) are forwarded by rule in `parts/events.ts`. Bare letters and
 * digits are NOT — they'd be indistinguishable from a user typing on the real
 * page — so they need an explicit allowlist, and that allowlist has to stay in
 * lockstep with what `hooks/useKeyboardShortcuts.ts` actually acts on. Confirmed
 * live (2026-08-02, local mode): with the iframe focused, `r` and `2` reached
 * NOTHING — no parent keydown, no KEYBOARD_EVENT — because they were missing
 * from the bridge's hardcoded `['v','a','t']`.
 *
 * So: this module is the ONE source. The hook reads it to dispatch; the bridge
 * part interpolates it to decide what to forward. Adding a bare-key shortcut
 * means adding it HERE — never in one of the two consumers alone.
 *
 * CONSTRAINT: parts/events.ts imports this, and scripts/build-bridge.mjs loads
 * that chain in PLAIN NODE (type-stripping only, no alias resolution). Keep
 * every import here type-only, and keep the module dependency-free.
 */
import type { DrawTool } from '@/context/ToolContext';

/** Bare letter → tool armed, keyed by shortcutKey (any case, any layout). */
export const TOOL_SHORTCUTS: Record<string, DrawTool> = {
  v: 'select',
  a: 'frame',
  t: 'text',
  s: 'slot',
  b: 'blog',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  p: 'pen',
};

/** Breakpoint keys 1–6 → xs…2xl (order matches BreakpointBar). */
export const BREAKPOINT_SHORTCUT_KEYS = ['1', '2', '3', '4', '5', '6'];

/**
 * Every bare key (its shortcutKey) the parent acts on with no modifier. The bridge
 * forwards exactly this set; `globalShortcutParity` asserts the parent really
 * handles each one, so neither side can drift.
 */
export const BARE_SHORTCUT_KEYS: string[] = [
  ...Object.keys(TOOL_SHORTCUTS),
  ...BREAKPOINT_SHORTCUT_KEYS,
];

/**
 * The one SHIFTED bare shortcut: Shift+1 = zoom to fit. Matched on `code`
 * (not `key`) because shifted Digit1 produces '!'.
 */
export const SHIFTED_SHORTCUT_CODE = 'Digit1';

/**
 * Every key (its shortcutKey) the editor acts on with ⌘/Ctrl held: save, the
 * ⌘K picker, ⌃G grid, undo/redo, ⌘J, the element clipboard and zoom. The
 * bridge preventDefaults exactly these in the frame; any other combo (⌘W, ⌘Q,
 * ⌘M, ⌘H, ⌘,) is left to the app menu. `globalShortcutParity` asserts the
 * parent handles each.
 */
export const COMBO_SHORTCUT_KEYS: string[] = ['s', 'k', 'g', 'z', 'y', 'j', 'c', 'x', 'v', 'd', '0', '=', '+', '-', '_'];
