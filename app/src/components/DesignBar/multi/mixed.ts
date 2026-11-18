/**
 * "Mixed" + "owns" — the two contracts every Design Bar control honours while ≥2
 * elements are selected (design §2, C6, D6: docs/plans/2026-11-16-multi-select-edit-design.md).
 */
import { useMemo } from 'react';
import { getPropertyGroup } from '@/core/classes/index';
import { useDesignBarContext } from '../DesignBarContext';

/** What a write owns: while ≥2 are selected, exactly these tokens change on every member (design §2). */
export type Owns = (token: string) => boolean;

/** Tokens of the named Tailwind property groups (core/classes getPropertyGroup). */
export const ownsGroups = (...groups: string[]): Owns => token => groups.includes(getPropertyGroup(token));

/** Each member's effective classes while ≥2 are selected; null for a single selection. */
export function useMultiMembers(): readonly string[] | null {
  return useDesignBarContext()?.multi?.memberClasses ?? null;
}

/** True when the control's OWN reader gives different values across members (design C6). */
export function useMixedValue<T>(read: (classes: string) => T): boolean {
  const members = useMultiMembers();
  return useMemo(() => {
    if (!members || members.length < 2) return false;
    const first = JSON.stringify(read(members[0]));
    return members.some(classes => JSON.stringify(read(classes)) !== first);
  }, [members, read]);
}
