import type { ScannedElement } from '@/context/SelectionContext';
import type { EditorCommand } from '@/store/types';
import { parseKey } from '@/store/types';
import { translateChildKeysToSourceSelectors } from './translateChildKeysToSourceSelectors';

/**
 * True when a parentKey would be valid for SET_CHILD_ORDER. The reducer
 * rejects 'source' keys structurally; call sites use this to skip the
 * persist-before-snapshot dispatch when the previous parent was an
 * infrastructure container (e.g. the [pageId].astro wrapper).
 */
export function isValidChildOrderParentKey(parentKey: string | null | undefined): parentKey is string {
  if (!parentKey) return false;
  return parseKey(parentKey)?.type !== 'source';
}

type DispatchFn = import('@/store/durableDispatch').EditorDispatch;

/**
 * Dispatch SET_CHILD_ORDER with `sourceSelectors` always populated. Centralizes
 * the rendered-tag → source-tag translation so a future caller can't forget
 * it and silently regress the BlogPost rearrange-persistence fix
 * (see `translateChildKeysToSourceSelectors` for the WHY).
 */
export function dispatchSetChildOrder(
  dispatch: DispatchFn,
  scannedElements: Pick<ScannedElement, 'key' | 'componentSrc'>[],
  pageId: string,
  parentKey: string,
  childKeys: string[],
): ReturnType<DispatchFn> {
  return dispatch({
    type: 'SET_CHILD_ORDER',
    pageId,
    parentKey,
    childKeys,
    sourceSelectors: translateChildKeysToSourceSelectors(childKeys, scannedElements),
  });
}

/**
 * The instance root every key is a child of, or null when they are not one
 * family. In a component/layout MASTER view the rows are instance-children of
 * the opened document (`el-<id>:slot-0`, `el-<id>:header-0`) whose scanned
 * parent is the preview shell — a `source` key that SET_CHILD_ORDER rejects.
 * The reorder then fell back to the doc's root list, which no writer mirrors to
 * the .astro, so the master's order reverted to file order on reopen ("I put
 * navigation on top, come back, it's at the bottom"). Reordering against the
 * host makes it an ordinary child-order write that reaches source.
 *
 * Page roots are instance ROOTS, not instance-children, so they return null
 * here and keep the doc-root path unchanged.
 */
export function sharedInstanceRoot(keys: string[]): string | null {
  if (keys.length === 0) return null;
  let host: string | null = null;
  for (const key of keys) {
    const parsed = parseKey(key);
    if (parsed?.type !== 'instance-child') return null;
    if (host === null) host = parsed.instanceId;
    else if (host !== parsed.instanceId) return null;
  }
  return host;
}
