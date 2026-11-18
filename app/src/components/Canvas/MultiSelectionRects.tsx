// app/src/components/Canvas/MultiSelectionRects.tsx
import { memo } from 'react';
import { useSelectionContext, useElementGeometry, useScannedElements } from '@/context/SelectionContext';
import { useYjsValue } from '@/store/hooks';
import { VARIANT_BORDER } from './SelectionOverlay';
import { selectionVariantForKey, selectionVariantOf } from './selectionVariant';

interface Props {
  containerOffset: { x: number; y: number };
}

/**
 * Plain outline rects for EVERY member while ≥2 are selected — the primary too:
 * ViewportFrame suppresses its handle overlay then (design ledger B1–B3,
 * docs/plans/2026-11-16-multi-select-edit-design.md). No handles, no drag for
 * any member; group move stays in Layers. A lone primary keeps the full
 * SelectionOverlay (this renders nothing). Rects come
 * from the scan (same fidelity as Layers-driven selection rects) and may lag a
 * frame behind layout changes until the next rect update. Positioning matches
 * the neighboring overlays: rect + containerOffset, NO scale multiplication —
 * the canvas parent applies the CSS scale transform.
 */
export const MultiSelectionRects = memo(function MultiSelectionRects({ containerOffset }: Props) {
  const { selectedKey, additionalSelections } = useSelectionContext();
  const { scannedByKey } = useScannedElements();
  if (additionalSelections.length === 0) return null;
  const keys = [...(selectedKey ? [selectedKey] : []), ...additionalSelections.map(e => e.key)];
  return <>{keys.map(key => <AdditionalSelectionRect key={key} elementKey={key} tagName={scannedByKey.get(key)?.tagName} containerOffset={containerOffset} />)}</>;
});

function AdditionalSelectionRect({ elementKey, tagName, containerOffset }: Props & { elementKey: string; tagName?: string }) {
  const r = useElementGeometry(elementKey);
  // The colour this element's own selection wears (purple for components/source elements, cyan for slots…).
  const variant = selectionVariantOf(useYjsValue(doc => selectionVariantForKey(doc, elementKey)), tagName);
  if (!r) return null;
  return (
    <div
      data-testid="multi-select-rect"
      className={`absolute pointer-events-none border ${VARIANT_BORDER[variant]} z-[999]`} // ui-lint-line: overlay stacking order (matches SelectionOverlay hover rect)
      style={{ top: containerOffset.y + r.top, left: containerOffset.x + r.left, width: r.width, height: r.height }}
    />
  );
}
