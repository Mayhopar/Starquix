/**
 * The `<slot>` grammar, in ONE place.
 *
 * Four call sites match slots in markup — the canvas composer and the
 * bake-a-slot-wrapper helper (app/src/store/selectors.ts), the layout inline
 * transform (sq-inline-layout.js), and the placeholder expander
 * (app/src/utils/componentPlaceholders.ts). They had drifting private copies of
 * the same two regexes plus the same four-line "read the slot's name" preamble.
 *
 * PLAIN JS and in the plugin dir on purpose: sq-inline-layout.js runs inside
 * the instance's `astro dev`, which gets only the plugin dir's `.js` files.
 * `app/src/utils/slotMarkup.ts` is a typed re-export of THIS file — never a second copy, or
 * the composer and the inline transform drift on the same grammar.
 *
 * Both regexes are `g`/`i` as needed. SLOT_TAG_RE carries `g`, so only use it
 * with `String.replace` — that resets `lastIndex`; `.test()` would not.
 */

/** `<slot …/>` or `<slot …>fallback</slot>`. Groups: self-attrs, open-attrs, inner. */
export const SLOT_TAG_RE = /<slot\b([^>]*)\/>|<slot\b([^>]*)>([\s\S]*?)<\/slot>/gi;

/** `name="x"` or `name='x'` inside a slot's attribute run. */
export const SLOT_NAME_ATTR_RE = /\bname\s*=\s*"([^"]*)"|\bname\s*=\s*'([^']*)'/i;

/**
 * A slot's attribute run with the self-closing `/` stripped, plus its `name`
 * ('' for the default slot) — the preamble every SLOT_TAG_RE replacer ran by
 * hand. `trimEnd` matters: `<slot class="x" />` would otherwise yield
 * `class="x" ` and re-emit as `<div class="x" >`.
 */
export function slotParts(attrsSelf, attrsOpen) {
  const attrs = (attrsSelf ?? attrsOpen ?? '').replace(/\/\s*$/, '').trimEnd();
  const m = attrs.match(SLOT_NAME_ATTR_RE);
  return { attrs, name: (m?.[1] ?? m?.[2] ?? '').trim() };
}
