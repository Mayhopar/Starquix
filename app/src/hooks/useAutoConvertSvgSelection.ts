/**
 * Selecting a static inline svg auto-converts it into a pen shape, silently —
 * the svg's layout box can be far larger than its glyph (letterboxing), and
 * node editing only exists on penPath elements. Selection re-lands on the new
 * shape. Failures (multi-shape/arc svgs) are remembered so this never loops;
 * those keep DesignBar's manual Convert button + its explanatory toast.
 *
 * Mounted at the editor root (NOT in a panel): selection is an app-level
 * fact, so the conversion policy and its failure memory must not depend on a
 * panel's mount lifetime.
 */
import { useEffect, useRef, useState } from 'react';
import { useSelectionContext, useScannedElementsRef } from '@/context/SelectionContext';
import { useConvertSvgToShape } from '@/hooks/useConvertSvgToShape';

export function useAutoConvertSvgSelection(): void {
  const { selectedKey } = useSelectionContext();
  const { scannedByKeyRef } = useScannedElementsRef();
  const convertSvgToShape = useConvertSvgToShape();
  const unconvertibleKeysRef = useRef<Set<string>>(new Set());
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const key = selectedKey;
    if (!key || !/:svg-\d+$/.test(key)) return;
    if (unconvertibleKeysRef.current.has(key)) return;
    const rect = scannedByKeyRef.current.get(key)?.rect ?? null;
    // Reserve while acceptance is pending so rerenders cannot enqueue twice.
    unconvertibleKeysRef.current.add(key);
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void convertSvgToShape(key, rect, { silent: true }).catch(() => {
      unconvertibleKeysRef.current.delete(key);
      if (active) timer = setTimeout(() => setRetry(n => n + 1), Math.min(1000 * 2 ** retry, 30000));
    });
    return () => { active = false; clearTimeout(timer); };
  }, [selectedKey, convertSvgToShape, scannedByKeyRef, retry]);
}
