import 'fake-indexeddb/auto';
/**
 * Blog Content Slot Element — Task 6.
 *
 * The collection-content slot element is NOT user-deletable (precedent:
 * layout chrome, commit 044954b). Deleting it would orphan the post page's
 * `<slot name="content">` placeholder with no UI to recreate it. The guard
 * lives at the command level (DELETE_INSTANCE_CHILD / REMOVE_ELEMENT) so
 * every entry point — keyboard shortcuts, layers panel — is covered at once.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand } from '../commands';
import { createPostPage } from '../../utils/createPostPage';

function setupDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('meta').set('projectId', crypto.randomUUID());
  doc.transact(() => {
    const pages = doc.getMap('pages');
    const home = new Y.Map();
    home.set('id', 'home');
    home.set('name', 'Home');
    home.set('rootElementIds', new Y.Array());
    home.set('children', new Y.Array());
    pages.set('home', home);
    doc.getArray('rootPages').push(['home']);
  }, 'sync');
  return doc;
}

async function createPostPageDoc() {
  const doc = setupDoc();
  const pageId = await createPostPage(doc, 'col-1', 'blog', null);
  const elements = doc.getMap('elements');
  let contentId = '';
  let hostId = '';
  elements.forEach((v, id) => {
    const el = v as Y.Map<unknown>;
    if (el.get('bindingType') === 'collection-content') contentId = id;
    if (el.get('componentType') === 'PostPageLayout') hostId = id;
  });
  expect(contentId).not.toBe('');
  expect(hostId).not.toBe('');
  return { doc, pageId, elements, contentId, hostId };
}

describe('collection-content slot element is not user-deletable', () => {
  it('DELETE_INSTANCE_CHILD on the content element is refused', async () => {
    const { doc, elements, contentId } = await createPostPageDoc();
    const contentEl = elements.get(contentId) as Y.Map<unknown>;
    const markupBefore = contentEl.get('staticMarkup') as string;

    const result = applyCommand(doc, {
      type: 'DELETE_INSTANCE_CHILD',
      instanceId: contentId,
      selector: 'div-0',
    });

    expect(result).toBe(false);
    const after = elements.get(contentId) as Y.Map<unknown> | undefined;
    expect(after).toBeDefined();
    expect(after!.get('staticMarkup')).toBe(markupBefore);
    expect(after!.get('deletedSelectors')).toBeUndefined();
  });

  it('REMOVE_ELEMENT on the content element is refused', async () => {
    const { doc, elements, contentId, hostId } = await createPostPageDoc();
    const contentEl = elements.get(contentId) as Y.Map<unknown>;
    const markupBefore = contentEl.get('staticMarkup') as string;

    const result = applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: contentId });

    expect(result).toBe(false);
    const after = elements.get(contentId) as Y.Map<unknown> | undefined;
    expect(after).toBeDefined();
    expect(after!.get('staticMarkup')).toBe(markupBefore);
    // Parent bookkeeping untouched: still parented to the host.
    expect(after!.get('parentId')).toBe(hostId);
  });

  // Positive controls: the guard must not be over-broad.
  it('REMOVE_ELEMENT still deletes the non-protected host element', async () => {
    const { doc, pageId, elements, hostId } = await createPostPageDoc();

    const result = applyCommand(doc, { type: 'REMOVE_ELEMENT', elementId: hostId });

    expect(result).toBe(true);
    expect(elements.get(hostId)).toBeUndefined();
    const page = doc.getMap('pages').get(pageId) as Y.Map<unknown>;
    const rootIds = (page.get('rootElementIds') as Y.Array<string>).toArray();
    expect(rootIds).not.toContain(hostId);
  });

  it('DELETE_INSTANCE_CHILD still deletes a non-protected instance child', async () => {
    const { doc, elements, hostId } = await createPostPageDoc();

    applyCommand(doc, {
      type: 'DELETE_INSTANCE_CHILD',
      instanceId: hostId,
      selector: 'h1-0',
    });

    const host = elements.get(hostId) as Y.Map<unknown>;
    const deletedSelectors = host.get('deletedSelectors') as Y.Array<string>;
    expect(deletedSelectors.toArray()).toContain('h1-0');
  });
});
