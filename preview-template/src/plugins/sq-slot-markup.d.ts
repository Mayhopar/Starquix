// Type surface for sq-slot-markup.js (THE <slot> grammar).
export const SLOT_TAG_RE: RegExp;
export const SLOT_NAME_ATTR_RE: RegExp;
export function slotParts(attrsSelf?: string, attrsOpen?: string): { attrs: string; name: string };
