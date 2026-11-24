/**
 * Multi-selection style editing — merge in, diff out, per Tailwind property group
 * (design ledger docs/plans/2026-11-16-multi-select-edit-design.md §2, D1–D3):
 *  - merge: a group every member shares is shown; any difference ("some have none" too) is mixed;
 *  - diff: the groups a block's output changed against what it was shown;
 *  - apply: each member keeps its own tokens except the changed (or owned) ones.
 * A Map per group keeps a group's last token: a slot's second token of one group (ring-2 ring-blue-500) stays
 * unchanged unless that group itself is edited.
 */
import { getPropertyGroup } from './properties';
import { getEffectiveClasses, computeSlotContent } from './cascade';
import { parseClasses, serializeClasses, cloneStorage } from './parser';
import type { Breakpoint, Theme, State } from './types';

export interface MergedTokens { tokens: string[]; mixedGroups: ReadonlySet<string> }
export interface ClassSlot { breakpoint: Breakpoint; theme: Theme; state: State }

const byGroup = (tokens: readonly string[]) => new Map(tokens.map(t => [getPropertyGroup(t), t] as const));

export function mergeMemberTokens(members: readonly (readonly string[])[]): MergedTokens {
  const maps = members.map(byGroup);
  const tokens: string[] = [];
  const mixedGroups = new Set<string>();
  for (const group of new Set(maps.flatMap(m => [...m.keys()]))) {
    const first = maps[0].get(group);
    if (maps.every(m => m.get(group) === first)) { if (first !== undefined) tokens.push(first); }
    else mixedGroups.add(group);
  }
  return { tokens, mixedGroups };
}

export function changedGroups(shown: readonly string[], after: readonly string[]): Set<string> {
  const b = byGroup(shown), a = byGroup(after);
  const out = new Set<string>();
  for (const group of new Set([...b.keys(), ...a.keys()])) if (b.get(group) !== a.get(group)) out.add(group);
  return out;
}

export function applyGroupEdit(member: readonly string[], after: readonly string[], groups: ReadonlySet<string>): string[] {
  return [
    ...member.filter(t => !groups.has(getPropertyGroup(t))),
    ...after.filter(t => groups.has(getPropertyGroup(t))),
  ];
}

/** Exactly the tokens a write owns change; the member keeps everything else (design §2, D1, D6). */
export function applyOwnedEdit(member: readonly string[], after: readonly string[], owns: (token: string) => boolean): string[] {
  return [...member.filter(t => !owns(t)), ...after.filter(owns)];
}

/** One member's class string after `transform` runs on its effective tokens at `slot`;
 *  null when nothing changes. Cascade-aware exactly like a single-element edit. */
export function editMemberAtSlot(classes: string, slot: ClassSlot, transform: (effective: string[]) => string[]): string | null {
  const { breakpoint, theme, state } = slot;
  const storage = parseClasses(classes);
  const next = cloneStorage(storage);
  next[breakpoint][theme][state] = computeSlotContent(storage, breakpoint, theme, state,
    transform(getEffectiveClasses(storage, breakpoint, theme, state)));
  const out = serializeClasses(next);
  return out === serializeClasses(storage) ? null : out;
}
