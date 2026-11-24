import { useEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Menu, MenuItem } from '@/components/ui';
import { useSelectionContext } from '@/context/SelectionContext';
import { useWrapSelection } from '@/hooks/useWrapSelection';
import { isMac } from '@/utils/platform';
import { layerMenu } from './layerMenuStore';

/** The right-click menu of the selected layers (canvas and Layers). Mounted once in Editor. */
export function LayerContextMenu() {
  const point = useSyncExternalStore(layerMenu.subscribe, layerMenu.get);
  const { selectedKey } = useSelectionContext();
  const wrapSelection = useWrapSelection();
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => { if (point && !selectedKey) layerMenu.open(null); }, [point, selectedKey]);
  // A right-click whose simulated click selected nothing must not open on a later click.
  useEffect(() => {
    const disarm = () => { layerMenu.takeArmed(); };
    document.addEventListener('mousedown', disarm, true);
    return () => document.removeEventListener('mousedown', disarm, true);
  }, []);

  if (!point || !selectedKey) return null;
  const close = () => layerMenu.open(null);
  return <>
    {createPortal(<span ref={anchorRef} aria-hidden="true" className="fixed pointer-events-none" style={{ left: point.x, top: point.y, width: 0, height: 0 }} />, document.body)}
    <Menu isOpen onClose={close} triggerRef={anchorRef} placement="bottom-start" offset={0} key={`${point.x}:${point.y}`}>
      <MenuItem label="Create container" shortcut={isMac() ? '⌘G' : 'Ctrl+Alt+G'} onSelect={() => { close(); wrapSelection(); }} />
    </Menu>
  </>;
}
