/**
 * Regression: task-025 — component editor must not accumulate orphan
 * elements in doc.getMap('elements') across opens.
 *
 * The previous cleanup in LeftSidebar.handleSelectComponent only iterated
 * page.rootElementIds, so sub-elements (drawn slots, post wrappers,
 * instance children) added during a session — which live in the elements
 * map under pageId=COMPONENT_EDITOR_PAGE_ID but are NOT in rootElementIds —
 * survived the cleanup. Three distinct el-* IDs were observed in ~30s in
 * one session before the fix.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { applyCommand, resetComponentEditorPage } from '../commands';
import { buildAddCommand } from '../addCommandFactory';
import { COMPONENT_EDITOR_PAGE_ID } from '../constants';

function openBlogPostInEditor(doc: Y.Doc): void {
  const component = {
    name: 'BlogPost',
    path: 'preview-template/src/components/library/BlogPost.astro',
    html: '<article><h1>Sample</h1></article>',
  // ScannedComponent has more fields but buildAddCommand only reads these.
  } as unknown as Parameters<typeof buildAddCommand>[0]['component'];

  doc.transact(() => {
    resetComponentEditorPage(doc);

    const pages = doc.getMap('pages');
    const yPage = new Y.Map();
    yPage.set('id', COMPONENT_EDITOR_PAGE_ID);
    yPage.set('name', 'BlogPost');
    yPage.set('rootElementIds', new Y.Array());
    yPage.set('children', new Y.Array());
    pages.set(COMPONENT_EDITOR_PAGE_ID, yPage);

    applyCommand(doc, buildAddCommand({
      elementId: 'el-test-' + Math.random().toString(36).slice(2, 8),
      pageId: COMPONENT_EDITOR_PAGE_ID,
      component,
      parentId: null,
      index: 0,
      staticMarkupOverride: component.html as string,
    }));
  }, 'sync');
}

function countEditorPageElements(doc: Y.Doc): number {
  let count = 0;
  doc.getMap<Y.Map<unknown>>('elements').forEach((el) => {
    if (el.get('pageId') === COMPONENT_EDITOR_PAGE_ID) count++;
  });
  return count;
}

describe('task-025: component editor instance cleanup', () => {
  it('does not accumulate orphan elements when reopening the same component', () => {
    const doc = new Y.Doc();

    // First open — fresh state, one root element on the editor page.
    openBlogPostInEditor(doc);
    expect(countEditorPageElements(doc)).toBe(1);

    // Simulate a sub-element added during the session (drawn slot, post
    // wrapper, instance child) — tagged to the editor page but NOT in
    // page.rootElementIds. The old rootIds-only cleanup left these behind.
    const elements = doc.getMap<Y.Map<unknown>>('elements');
    const orphan = new Y.Map();
    orphan.set('id', 'el-orphan');
    orphan.set('pageId', COMPONENT_EDITOR_PAGE_ID);
    elements.set('el-orphan', orphan);
    expect(countEditorPageElements(doc)).toBe(2);

    // Second open — must sweep the orphan along with the prior root.
    openBlogPostInEditor(doc);

    expect(countEditorPageElements(doc)).toBe(1);
  });
});
