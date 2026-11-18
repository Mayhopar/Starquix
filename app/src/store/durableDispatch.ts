import * as Y from 'yjs';
import { acceptProjectEdit } from '@/services/durableEdits/acceptance';
import type { AcceptedEdit, MaterializationCommand } from '@/services/durableEdits/types';
import { applyCommand } from './commands';
import { generateId } from '@/utils/generateId';
import type { EditorCommand } from './types';
import { commitMutationSnapshot, type MutationSnapshot } from './documentMutation';
import { isLocalProjectId } from '@/utils/localMode';
import { currentScannedSourceLocation, registeredSourceLocation } from '@/utils/sourceLocationKey';
import { captureLocalWriteOrigin, isCrossFileAtOrigin, allowsCrossFileOverrideWrite } from '@/utils/localWriteScope';
import { acceptSourceImageAttribute } from '@/services/durableEdits/sourceAttributeAcceptance';
import { SOURCE_OWNED_FIELD, sourceOwnedImageValues } from './sourceOverrideEntries';

export type SessionCommand = Extract<EditorCommand, { type: 'SET_CURRENT_PAGE' | 'SET_BREAKPOINT' | 'SET_THEME_MODE' }>;
export type ProjectCommand = Exclude<EditorCommand, SessionCommand>;
export type EditorDispatch = (action: EditorCommand) => boolean | Promise<AcceptedEdit | boolean>;

/** Every new reducer action must explicitly declare its durability owner. */
export function classifyEditorAction(action: EditorCommand): 'project' | 'session' {
  switch (action.type) {
    case 'SET_CURRENT_PAGE':
    case 'SET_BREAKPOINT':
    case 'SET_THEME_MODE':
      return 'session';
    case 'ADD_PAGE':
    case 'DELETE_PAGE':
    case 'RENAME_PAGE':
    case 'SET_HOME_PAGE':
    case 'MOVE_PAGE':
    case 'ADD_ELEMENT':
    case 'PASTE_ELEMENTS':
    case 'REMOVE_ELEMENT':
    case 'REORDER_PAGE_ELEMENTS':
    case 'REGISTER_SOURCE_ELEMENT':
    case 'UPDATE_SOURCE_CLASSES':
    case 'UPDATE_SOURCE_TEXT':
    case 'CLEAR_SOURCE_TEXT':
    case 'CLEAR_SOURCE_IMAGE_ATTRIBUTES':
    case 'UPDATE_SOURCE_MARKUP':
    case 'UPDATE_STATIC_MARKUP':
    case 'UPDATE_PEN_PATH':
    case 'UPDATE_INSTANCE_OVERRIDE':
    case 'SET_MASTER_MARKUP':
    case 'SET_MASTER_CHILD_OVERRIDES':
    case 'DISCARD_OVERRIDE_ORPHAN':
    case 'ADD_THEME_INSTANCE':
    case 'REMAP_COMPONENT_SOURCE':
    case 'UPDATE_THEME_INSTANCE_CLASS_OVERRIDE':
    case 'RESET_THEME_INSTANCE_OVERRIDE':
    case 'UPDATE_MARKUP_OVERRIDE':
    case 'UPDATE_LINK_ATTRIBUTE':
    case 'UNWRAP_LINK':
    case 'UPDATE_IMAGE_ATTRIBUTE':
    case 'SET_SLOT_NAME':
    case 'UPDATE_INSTANCE_CHILD_ATTRIBUTE':
    case 'SET_ELEMENT_SLOT_NAME':
    case 'SET_PAGE_LAYOUT':
    case 'ENSURE_LAYOUT_ELEMENT':
    case 'DELETE_PAGE_LAYOUT_WITH_CONTENT':
    case 'UPDATE_PAGE_SEO':
    case 'ADD_DRAWN_ELEMENT':
    case 'REMOVE_DRAWN_ELEMENT':
    case 'CLEAR_DRAWN_SLOT_FILL':
    case 'RESOLVE_DRAWN_MEDIA':
    case 'RESOLVE_INSTANCE_MEDIA':
    case 'CLEAR_PAGE_DRAWN_ELEMENTS':
    case 'CLEAR_INSTANCE_DRAWN_ELEMENTS':
    case 'DELETE_INSTANCE_CHILD':
    case 'SET_CHILD_ORDER':
    case 'CLEAR_INSTANCE_CHILD_ORDERS':
    case 'CLEAR_INSTANCE_OVERRIDES':
    case 'GRID_PLACE_ELEMENT':
    case 'SET_GRID_SPAN':
    case 'REPARENT_ELEMENT':
    case 'ADD_VARIABLE_COLLECTION':
    case 'DELETE_VARIABLE_COLLECTION':
    case 'RENAME_VARIABLE_COLLECTION':
    case 'ADD_VARIABLE_MODE':
    case 'DELETE_VARIABLE_MODE':
    case 'RENAME_VARIABLE_MODE':
    case 'SET_DEFAULT_MODE':
    case 'REORDER_VARIABLE_MODES':
    case 'ADD_VARIABLE':
    case 'DELETE_VARIABLE':
    case 'UPDATE_VARIABLE_NAME':
    case 'UPDATE_VARIABLE_VALUE':
    case 'UPDATE_VARIABLE_TYPE':
    case 'REORDER_VARIABLES':
    case 'SET_COLLECTION_FROM_CSS':
    case 'ADD_CONTENT_COLLECTION':
    case 'DELETE_CONTENT_COLLECTION':
    case 'RENAME_CONTENT_COLLECTION':
    case 'ADD_COLLECTION_FIELD':
    case 'DELETE_COLLECTION_FIELD':
    case 'RENAME_COLLECTION_FIELD':
    case 'SET_BLOG_SLOT_COLLECTION':
    case 'UNBIND_BLOG_SLOT':
    case 'UPDATE_BLOG_SLOT_SETTINGS':
    case 'SET_CONTENT_BINDING':
    case 'REMOVE_CONTENT_BINDING':
    case 'SET_POST_PAGE_COLLECTION':
    case 'SET_POST_PAGE_BINDING':
    case 'REMOVE_POST_PAGE_BINDING':
    case 'SET_PROJECT_FONT':
    case 'REMOVE_PROJECT_FONT':
      return 'project';
    default: {
      const unclassified: never = action;
      throw new Error(`Unclassified editor action: ${String(unclassified)}`);
    }
  }
}

/** The only synchronous UI dispatch. Its type and runtime guard agree. */
export function dispatchSessionAction(doc: Y.Doc, action: SessionCommand): boolean {
  if (classifyEditorAction(action) !== 'session') throw new Error('Project edits require durable acceptance');
  let applied = false;
  doc.transact(() => { applied = applyCommand(doc, action); }, 'sync');
  return applied;
}

export function prepareEditorCommand(action: EditorCommand): EditorCommand {
  const frozen = structuredClone(action);
  if (frozen.type === 'ADD_ELEMENT' && frozen.element.defaultChildren) {
    frozen.element.defaultChildren = frozen.element.defaultChildren.map(child => ({ ...child, id: child.id ?? generateId() }));
  }
  return frozen;
}

export function dispatchDurableAction(doc: Y.Doc, action: EditorCommand,
  commands: MaterializationCommand[] = [], operationId = crypto.randomUUID(),
  snapshot?: MutationSnapshot, options: { background?: boolean } = {}): Promise<AcceptedEdit> {
  if (classifyEditorAction(action) !== 'project') return Promise.reject(new Error('Use session dispatch for UI actions'));
  const projectId = doc.getMap('meta').get('projectId');
  if (typeof projectId !== 'string' || !projectId) return Promise.reject(new Error('Project storage is not ready'));
  // Freeze caller-owned payloads before the shared queue can yield.
  const frozen = prepareEditorCommand(action);
  if (frozen.type === 'UPDATE_IMAGE_ATTRIBUTE' && isLocalProjectId(projectId)) {
    if (frozen.attribute === 'loading' && frozen.value && !['lazy', 'eager'].includes(frozen.value)) return Promise.reject(new Error('Invalid image loading value'));
    const location = currentScannedSourceLocation(projectId, frozen.elementId)
      ?? registeredSourceLocation(doc, frozen.elementId, 'sourceImageAttributes');
    const origin = captureLocalWriteOrigin();
    // Instance/drawn keys and page-scoped component overrides keep their
    // existing document owner. Never promote an instance edit to a master write.
    if (location && !(isCrossFileAtOrigin(origin, location.file) && !allowsCrossFileOverrideWrite(origin, location.file))) {
      return acceptSourceImageAttribute(projectId, location, frozen.attribute, frozen.value, false, origin, {
        doc, snapshot, operationId, commands, background: options.background,
        mutate: staged => {
          if (!applyCommand(staged, frozen)) throw new Error(`Editor action refused: ${frozen.type}`);
          const entry = staged.getMap<Y.Map<unknown>>('sourceImageAttributes').get(frozen.elementId);
          if (entry) entry.set(SOURCE_OWNED_FIELD, JSON.stringify({ ...sourceOwnedImageValues(entry), [frozen.attribute]: frozen.value }));
        },
      });
    }
  }
  return acceptProjectEdit(doc, { projectId, operationId, commands: structuredClone(commands), background: options.background, mutate: staged => {
    snapshot?.stage(staged);
    if (!applyCommand(staged, frozen)) throw new Error(`Editor action refused: ${frozen.type}`);
  } }).then(accepted => { commitMutationSnapshot(snapshot); return accepted; });
}
