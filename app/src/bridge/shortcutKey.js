// Plain JS on purpose: bridge/parts/events.ts embeds this function's source text, and only an untranspiled file
// reads the same in Node (scripts/build-bridge.mjs) and in Vite/vitest (the bridge.js snapshot-parity test).
/**
 * THE identity of a shortcut key, for the editor (useKeyboardShortcuts) and the iframe relay alike. Lowercase:
 * - the layout's own Latin letter or digit when the key types one: AZERTY's ⌘Z is the key labelled Z (code KeyW);
 * - else the physical key: a Cyrillic/Greek letter is its KeyX, a symbol on the digit row (AZERTY '&') its DigitN.
 * Named keys (Enter, Escape…), other symbols and Alt/AltGr characters (Polish AltGr+Z types 'ż') come back as typed.
 */
export function shortcutKey(e) {
  var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (key.length !== 1 || /[a-z0-9]/.test(key) || e.altKey) return key;
  var digit = /^Digit(\d)$/.exec(e.code);
  if (digit) return digit[1];
  var letter = /^Key([A-Z])$/.exec(e.code);
  return letter && key.charCodeAt(0) > 127 ? letter[1].toLowerCase() : key;
}
