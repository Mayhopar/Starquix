/**
 * variantCell — the ONE classifier mapping a Tailwind class token to its
 * (breakpoint, theme, state) grid cell. Shared by HeaderTags (composite-pill
 * extraction) and DesignBar (exact-cell deletion) so detection and deletion agree.
 */
import { STATE_PREFIXES, THEME_PREFIXES, BREAKPOINT_PREFIXES } from '@/core/classes/constants';
import type { BreakpointName } from '@/context/BreakpointContext';
import type { Theme } from '@/core/classes/index';
import type { StateName } from '@/core/state/utils';

export interface Cell {
  bp: BreakpointName;   // 'xs' = base
  theme: Theme;         // 'light' = base
  state: StateName;     // 'default' = base
}

const BP = BREAKPOINT_PREFIXES as readonly string[];
const TH = THEME_PREFIXES as readonly string[];
const ST = STATE_PREFIXES as readonly string[];

/**
 * Decompose a token into its cell, or null if it's base (no variants) or can't be
 * represented in the 3-axis grid (unknown variant, or two of the same axis).
 * Leading variants are matched with /^((?:[\w-]+:)*)/ — the same pattern
 * deletePrefixClasses uses, so ':' inside arbitrary values (bg-[url(https://…)])
 * is never mistaken for a variant separator.
 */
export function classifyToken(token: string): Cell | null {
  const lead = token.match(/^((?:[\w-]+:)*)/)?.[1] ?? '';
  if (!lead) return null; // base token (no variants)
  const variants = lead.split(':').filter(Boolean);

  let bp: BreakpointName = 'xs';
  let theme: Theme = 'light';
  let state: StateName = 'default';
  let bpSet = false, themeSet = false, stateSet = false;

  for (const v of variants) {
    if (BP.includes(v)) { if (bpSet) return null; bp = v as BreakpointName; bpSet = true; }
    else if (TH.includes(v)) { if (themeSet) return null; theme = v as Theme; themeSet = true; }
    else if (ST.includes(v)) { if (stateSet) return null; state = v as StateName; stateSet = true; }
    else return null; // unknown variant — not representable in the grid
  }
  return { bp, theme, state };
}

/** Canonical label: breakpoint:theme:state, base parts omitted (Tailwind order). */
export function cellLabel(cell: Cell): string {
  const parts: string[] = [];
  if (cell.bp !== 'xs') parts.push(cell.bp);
  if (cell.theme !== 'light') parts.push(cell.theme);
  if (cell.state !== 'default') parts.push(cell.state);
  return parts.join(':');
}

/** Distinct non-base cells present in a class string, deduped by canonical label. */
export function extractCells(classes: string): Cell[] {
  const out: Cell[] = [];
  const seen = new Set<string>();
  for (const token of classes.split(/\s+/).filter(Boolean)) {
    const cell = classifyToken(token);
    if (!cell) continue;
    const label = cellLabel(cell);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(cell);
  }
  return out;
}

/** True when the token's cell exactly equals `cell` (for exact-cell deletion). */
export function tokenMatchesCell(token: string, cell: Cell): boolean {
  const c = classifyToken(token);
  return !!c && c.bp === cell.bp && c.theme === cell.theme && c.state === cell.state;
}
