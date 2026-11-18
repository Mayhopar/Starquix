// One classifier for the overloaded selection key — Phase 1 of
// docs/archive/plans/2026-06-10-selection-key-architecture-memo.md.
//
// A `selectedKey`/`contextKey`/scanned key encodes five entity kinds in one
// string (see the memo's §3.3 cheat sheet). `classifyKey` is the single place
// that answers "what kind of thing is this key?"; consumers must use it (or the
// predicates below) instead of re-deriving the kind with ad-hoc string checks.
//
// Related, deliberately separate predicates:
// - `utils/slotDetection.ts` `isSlotSelection` — slot-ness is a SCAN-derived
//   attribute (tagName/slotName/elementType), not a key shape.
// - `utils/layoutChromeKeys.ts` `isLayoutChromeKey` — matches the whole
//   layout-chrome NAMESPACE (root or child), unlike the root-only
//   `layout-chrome` kind here.
import { parseKey } from './types';
import type { ScannedElement } from '@/context/SelectionContext';

/** Substring identifying the `#sq-components` injection wrapper in
 *  `src/pages/preview/[projectId]/[pageId].astro`. */
const PAGE_WRAPPER_MARKER = '[pageId].astro';

/** Key prefix of the derived layout-chrome element (store/layoutElement.ts
 *  `pageLayoutElementId`). */
const LAYOUT_CHROME_PREFIX = 'layoutchrome-';

export type KeyKind =
  | { kind: 'source'; file: string; line: number; col: number }
  | { kind: 'wrapper' } // #sq-components / [pageId].astro — infra, never user content
  | { kind: 'layout-chrome'; pageId: string } // layoutchrome-<pageId> root (editor-only)
  | { kind: 'instance-root'; instanceId: string } // el-… / drawn-… / layoutchrome-… root is NOT this
  | { kind: 'instance-child'; instanceId: string; selector: string };

export function classifyKey(key: string | null | undefined): KeyKind | null {
  if (!key) return null;

  // The wrapper is also source-shaped (file:line:col) — must win over 'source'.
  if (key.includes(PAGE_WRAPPER_MARKER)) return { kind: 'wrapper' };

  // Bare layout-chrome root. A child (`layoutchrome-x:slot-0`) falls through to
  // parseKey, which classifies it as a normal instance-child of the chrome root.
  if (key.startsWith(LAYOUT_CHROME_PREFIX) && !key.includes(':')) {
    return { kind: 'layout-chrome', pageId: key.slice(LAYOUT_CHROME_PREFIX.length) };
  }

  const parsed = parseKey(key);
  if (!parsed) return null;
  switch (parsed.type) {
    case 'source':
      return { kind: 'source', file: parsed.file, line: parsed.line, col: parsed.col };
    case 'instance-root':
      return { kind: 'instance-root', instanceId: parsed.instanceId };
    case 'instance-child':
      return {
        kind: 'instance-child',
        instanceId: parsed.instanceId,
        selector: parsed.selector,
      };
  }
}

/** The `#sq-components` infrastructure wrapper key. */
export function isWrapperKey(key: string | null | undefined): boolean {
  return classifyKey(key)?.kind === 'wrapper';
}

/**
 * A component/theme INSTANCE container placed on a page (its key, root or
 * child). Instances are LOCKED — they can never parent a foreign drawn element;
 * a drawn drop over one lands at page top-level instead (task-069). Both theme
 * instances and local components carry `el-…` ids, so the instance-id prefix is
 * the lock signal. Distinguished from drawn containers (`drawn-…`, which CAN
 * parent), layout-chrome (`layoutchrome-…`, editor-only), and page-source
 * (`file:line:col`, which CAN parent). See task-069 ledger §model + scope update.
 */
export function isComponentInstanceContainerKey(key: string | null | undefined): boolean {
  const kind = classifyKey(key);
  if (kind?.kind !== 'instance-root' && kind?.kind !== 'instance-child') return false;
  return kind.instanceId.startsWith('el-');
}

/** Whether selecting this key is meaningful to the user. The wrapper is an
 *  injection target — entering its context is fine, SELECTING it never is. */
export function isUserSelectable(key: string | null | undefined): boolean {
  const kind = classifyKey(key);
  return kind !== null && kind.kind !== 'wrapper';
}

/**
 * An "instance-child" key (e.g. `<heroId>:section-0`) can identify either:
 * - the instance's ROOT tag — when its DOM parent lives outside the instance's
 *   key namespace, or
 * - an actual inner descendant — when its DOM parent is another tag of the
 *   same instance.
 *
 * Backspace on the root must remove the whole Yjs element so the enclosing
 * container (layout slot, page root) reverts to "empty"; Backspace on an
 * inner descendant adds a deletion override that hides just that tag.
 *
 * A MULTI-ROOT instance (e.g. a layout chrome whose top level is <header>,
 * <main>, <footer> side by side) is the exception: each top-level tag's DOM
 * parent is the page source, so naively every one of them looks like "the
 * root". Deleting one must hide just that tag, NOT nuke the whole layout. So a
 * top-level tag counts as the root ONLY when it is the SOLE top-level tag of
 * the instance.
 */
export function isInstanceRootKey(
  key: string,
  instanceId: string,
  scannedElements: ScannedElement[],
): boolean {
  const scanned = scannedElements.find((el) => el.key === key);
  if (!scanned?.parentKey) return !!scanned;

  // Is `el` a top-level tag of THIS instance (its DOM parent is outside the
  // instance's key namespace — page source, no parent, or another instance)?
  const isTopLevelOfInstance = (el: ScannedElement): boolean => {
    const p = parseKey(el.key);
    if (!p || p.type === 'source' || p.instanceId !== instanceId) return false;
    if (!el.parentKey) return true;
    const pp = parseKey(el.parentKey);
    return !pp || pp.type === 'source' || pp.instanceId !== instanceId;
  };

  // The selected tag itself must be top-level to even be a root candidate;
  // an inner descendant is always an individual delete.
  if (!isTopLevelOfInstance(scanned)) return false;

  // Sole top-level tag → it IS the instance root (remove the whole element).
  // Multiple top-level tags → delete each individually.
  return scannedElements.filter(isTopLevelOfInstance).length <= 1;
}
