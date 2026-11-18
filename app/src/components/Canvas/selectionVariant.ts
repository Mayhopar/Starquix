/**
 * Selection outline color variant for a selected key.
 *
 * Rendered instance DOM never carries the bare Yjs id — addKeysToMarkup keys
 * every tag as `${elementId}:tag-N` — so a selected key that misses the
 * elements map is classified by its OWNING entry. Only real component markers
 * (isComponentYjsEntry) get the cyan component accent; plain created sections
 * (add_page_content: type 'frame' + staticMarkup, no componentType) select
 * blue like any regular element.
 */
import type * as Y from 'yjs';
import { parseKey } from '@/store/types';
import { isComponentYjsEntry } from '@/store/masterEntity';
import type { SelectionVariant } from './SelectionOverlay';

export function selectionVariantForKey(
  doc: Y.Doc,
  selectedKey: string | null,
): SelectionVariant {
  if (!selectedKey) return 'normal';
  const elements = doc.getMap('elements');
  const yEl = elements.get(selectedKey) as Y.Map<unknown> | undefined;
  if (!yEl) {
    const parsed = parseKey(selectedKey);
    const owner =
      parsed?.type === 'instance-child'
        ? (elements.get(parsed.instanceId) as Y.Map<unknown> | undefined)
        : undefined;
    // Unknown owner keeps the old cyan fallback (component internals).
    return !owner || isComponentYjsEntry(owner) ? 'component' : 'normal';
  }
  const slotType = yEl.get('slotType') as string | undefined;
  if (slotType === 'blog') return 'blog';
  if (slotType) return 'slot';
  const type = yEl.get('type') as string | undefined;
  if (type === 'component' || type === 'instance') return 'component';
  return 'normal';
}

/** The canvas selection colour of an element: a `<slot>` tag paints as a slot (no Yjs entry), anything
 *  else by its key (selectionVariantForKey). ONE rule for the primary's overlay and every
 *  multi-selection outline (owner 2026-11-17: a member never wears a colour its own selection lacks). */
export function selectionVariantOf(keyVariant: SelectionVariant, tagName: string | undefined): SelectionVariant {
  return tagName === 'slot' ? 'slot' : keyVariant;
}
