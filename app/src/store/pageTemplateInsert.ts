import type * as Y from 'yjs';
import { applyCommand } from './commands';
import { buildAddCommand } from './addCommandFactory';
import { selectRootElementIds } from './selectors';
import { BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';
import type { EditorCommand } from './types';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import { acceptDocumentMutation, type MutationSnapshot } from './documentMutation';
import { prepareEditorCommand } from './durableDispatch';
import type { MaterializationCommand, AcceptedEdit } from '@/services/durableEdits/types';

/** Insert index for a picker add: right after the selected root, else the end. */
export function rootInsertIndex(rootIds: string[], selectedId: string | null): number {
  if (!selectedId) return rootIds.length;
  const idx = rootIds.indexOf(selectedId);
  return idx >= 0 ? idx + 1 : rootIds.length;
}

/** Move an existing root to `target` in the page's rootElementIds. */
export function repositionRoot(doc: Y.Doc, pageId: string, elementId: string, target: number): void {
  const page = doc.getMap('pages').get(pageId) as Y.Map<unknown> | undefined;
  const rootIds = page?.get('rootElementIds') as Y.Array<string> | undefined;
  if (!rootIds) return;
  const currentIdx = rootIds.toArray().indexOf(elementId);
  if (currentIdx !== -1 && currentIdx !== target) {
    rootIds.delete(currentIdx, 1);
    rootIds.insert(target, [elementId]);
  }
}

/**
 * Stage optional replacement, picker ADD, and root reposition as ONE accepted
 * revision. No intermediate state is published to the live document.
 * Needed because ADD_ELEMENT / ADD_THEME_INSTANCE always PUSH roots and
 * ignore element.index (commands.ts), so ordered inserts must reposition
 * after the add. Regression: task-105 insert-after-selection.
 */
export async function addRootAt(
  doc: Y.Doc,
  command: EditorCommand,
  pageId: string,
  elementId: string,
  index: number,
  snapshot?: MutationSnapshot,
  replaceId?: string | null,
  commands: MaterializationCommand[] = [],
): Promise<AcceptedEdit> {
  const frozen = prepareEditorCommand(command);
  return acceptDocumentMutation(doc, staged => {
    if (replaceId && !applyCommand(staged, { type: 'REMOVE_ELEMENT', elementId: replaceId })) throw new Error('Element replacement refused');
    if (!applyCommand(staged, frozen)) throw new Error('Element insertion refused');
    repositionRoot(staged, pageId, elementId, index);
  }, snapshot, commands);
}

/**
 * Stage a complete template gesture as ONE accepted revision. The caller
 * supplies any prior-content deletion plan via beforeInsert and claims the
 * undo snapshot. Returned BlogSlot IDs are safe for post-acceptance pickers.
 */
export async function insertTemplateComponents(args: {
  doc: Y.Doc;
  pageId: string;
  components: ScannedComponent[];
  generateId: () => string;
  resolveComponent?: (name: string) => ScannedComponent | undefined;
  snapshot?: MutationSnapshot;
  beforeInsert?: (staged: Y.Doc) => void;
}): Promise<{ addedIds: string[]; blogSlotIds: string[] }> {
  const { doc, pageId, components, generateId, resolveComponent } = args;
  const addedIds = components.map(() => generateId());
  const blogSlotIds = addedIds.filter((_, i) => components[i].name === BLOG_SLOT_COMPONENT_TYPE);
  const commands = components.map((component, i) => prepareEditorCommand(buildAddCommand({
        elementId: addedIds[i], pageId, component,
        parentId: null, index: i,
        resolveComponent,
      })));
  await acceptDocumentMutation(doc, staged => {
    args.beforeInsert?.(staged);
    const base = selectRootElementIds(staged, pageId).length;
    commands.forEach((command, i) => {
      if (!applyCommand(staged, command)) throw new Error('Template insertion refused');
      repositionRoot(staged, pageId, addedIds[i], base + i);
    });
  }, args.snapshot);
  return { addedIds, blogSlotIds };
}
