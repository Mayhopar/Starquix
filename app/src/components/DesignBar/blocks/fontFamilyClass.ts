import { getPropertyGroup } from '@/core/classes/properties';

export const SYSTEM_FONT_VALUES = ['sans', 'serif', 'mono'] as const;

export function isSystemFontValue(value: string): boolean {
  return (SYSTEM_FONT_VALUES as readonly string[]).includes(value);
}

const SYSTEM_RE = new RegExp(`^font-(${SYSTEM_FONT_VALUES.join('|')})$`);
// Extracts the NAME from a family token, quoted or not — for a stack
// (font-["KTF_Rublena","Arial"]) the first family, the one that renders. Membership
// in the fontFamily slot is the registry's call (getPropertyGroup), not this regex's:
// font-[family-name:var(--x)] is in the slot but has no name to show.
const FAMILY_NAME_RE = /^font-\[["']?([^\]"',:]+)["']?(?:,[^\]]*)?\]$/;

export function familyToClass(family: string): string {
  return `font-["${family.replace(/ /g, '_')}"]`;
}

export function classesToFamily(classes: string):
  | { kind: 'system' | 'family'; value: string }
  | null {
  for (const token of classes.split(/\s+/)) {
    if (getPropertyGroup(token) !== 'standalone:fontFamily') continue;
    const sys = token.match(SYSTEM_RE);
    if (sys) return { kind: 'system', value: sys[1] };
    const arb = token.match(FAMILY_NAME_RE);
    if (arb) return { kind: 'family', value: arb[1].replace(/_/g, ' ') };
  }
  return null;
}

export function stripFontFamilyClasses(classes: string): string {
  return classes.split(/\s+/)
    .filter(t => t && getPropertyGroup(t) !== 'standalone:fontFamily')
    .join(' ');
}
