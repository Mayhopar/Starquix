/**
 * Style editing for ≥2 selected elements — design docs/plans/2026-11-16-multi-select-edit-design.md §2.
 * Merged view in; owned (or group-diffed) edits out; ONE setClassesMany batch per change (one save, one ⌘Z).
 * Reads each member like DesignBar reads the primary: store truth (draft ?? entry) ?? scan — so rapid
 * edits coalesce on the drafts exactly like the single path's pendingStorageRef (D5).
 */
import { useCallback, useMemo, useRef } from 'react';
import { useClassStore } from '@/context/ClassStoreContext';
import { useScannedElements } from '@/context/SelectionContext';
import {
  parseClasses, getEffectiveClasses, getPropertyGroup, mergeMemberTokens, changedGroups,
  applyGroupEdit, applyOwnedEdit, editMemberAtSlot, type ClassSlot,
} from '@/core/classes/index';
import { CLASS_PATTERNS, TEXT_ELEMENTS } from '../classPatterns';
import type { Owns } from './mixed';

export function useMultiStyleEdit(memberKeys: readonly string[], slot: ClassSlot) {
  const { getStoredClasses, setClassesMany } = useClassStore();
  const { scannedByKey } = useScannedElements();
  const { breakpoint, theme, state } = slot;
  // Live members only (C11). The primary's read rule (DesignBar fullClasses): store truth ?? scan.
  const live = useMemo(() => memberKeys.filter(k => scannedByKey.has(k)), [memberKeys, scannedByKey]);
  const read = useCallback((k: string) => getStoredClasses(k) ?? scannedByKey.get(k)?.classes ?? '',
    [getStoredClasses, scannedByKey]);
  const effective = live.map(k => getEffectiveClasses(parseClasses(read(k)), breakpoint, theme, state));
  const merged = mergeMemberTokens(effective);
  const shown = useRef(merged.tokens);
  shown.current = merged.tokens; // what the blocks were shown this render

  const applyToEach = useCallback((transform: (effective: string[]) => string[]) => {
    const edits = live.flatMap(key => {
      const classes = editMemberAtSlot(read(key), { breakpoint, theme, state }, transform);
      return classes === null ? [] : [{ key, classes }];
    });
    if (edits.length) void setClassesMany(edits);
  }, [live, read, breakpoint, theme, state, setClassesMany]);

  const handleClassesChange = useCallback((next: string, owns?: Owns) => {
    const after = next.split(/\s+/).filter(Boolean);
    if (owns) { applyToEach(e => applyOwnedEdit(e, after, owns)); return; }
    const groups = changedGroups(shown.current, after);
    if (groups.size) applyToEach(e => applyGroupEdit(e, after, groups));
  }, [applyToEach]);

  const removeMatching = useCallback((patterns: RegExp[]) => {
    applyToEach(e => e.filter(t => !patterns.some(p => p.test(t))));
  }, [applyToEach]);

  /** Section "+": the default joins every member lacking that property. */
  const addDefault = useCallback((classes: string) => {
    const add = classes.split(/\s+/).filter(Boolean);
    applyToEach(e => [...e, ...add.filter(t => !e.some(x => getPropertyGroup(x) === getPropertyGroup(t)))]);
  }, [applyToEach]);

  const memberClasses = effective.map(t => t.join(' '));
  return {
    count: live.length,
    currentClasses: merged.tokens.join(' '),
    /** Every member's tokens — Effects rows (C12). */
    unionClasses: [...new Set(effective.flat())].join(' '),
    memberClasses,
    allText: live.length > 0 && live.every(k => TEXT_ELEMENTS.has(scannedByKey.get(k)!.tagName)),
    hasFill: memberClasses.some(c => CLASS_PATTERNS.fill.test(c)),
    hasStroke: memberClasses.some(c => CLASS_PATTERNS.stroke.test(c)),
    hasEffects: live.some(k => CLASS_PATTERNS.effects.test(read(k))),
    handleClassesChange, removeMatching, addDefault, applyToEach,
    getCurrentClasses: () => shown.current.join(' '),
  };
}
