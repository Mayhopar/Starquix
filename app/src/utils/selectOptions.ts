import type { ScannedElement } from '@/context/SelectionContext';

/** ScannedElement → select() options — ONE mapping for every selection path
 *  (Layers rows, keyboard nav, pending-select after a scan, master-root
 *  select), so canvas-vs-Layers classification can't drift when a payload
 *  field is added (task-143). */
export function selectOptionsFor(element: ScannedElement) {
  return {
    sourceLocation: element.sourceLocation,
    tagName: element.tagName,
    classes: element.classes,
    rect: element.rect as unknown as DOMRect,
    postSlug: element.postSlug,
    postLinkPaths: element.postLinkPaths,
    boundAssetPath: element.boundAssetPath,
    imageComponentIndex: element.imageComponentIndex,
    ownerComponentFile: element.ownerComponentFile,
    imageSrc: element.imageSrc,
    imageAlt: element.imageAlt,
  };
}
