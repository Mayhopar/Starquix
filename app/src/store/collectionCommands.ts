import * as Y from 'yjs';
import type { EditorCommand } from './types';
import type { ContentCollection, CollectionField } from '@/core/collections/types';
import { UNBOUND_COLLECTION_ID, BLOG_SLOT_DEFAULTS_KEY } from '@/core/collections/types';
import { SYNCED_SETTINGS_FIELDS, getOrCreateSlotScaffold, readMasterSettingsRev } from '@/core/collections/yjsAccessors';
import { isPostPageYMap } from './selectors';

export function collectionToYMap(c: ContentCollection): Y.Map<unknown> {
  const yMap = new Y.Map<unknown>();
  yMap.set('id', c.id);
  yMap.set('name', c.name);
  yMap.set('createdAt', c.createdAt);
  const yFields = new Y.Array<Y.Map<unknown>>();
  yFields.push(c.fields.map(f => {
    const yField = new Y.Map<unknown>();
    yField.set('id', f.id);
    yField.set('name', f.name);
    yField.set('type', f.type);
    yField.set('required', f.required);
    return yField;
  }));
  yMap.set('fields', yFields);
  return yMap;
}

export function yMapToCollection(yMap: Y.Map<unknown>): ContentCollection {
  const yFields = yMap.get('fields') as Y.Array<Y.Map<unknown>>;
  const fields: CollectionField[] = yFields?.toArray().map(yf => ({
    id: (yf.get('id') as string) || '',
    name: (yf.get('name') as string) || '',
    type: (yf.get('type') as CollectionField['type']) || 'text',
    required: (yf.get('required') as boolean) ?? false,
  })) || [];

  return {
    id: (yMap.get('id') as string) || '',
    name: (yMap.get('name') as string) || '',
    fields,
    createdAt: (yMap.get('createdAt') as string) || '',
  };
}

const COLLECTION_COMMANDS = new Set([
  'ADD_CONTENT_COLLECTION', 'DELETE_CONTENT_COLLECTION', 'RENAME_CONTENT_COLLECTION',
  'ADD_COLLECTION_FIELD', 'DELETE_COLLECTION_FIELD', 'RENAME_COLLECTION_FIELD',
  'SET_BLOG_SLOT_COLLECTION', 'UPDATE_BLOG_SLOT_SETTINGS', 'UNBIND_BLOG_SLOT',
  // task-028: REGISTER_BLOG_PAGINATION / REMOVE_BLOG_PAGINATION removed —
  // pagination is now a normal Yjs instance child of BlogSlot.
  'SET_CONTENT_BINDING', 'REMOVE_CONTENT_BINDING',
  'SET_POST_PAGE_COLLECTION', 'SET_POST_PAGE_BINDING', 'REMOVE_POST_PAGE_BINDING',
]);

export function isCollectionCommand(type: string): boolean {
  return COLLECTION_COMMANDS.has(type);
}

/**
 * Reset a blog-slot binding to the unbound scaffold (task-037/038). Shared by
 * the manual UNBIND_BLOG_SLOT command and the DELETE_CONTENT_COLLECTION
 * cascade so both paths produce the identical post-unbind shape.
 * UNBOUND_COLLECTION_ID matches no real collection, so selectRenderState
 * still emits the slot and bridge Phase 5 renders "No posts yet" — deleting
 * the entry instead would leave the raw BlogCard template visible. Settings
 * and per-element field bindings are preserved: inert while unbound, they
 * re-resolve by field name on re-bind.
 */
export function unbindBlogSlot(blogBindings: Y.Map<unknown>, slotKey: string): void {
  const ySlot = blogBindings.get(slotKey) as Y.Map<unknown> | undefined;
  if (!ySlot) return;
  ySlot.set('collectionId', UNBOUND_COLLECTION_ID);
}

export function applyCollectionCommand(doc: Y.Doc, command: EditorCommand): boolean {
  const collections = doc.getMap('contentCollections');
  const blogBindings = doc.getMap('blogSlotBindings');
  const postPageBindings = doc.getMap('postPageBindings');

  switch (command.type) {
    case 'ADD_CONTENT_COLLECTION':
      collections.set(command.collection.id, collectionToYMap(command.collection));
      return true;

    case 'DELETE_CONTENT_COLLECTION': {
      collections.delete(command.collectionId);

      // Cascade-unbind BlogSlot instances that pointed at the deleted
      // collection — same shared path as the manual UNBIND_BLOG_SLOT command
      // (task-037/038 parity): reset to the unbound scaffold so no dangling
      // collectionId remains AND the instance renders the empty state.
      const slotKeysToClear: string[] = [];
      blogBindings.forEach((value, slotKey) => {
        const yBinding = value as Y.Map<unknown>;
        if (yBinding.get('collectionId') === command.collectionId) {
          slotKeysToClear.push(slotKey);
        }
      });
      slotKeysToClear.forEach(k => unbindBlogSlot(blogBindings, k));

      // Cascade-delete linked post page(s) and their postPageBindings
      const pages = doc.getMap('pages');
      const pagesToRemove: string[] = [];
      pages.forEach((value, pageId) => {
        const yPage = value as Y.Map<unknown>;
        if (isPostPageYMap(yPage) && yPage.get('collectionId') === command.collectionId) {
          pagesToRemove.push(pageId);
        }
      });

      for (const pageId of pagesToRemove) {
        postPageBindings.delete(pageId);

        // Remove from parent's children array
        pages.forEach((value) => {
          const yPage = value as Y.Map<unknown>;
          const children = yPage.get('children') as Y.Array<string> | undefined;
          if (!children) return;
          const arr = children.toArray();
          const idx = arr.indexOf(pageId);
          if (idx !== -1) children.delete(idx, 1);
        });

        // Remove from rootPages if present
        const rootPages = doc.getArray('rootPages');
        const rootArr = rootPages.toArray() as string[];
        const rootIdx = rootArr.indexOf(pageId);
        if (rootIdx !== -1) rootPages.delete(rootIdx, 1);

        // Delete elements on this page
        const elements = doc.getMap('elements');
        const elemKeys: string[] = [];
        elements.forEach((el, key) => {
          if ((el as Y.Map<unknown>).get('pageId') === pageId) elemKeys.push(key);
        });
        elemKeys.forEach(k => elements.delete(k));

        pages.delete(pageId);
      }

      return true;
    }

    case 'RENAME_CONTENT_COLLECTION': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (yCol) yCol.set('name', command.name);
      return true;
    }

    case 'ADD_COLLECTION_FIELD': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yFields = yCol.get('fields') as Y.Array<Y.Map<unknown>>;
      const yField = new Y.Map<unknown>();
      yField.set('id', command.field.id);
      yField.set('name', command.field.name);
      yField.set('type', command.field.type);
      yField.set('required', command.field.required);
      yFields.push([yField]);
      return true;
    }

    case 'DELETE_COLLECTION_FIELD': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yFields = yCol.get('fields') as Y.Array<Y.Map<unknown>>;
      for (let i = 0; i < yFields.length; i++) {
        const yf = yFields.get(i);
        if ((yf.get('id') as string) === command.fieldId) {
          yFields.delete(i, 1);
          break;
        }
      }
      return true;
    }

    case 'RENAME_COLLECTION_FIELD': {
      const yCol = collections.get(command.collectionId) as Y.Map<unknown> | undefined;
      if (!yCol) return false;
      const yFields = yCol.get('fields') as Y.Array<Y.Map<unknown>>;
      for (let i = 0; i < yFields.length; i++) {
        const yf = yFields.get(i);
        if ((yf.get('id') as string) === command.fieldId) {
          yf.set('name', command.name);
          break;
        }
      }
      return true;
    }

    case 'SET_BLOG_SLOT_COLLECTION': {
      // task-028: SET_BLOG_SLOT_COLLECTION only writes binding metadata.
      // The BlogCard child exists as a real Yjs element from the BlogSlot
      // drop default; no auto-creation here.
      // task-102: settings stay SPARSE — no default fill. Absence = live
      // inheritance from BLOG_SLOT_DEFAULTS_KEY via resolveBlogSettings.
      const ySlot = getOrCreateSlotScaffold(blogBindings, command.slotKey);
      ySlot.set('collectionId', command.collectionId);
      return true;
    }

    case 'UNBIND_BLOG_SLOT': {
      unbindBlogSlot(blogBindings, command.slotKey);
      return true;
    }

    case 'UPDATE_BLOG_SLOT_SETTINGS': {
      // task-028: only update the binding's settings map. Layout class
      // changes flow through the wrapper element's own classOverrides /
      // breakpoint classes via the normal DesignBar code path.
      // task-102 ONE LOGIC: the single write point for both directions.
      // Master (defaults key) writes bump settingsRev; instance writes stay
      // SPARSE (only patched fields) and stamp settingsBaseRev = master rev.
      const ySlot = getOrCreateSlotScaffold(blogBindings, command.slotKey);
      const ySettings = ySlot.get('settings') as Y.Map<unknown>;
      if (command.settings === null) {
        // settings: null = clear all synced overrides → back to live
        // inheritance (push and reset both use this; layout/columns/gap are
        // per-instance and survive).
        for (const f of SYNCED_SETTINGS_FIELDS) ySettings.delete(f);
      } else {
        for (const [k, v] of Object.entries(command.settings)) {
          ySettings.set(k, v);
        }
      }
      const isMaster = command.slotKey === BLOG_SLOT_DEFAULTS_KEY;
      if (isMaster) {
        ySlot.set('settingsRev', (((ySlot.get('settingsRev') as number) ?? 0) + 1));
      } else {
        ySlot.set('settingsBaseRev', readMasterSettingsRev(doc));
      }
      return true;
    }

    case 'SET_CONTENT_BINDING': {
      const ySlot = blogBindings.get(command.slotKey) as Y.Map<unknown> | undefined;
      if (!ySlot) return false;
      const yBindings = ySlot.get('bindings') as Y.Map<unknown>;
      yBindings.set(command.elementKey, command.fieldName);
      return true;
    }

    case 'REMOVE_CONTENT_BINDING': {
      const ySlot = blogBindings.get(command.slotKey) as Y.Map<unknown> | undefined;
      if (!ySlot) return false;
      const yBindings = ySlot.get('bindings') as Y.Map<unknown>;
      yBindings.delete(command.elementKey);
      return true;
    }

    case 'SET_POST_PAGE_COLLECTION': {
      // task-036 1:1 lock: a detail page is bound to its collection for life
      // (created and deleted atomically with it). Refuse a rebind — only the
      // initial bind (no existing collection) or an idempotent re-apply pass.
      const yPage = doc.getMap('pages').get(command.pageId) as Y.Map<unknown> | undefined;
      const pageCollectionId = yPage?.get('collectionId') as string | undefined;
      const existingBinding = postPageBindings.get(command.pageId) as Y.Map<unknown> | undefined;
      const boundCollectionId = existingBinding?.get('collectionId') as string | undefined;
      if (
        (pageCollectionId && pageCollectionId !== command.collectionId) ||
        (boundCollectionId && boundCollectionId !== command.collectionId)
      ) {
        console.error(
          `[SET_POST_PAGE_COLLECTION] Refused: page "${command.pageId}" is bound to collection "${boundCollectionId ?? pageCollectionId}" — a detail page cannot be rebound to "${command.collectionId}" (task-036 1:1 lock).`
        );
        return false;
      }
      let yBinding = existingBinding;
      if (!yBinding) {
        yBinding = new Y.Map<unknown>();
        postPageBindings.set(command.pageId, yBinding);
      }
      yBinding.set('collectionId', command.collectionId);
      if (!yBinding.get('bindings')) {
        yBinding.set('bindings', new Y.Map<unknown>());
      }
      return true;
    }

    case 'SET_POST_PAGE_BINDING': {
      const yBinding = postPageBindings.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!yBinding) return false;
      const bindings = yBinding.get('bindings') as Y.Map<unknown>;
      bindings.set(command.elementKey, command.fieldName);
      return true;
    }

    case 'REMOVE_POST_PAGE_BINDING': {
      const yBinding = postPageBindings.get(command.pageId) as Y.Map<unknown> | undefined;
      if (!yBinding) return false;
      const bindings = yBinding.get('bindings') as Y.Map<unknown>;
      bindings.delete(command.elementKey);
      return true;
    }

    default:
      return false;
  }
}
