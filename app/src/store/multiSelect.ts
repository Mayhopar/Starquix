// Membership policy for the Phase-1 multi-selection extension set.
// Pure (no React, no Yjs) so the decisions are unit-testable without the
// iframe pipeline — same playbook as classifyKey / docRowSelected.
// Design: docs/archive/plans/2026-06-11-multi-select-design.md §3.
import { isUserSelectable } from './keyKind';
import { isLayoutChromeKey } from '@/utils/layoutChromeKeys';
import { parseKey } from './types';
import type { MultiSelectionEntry, ScannedElement } from '@/context/SelectionContext';

/** key -> scanned parentKey. `null` = root-level, `undefined` = not scanned. */
export type ParentKeyLookup = (key: string) => string | null | undefined;

/**
 * May `candidateKey` join a multi-selection anchored at `anchorKey`?
 * Any-layer membership (task-076): parent+child, cross-parent, multiple
 * components — all allowed. Only hard exclusions remain: user-selectable
 * (infra wrapper refused by keyKind), layout chrome, the anchor itself.
 */
export function canJoinMultiSelection(candidateKey: string, anchorKey: string): boolean {
  if (candidateKey === anchorKey) return false;
  if (!isUserSelectable(candidateKey)) return false;
  if (isLayoutChromeKey(candidateKey) || isLayoutChromeKey(anchorKey)) return false;
  return true;
}

/**
 * Inclusive range between anchor and clicked within the ordered list of
 * VISIBLE Layers rows (flattenVisibleKeys output — collapsed subtrees never
 * join). Null when either key is absent — caller falls back to a plain select.
 */
/**
 * Drop members whose scanned ancestor chain contains another member —
 * deleting/moving the ancestor already takes them along (task-076 §3).
 * Runs at ACTION time (delete/move), never at selection time.
 */
export function pruneDescendants(
  entries: MultiSelectionEntry[],
  getParentKey: ParentKeyLookup,
): MultiSelectionEntry[] {
  const memberKeys = new Set(entries.map((e) => e.key));
  return entries.filter((entry) => {
    let parent = getParentKey(entry.key);
    const seen = new Set<string>();
    while (parent != null && !seen.has(parent)) {
      if (memberKeys.has(parent)) return false;
      seen.add(parent);
      parent = getParentKey(parent);
    }
    return true;
  });
}

export function computeVisibleRange(
  anchorKey: string,
  clickedKey: string,
  visibleKeysInOrder: string[],
): string[] | null {
  const a = visibleKeysInOrder.indexOf(anchorKey);
  const b = visibleKeysInOrder.indexOf(clickedKey);
  if (a === -1 || b === -1) return null;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return visibleKeysInOrder.slice(lo, hi + 1);
}

export type ToggleDecision = 'select' | 'join' | 'leave' | 'drop-primary' | 'deselect' | 'none';

/**
 * Shift+click (canvas) / ⌘-click (Layers) on `clickedKey` — ONE rule for both.
 * Pure; SelectionContext.toggleInSelection executes it. 'select' and 'none'
 * are left to the caller (plain select / no-op).
 * Ledger §1: docs/plans/2026-11-16-multi-select-edit-design.md
 */
export function decideToggle(input: {
  clickedKey: string;
  primaryKey: string | null;
  extraKeys: readonly string[];
  isLocked: (key: string) => boolean;
}): ToggleDecision {
  const { clickedKey, primaryKey, extraKeys, isLocked } = input;
  if (!primaryKey) return 'select';
  if (extraKeys.includes(clickedKey)) return 'leave';
  if (clickedKey === primaryKey) return extraKeys.length > 0 ? 'drop-primary' : 'deselect';
  if (!isUserSelectable(primaryKey) || isLayoutChromeKey(primaryKey) || isLocked(primaryKey)) return 'select';
  return canJoinMultiSelection(clickedKey, primaryKey) && !isLocked(clickedKey) ? 'join' : 'none';
}

/**
 * Selection keys that vanished between two scans because an EARLIER element on the
 * same source line changed length (a class save shifts the columns after it): same
 * file + line + placement, same tag, same count of that tag on the line → the
 * element at the same position. Anything else is not a shift — left alone.
 * Runs only while ≥2 are selected (design ledger E7). Known limit: a same-tag
 * reorder WITHIN one line relinks to the neighbour; line shifts are not followed.
 */
export function relinkSameLine(
  keys: readonly string[],
  prev: readonly ScannedElement[],
  next: readonly ScannedElement[],
): Map<string, string> {
  const slot = (el: ScannedElement) => {
    const p = parseKey(el.key);
    return p?.type === 'source' ? { group: `${p.file}:${p.line}~${p.placement ?? ''}|${el.tagName}`, col: p.col } : null;
  };
  const lines = (els: readonly ScannedElement[]) => {
    const m = new Map<string, { key: string; col: number }[]>();
    for (const el of els) {
      const s = slot(el);
      if (!s) continue;
      const list = m.get(s.group) ?? [];
      list.push({ key: el.key, col: s.col });
      m.set(s.group, list);
    }
    for (const list of m.values()) list.sort((a, b) => a.col - b.col);
    return m;
  };
  const nextKeys = new Set(next.map(e => e.key));
  const taken = new Set(keys.filter(k => nextKeys.has(k)));
  const before = lines(prev), after = lines(next);
  const out = new Map<string, string>();
  for (const key of keys) {
    if (nextKeys.has(key)) continue;
    const el = prev.find(e => e.key === key);
    const s = el && slot(el);
    if (!s) continue;
    const was = before.get(s.group)!, now = after.get(s.group);
    if (!now || now.length !== was.length) continue;
    const target = now[was.findIndex(x => x.key === key)]?.key;
    if (!target || taken.has(target)) continue;
    taken.add(target);
    out.set(key, target);
  }
  return out;
}
