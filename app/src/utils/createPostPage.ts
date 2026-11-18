import type * as Y from 'yjs';
import { applyCommand } from '@/store/commands';
import { emptyClassData, type EditorCommand } from '@/store/types';
import { selectPostPageByCollectionId } from '@/store/selectors';
import { generateId, generatePageId } from './generateId';
import { acceptDocumentMutation, type MutationSnapshot } from '@/store/documentMutation';

/** The host-side placeholder the content-slot element splices into. Shared
 *  with the legacy-binding migration so migrated and fresh post pages stay
 *  byte-compatible. */
export const CONTENT_SLOT_PLACEHOLDER = '<slot name="content"></slot>';

const STARTER_TEMPLATE = (elId: string) =>
  `<article class="max-w-3xl mx-auto px-4 py-12"><h1 data-key="${elId}:h1-0" class="text-4xl font-bold mb-4">Post Title</h1><time data-key="${elId}:time-0" class="text-sm text-gray-500 mb-8 block">Date</time><img data-key="${elId}:img-0" class="w-full rounded-lg mb-8" src="/images/placeholder.jpg" alt="" />${CONTENT_SLOT_PLACEHOLDER}</article>`;

// Prose classes live on the CHILD div (not the host's <slot> tag): slot
// children REPLACE the slot at component level, so classes on the slot
// itself would be lost. `data-sq-slot` is the same signal filled layout
// slots use — the scanner stamps slotName from it (bridge scanning).
export const contentSlotMarkup = (cls = 'prose prose-lg'): string =>
  `<div data-sq-slot name="content" class="${cls}">Post content goes here...</div>`;

/** Create a post page with starter template and field bindings. Returns the new page ID. */
export async function createPostPage(
  doc: Y.Doc,
  collectionId: string,
  collectionName: string,
  parentPageId: string | null,
  snapshot?: MutationSnapshot,
  precedingCommands: EditorCommand[] = [],
): Promise<string> {
  const pageId = generatePageId();
  const elId = generateId();
  const contentElId = `${elId}-content`; // matches the migration's <hostId>-content convention
  let resolvedPageId = pageId;

  await acceptDocumentMutation(doc, doc => {
    for (const command of precedingCommands) if (!applyCommand(doc, command)) throw new Error(`Collection creation refused: ${command.type}`);
    // Another queued creator may already own this collection's detail page.
    // Resolve inside the shared lane, before adding any page or child elements.
    const existing = selectPostPageByCollectionId(doc, collectionId);
    if (existing) { resolvedPageId = existing.id; return; }
    const apply = (command: EditorCommand) => {
      if (!applyCommand(doc, command)) throw new Error(`Post page creation refused: ${command.type}`);
    };
    apply({ type: 'ADD_PAGE', page: {
      id: pageId, name: 'Post Page', rootElementIds: [], children: [],
      pageType: 'post', collectionId, routePrefix: `/${collectionName}/posts`,
    }});
    apply({ type: 'SET_POST_PAGE_COLLECTION', pageId, collectionId });
    apply({ type: 'MOVE_PAGE', pageId, newParentId: parentPageId, index: 0 });
    apply({ type: 'ADD_ELEMENT', element: {
      id: elId, pageId, parentId: null, index: 0,
      type: 'component', instanceType: 'local', componentType: 'PostPageLayout',
      classes: emptyClassData(),
      staticMarkup: STARTER_TEMPLATE(elId),
      classOverrides: {},
    }});
    apply({ type: 'ADD_ELEMENT', element: {
      id: contentElId, pageId, parentId: elId, index: 0,
      type: 'slot', bindingType: 'collection-content', slotName: 'content',
      classes: emptyClassData(),
      staticMarkup: contentSlotMarkup(),
      classOverrides: {},
    }});
    apply({ type: 'SET_POST_PAGE_BINDING', pageId, elementKey: `${elId}:h1-0`, fieldName: 'title' });
    apply({ type: 'SET_POST_PAGE_BINDING', pageId, elementKey: `${elId}:time-0`, fieldName: 'date' });
    apply({ type: 'SET_POST_PAGE_BINDING', pageId, elementKey: `${elId}:img-0`, fieldName: 'thumbnail' });
  }, snapshot);

  return resolvedPageId;
}
