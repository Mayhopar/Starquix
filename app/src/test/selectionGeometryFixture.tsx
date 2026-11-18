import { useLayoutEffect, useState, type ReactNode } from 'react';
import { SelectionProvider, useScannedElements, useSelectionContext, type ScannedElement } from '@/context/SelectionContext';
export type GeometryFixtureApi = ReturnType<typeof useScannedElements>;
export function SelectionGeometryFixture({ children, elements, selectedKey = null, onReady }: {
  children: ReactNode; elements: ScannedElement[]; selectedKey?: string | null; onReady?: (api: GeometryFixtureApi) => void;
}) {
  return <SelectionProvider><Seed elements={elements} selectedKey={selectedKey} onReady={onReady}>{children}</Seed></SelectionProvider>;
}
function Seed({ elements, selectedKey, onReady, children }: Parameters<typeof SelectionGeometryFixture>[0]) {
  const [ready, setReady] = useState(false);
  const api = useScannedElements(); const { select } = useSelectionContext();
  onReady?.(api);
  useLayoutEffect(() => api.setScannedElements(elements), [api.setScannedElements, elements]);
  useLayoutEffect(() => select(selectedKey ?? null), [select, selectedKey]);
  useLayoutEffect(() => setReady(true), []);
  return ready ? children : null;
}
