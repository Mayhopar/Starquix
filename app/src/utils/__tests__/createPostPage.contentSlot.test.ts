import 'fake-indexeddb/auto';
/**
 * Blog Content Slot Element — Task 2.
 *
 * The post page's markdown-content area must be a real Yjs element
 * (`bindingType='collection-content'`, `type='slot'`, `slotName='content'`)
 * rendering as `<div data-sq-slot>` — the same signal filled layout slots
 * use — instead of an invisible postPageBindings 'body' entry. The host
 * starter template carries `<slot name="content">` so composeSlotChildren
 * splices the child in; prose classes live on the CHILD div (children
 * replace the slot tag, so classes on the slot itself would be lost).
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createPostPage } from '../createPostPage';

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

describe('createPostPage — typed collection-content slot element', () => {
  it('creates a collection-content slot child instead of a body binding', async () => {
    const doc = setupDoc();
    const pageId = await createPostPage(doc, 'col-1', 'blog', null);
    const elements = doc.getMap('elements');
    let contentEl: Y.Map<unknown> | undefined;
    let hostId = '';
    elements.forEach((v, id) => {
      const el = v as Y.Map<unknown>;
      if (el.get('bindingType') === 'collection-content') contentEl = el;
      if (el.get('componentType') === 'PostPageLayout') hostId = id;
    });
    expect(contentEl).toBeDefined();
    expect(contentEl!.get('parentId')).toBe(hostId);
    expect(contentEl!.get('slotName')).toBe('content');
    expect(contentEl!.get('type')).toBe('slot');
    expect(contentEl!.get('staticMarkup')).toContain('data-sq-slot');
    const host = elements.get(hostId) as Y.Map<unknown>;
    // addKeysToMarkup stamps a data-key on every element, slot included.
    expect(host.get('staticMarkup')).toMatch(/<slot [^>]*name="content"/);
    expect(host.get('staticMarkup')).not.toContain('prose prose-lg');
    const binding = (doc.getMap('postPageBindings').get(pageId) as Y.Map<unknown>).get('bindings') as Y.Map<unknown>;
    const values: string[] = []; binding.forEach((v) => values.push(v as string));
    expect(values).not.toContain('body');
    expect(values).toEqual(expect.arrayContaining(['title', 'date', 'thumbnail']));
  });
});
