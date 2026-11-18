/**
 * Slot Target Block
 *
 * Per-element control shown when a content root is selected AND the page's
 * layout declares named slots. Places the element into a named slot (or the
 * default slot) by setting its `slotName` via SET_ELEMENT_SLOT_NAME.
 *
 * Distinct from SlotBlock: SlotBlock names a <slot/> WHILE EDITING A LAYOUT;
 * SlotTargetBlock places a CONTENT ELEMENT into a named slot ON THE PAGE.
 */

import { useCallback, type FC } from 'react';
import * as Y from 'yjs';
import { useDispatch, useYjsValue } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { useLayoutLibrary } from '@/hooks/useLayoutLibrary';
import { selectPageLayout } from '@/store/selectors';

interface SlotTargetBlockProps {
  /** Yjs id of the selected content element */
  elementKey: string;
  /** Yjs id of the current page */
  pageId: string;
}

const DEFAULT_SLOT = 'default';

export const SlotTargetBlock: FC<SlotTargetBlockProps> = ({ elementKey, pageId }) => {
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();
  const { layouts } = useLayoutLibrary();

  const { slotName, layoutName } = useYjsValue((doc) => {
    const el = doc.getMap('elements').get(elementKey) as Y.Map<unknown> | undefined;
    const { layoutName } = selectPageLayout(doc, pageId);
    return { slotName: ((el?.get('slotName') as string) || '').trim(), layoutName };
  });

  const namedSlots = (layouts.find((l) => l.name === layoutName)?.slots ?? []).filter(
    (s) => s !== DEFAULT_SLOT,
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const value = e.target.value;
      takeSnapshot();
      dispatch({
        type: 'SET_ELEMENT_SLOT_NAME',
        elementId: elementKey,
        slotName: value === DEFAULT_SLOT ? null : value,
      });
    },
    [elementKey, takeSnapshot, dispatch],
  );

  if (!layoutName || namedSlots.length === 0) return null;

  const options = [DEFAULT_SLOT, ...namedSlots];

  return (
    <div data-testid="slot-target-block" className="pr-1 pb-2">
      <div className="text-xs text-text-muted py-1 pl-1">Slot</div>
      <select
        value={slotName || DEFAULT_SLOT}
        onChange={handleChange}
        className="w-full py-1.5 px-2 text-xs bg-input-fill text-text border border-input-stroke rounded-sm outline-none focus:border-accent-strong"
      >
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
};

export default SlotTargetBlock;
