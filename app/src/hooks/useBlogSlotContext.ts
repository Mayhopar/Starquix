import { useYjsValue } from '@/store/hooks';
import { useSelectedElement, useScannedElementsRef } from '@/context/SelectionContext';
import { BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';
import { parseKey } from '@/store/types';
import type * as Y from 'yjs';

export function useBlogSlotContext(): { isInsideBlogSlot: boolean; blogSlotKey: string | null } {
  // Selection only (not useSelection()): subscribing to scannedElements made
  // DesignBar re-render on every scan just for a parentKey lookup. The parent
  // walk reads the scan through the never-changing ref context instead —
  // useYjsValue re-runs the selector on every doc update and value-compares
  // the result, so reading the ref inside it is safe.
  const { key: selectedKey } = useSelectedElement();
  const { scannedByKeyRef } = useScannedElementsRef();

  return useYjsValue((doc) => {
    if (!selectedKey) return { isInsideBlogSlot: false, blogSlotKey: null };

    const elements = doc.getMap('elements');

    // Match either legacy drawn slot (isDrawn + slotType='blog') or
    // post-task-028 instance (componentType='BlogSlot'). Mirrors the
    // discriminator in selectPageBlogCollectionIds.
    const isBlogSlotYEl = (yEl: Y.Map<unknown> | undefined): boolean => {
      if (!yEl) return false;
      const isDrawnBlog = !!yEl.get('isDrawn') && yEl.get('slotType') === 'blog';
      const isInstanceBlog = yEl.get('componentType') === BLOG_SLOT_COMPONENT_TYPE;
      return isDrawnBlog || isInstanceBlog;
    };

    // Walk the scanned parent chain. The chain holds instance-child keys
    // like 'el-slot:section-0' that don't exist in the Yjs elements map —
    // only the bare instance root 'el-slot' does. So at each step we test
    // both the literal key AND, when it's an instance-child, its owning
    // instance root.
    let currentKey: string | null = selectedKey;
    while (currentKey) {
      const direct = elements.get(currentKey) as Y.Map<unknown> | undefined;
      if (isBlogSlotYEl(direct)) {
        return { isInsideBlogSlot: true, blogSlotKey: currentKey };
      }
      const parsed = parseKey(currentKey);
      if (parsed?.type === 'instance-child') {
        const rootKey = parsed.instanceId;
        const rootEl = elements.get(rootKey) as Y.Map<unknown> | undefined;
        if (isBlogSlotYEl(rootEl)) {
          return { isInsideBlogSlot: true, blogSlotKey: rootKey };
        }
      }
      currentKey = scannedByKeyRef.current.get(currentKey)?.parentKey ?? null;
    }
    return { isInsideBlogSlot: false, blogSlotKey: null };
  });
}
