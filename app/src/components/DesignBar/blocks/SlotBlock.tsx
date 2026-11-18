/**
 * Slot Block
 *
 * Edits the `name` attribute of a selected Astro `<slot />`. Empty name = the
 * default slot; a non-empty name emits `<slot name="X" />`.
 *
 * Two representations, two persistence paths (both reuse existing machinery):
 *  - A Yjs slot element (codegen-shaped `type:'slot'` or the slot draw tool's
 *    `slotType:'slot'`) → SET_SLOT_NAME on the element, with undo.
 *  - A layout `<slot>` opened in the editor is a SOURCE child (instance-child
 *    key `<root>:slot-0`, NOT in the elements map). Its name is stored as an
 *    attributeOverride on the editor root and written back to the .astro source
 *    by pushOverridesToSource → UPDATE_INSTANCE_CHILD_ATTRIBUTE.
 */

import { useState, useEffect, useCallback, type FC } from 'react';
import { useDispatch, useYjsValue } from '@/store/hooks';
import { useUndoContext } from '@/context/UndoContext';
import { parseKey } from '@/store/types';
import { findElementBySelectorInMarkup } from '@/utils/markupQuery';
import * as Y from 'yjs';

interface SlotBlockProps {
  /** Selected slot key: a Yjs element id OR an instance-child key `<root>:slot-N`. */
  elementKey: string;
  /**
   * Whether the name can be edited here. False for a FILLED layout slot on a
   * real page — it's owned by the layout, so the name is shown read-only (rename
   * it in the layout editor). Defaults to true.
   */
  editable?: boolean;
  /**
   * Name to show when the Yjs/markup lookup yields nothing — e.g. a real-page
   * filled slot renders as `<div data-sq-slot>` (not a parseable `<slot>`), so
   * the name comes from the scan instead.
   */
  fallbackName?: string;
}

export const SlotBlock: FC<SlotBlockProps> = ({ elementKey, editable = true, fallbackName = '' }) => {
  const dispatch = useDispatch();
  const { takeSnapshot } = useUndoContext();

  const parsed = parseKey(elementKey);
  const isInstanceChild = parsed?.type === 'instance-child';
  const instanceId = isInstanceChild ? parsed.instanceId : null;
  const selector = isInstanceChild ? parsed.selector : null;

  // Current slot name, from whichever representation is in play.
  const yjsName = useYjsValue<string>((doc) => {
    const elements = doc.getMap('elements');
    if (isInstanceChild && instanceId && selector) {
      const inst = elements.get(instanceId) as Y.Map<unknown> | undefined;
      // Pending override wins; else read the original name from staticMarkup.
      const overrides = inst?.get('attributeOverrides') as Y.Map<Y.Map<string>> | undefined;
      const override = overrides?.get(selector)?.get('name');
      if (typeof override === 'string') return override;
      const markup = (inst?.get('staticMarkup') as string) || '';
      const el = markup ? findElementBySelectorInMarkup(markup, selector) : null;
      return el?.getAttribute('name') ?? '';
    }
    const el = elements.get(elementKey) as Y.Map<unknown> | undefined;
    const attrs = el?.get('attributes') as Record<string, string> | undefined;
    return attrs?.name ?? '';
  });
  // The filled-slot div isn't a parseable <slot>, so yjsName is '' there — fall
  // back to the scanned name.
  const slotName = yjsName || fallbackName;

  const [name, setName] = useState(slotName);

  useEffect(() => {
    setName(slotName);
  }, [slotName]);

  const commit = useCallback(() => {
    if (!editable) return;
    const trimmed = name.trim();
    if (trimmed === slotName) return;
    takeSnapshot();
    if (isInstanceChild && instanceId && selector) {
      dispatch({ type: 'UPDATE_INSTANCE_CHILD_ATTRIBUTE', instanceId, selector, attribute: 'name', value: trimmed });
    } else {
      dispatch({ type: 'SET_SLOT_NAME', elementId: elementKey, name: trimmed });
    }
  }, [editable, name, slotName, isInstanceChild, instanceId, selector, elementKey, takeSnapshot, dispatch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setName(slotName);
      e.currentTarget.blur();
    }
  }, [slotName]);

  return (
    <div data-testid="slot-block" className="pr-1 pb-2">
      <div className="text-xs text-text-muted py-1 pl-1">Slot name</div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        readOnly={!editable}
        placeholder="default"
        className={`w-full py-1.5 px-2 text-xs bg-input-fill text-text border border-input-stroke rounded-sm outline-none ${editable ? 'focus:border-accent-strong' : 'opacity-70 cursor-default'}`}
      />
      <div className="text-xs text-text-secondary pt-1 pl-1">
        {!editable
          ? 'Defined by the layout — rename it in the layout editor.'
          : name.trim() ? `Targeted as slot="${name.trim()}"` : 'Default slot'}
      </div>
    </div>
  );
};

export default SlotBlock;
