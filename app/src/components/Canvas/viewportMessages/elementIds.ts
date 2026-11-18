/**
 * Key→element-ID mapping helpers shared by the message handlers
 * (ELEMENTS_SCANNED, DRAG_ELEMENT_DROP) and ViewportFrame's render-side
 * order resolution. Moved verbatim from ViewportFrame.tsx.
 */
import { parseKey } from '@/store/types';
import { isWrapperKey } from '@/store/keyKind';

/** Check whether a scanned element sits at the page root level. The
 *  #sq-components wrapper itself also scans with parentKey null, but it is
 *  the root CONTAINER, not a root-level element — counting it here is how
 *  wrapper keys used to leak into the rootElementIds seed. */
export function isRootLevelElement(el: { key?: string; parentKey: string | null }): boolean {
  if (isWrapperKey(el.key)) return false;
  return el.parentKey === null || isWrapperKey(el.parentKey);
}

/**
 * Map a scanned-element key to its element ID.
 * In local mode, keys ARE element IDs. In browser/cloud mode, instance keys
 * (instance-root / instance-child) map to their instanceId.
 */
export function keyToElementId(key: string): string {
  const parsed = parseKey(key);
  if (parsed?.type === 'instance-root' || parsed?.type === 'instance-child') {
    return parsed.instanceId;
  }
  return key;
}

/**
 * Map an array of scanned-element keys to deduplicated element IDs.
 * Multiple instance-child keys can share the same instanceId; this keeps
 * only the first occurrence.
 */
export function deduplicateKeysToIds(keys: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    const id = keyToElementId(key);
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
