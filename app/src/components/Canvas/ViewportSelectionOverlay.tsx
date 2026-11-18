import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { useRectHover, useRectActions, useElementGeometry, useElementGeometries, useScannedElements } from '@/context/SelectionContext';
import type { ElementRect } from '@/bridge';
import { SelectionOverlay } from './SelectionOverlay';
import { layoutSelectionRect } from './canvasFocus';

type Props = Omit<ComponentProps<typeof SelectionOverlay>, 'selectedRect'> & { suppressRect: boolean };
export function ViewportSelectionOverlay({ suppressRect, ...props }: Props) {
  const { selectedRect } = useRectHover();
  // A hidden/detached element measures 0×0 at the frame origin: no box, not a stray handle dot.
  const empty = !selectedRect || (selectedRect.width === 0 && selectedRect.height === 0);
  return <SelectionOverlay {...props} selectedRect={suppressRect || empty ? null : selectedRect} />;
}

/** The render callback runs below the iframe host's geometry subscription boundary. */
export function ElementGeometryOverlay({ elementKey, children }: { elementKey: string; children: (rect: ElementRect) => ReactNode }) {
  const rect = useElementGeometry(elementKey);
  return rect ? children(rect) : null;
}

/** Synthetic layout roots have no DOM rect; keep their union live below the host. */
export function LayoutSelectionGeometry({ layoutRootKey }: { layoutRootKey: string }) {
  const { scannedElements } = useScannedElements();
  const rects = useElementGeometries(scannedElements.map(el => el.key));
  const { updateSelectionRect } = useRectActions();
  useEffect(() => {
    updateSelectionRect(layoutSelectionRect(scannedElements.flatMap((el, index) => rects[index] ? [{ ...el, rect: rects[index]! }] : []), layoutRootKey));
  }, [scannedElements, rects, layoutRootKey, updateSelectionRect]);
  return null;
}
