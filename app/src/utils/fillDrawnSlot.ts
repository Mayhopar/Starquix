import * as Y from 'yjs';
import { addKeysToMarkup } from '@/store/commands';
import { isThemeComponentTemplate, type ScannedComponent, type ThemeComponentTemplate } from '@/components/ComponentPickerModal';
import { acceptDocumentMutation, type MutationSnapshot } from '@/store/documentMutation';

/**
 * Drop a picker component into a drawn `<slot>` element. Stamps data-keys onto
 * the filler markup keyed under the slot's id (so clicks inside the fill
 * surface as `slotKey:tag-N` instance-child keys, not the bridge's
 * `dynamic:tag-N@hash` fallback), and records the filler's source path on
 * `astroSource`. After this, the slot is structurally an instance of the
 * filler — overrides accumulate on the slot's classOverrides/textOverrides
 * just like any theme instance, and `resolveOverrideSource` can route
 * write-backs to the filler component's source via the markers picker HTML
 * already carries.
 *
 * Theme-component fills (no scannable path) skip astroSource — they have no
 * file to write back to, so they behave purely as in-memory overrides.
 */
export async function fillDrawnSlot(
  doc: Y.Doc,
  slotKey: string,
  componentElementId: string,
  component: ScannedComponent | ThemeComponentTemplate,
  snapshot?: MutationSnapshot,
): Promise<void> {
  const scannedPath = isThemeComponentTemplate(component) ? null : component.path;
  const stamped = addKeysToMarkup(component.html || '', slotKey);
  const name = component.name;
  await acceptDocumentMutation(doc, staged => {
    const ySlot = staged.getMap('elements').get(slotKey) as Y.Map<unknown> | undefined;
    if (!ySlot) throw new Error('Slot no longer exists');
    ySlot.set('slotComponentId', componentElementId);
    ySlot.set('slotComponentName', name);
    ySlot.set('slotComponentMarkup', stamped);
    if (scannedPath) {
      ySlot.set('slotComponentPath', scannedPath);
      ySlot.set('astroSource', scannedPath);
    }
  }, snapshot);
}
