import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { emptyClassData } from '@/store/types';
import { addRootAt, insertTemplateComponents } from '@/store/pageTemplateInsert';
import { fillDrawnSlot } from '@/utils/fillDrawnSlot';
import { createPostPage } from '@/utils/createPostPage';
import { wrapPostPageInBlogPost } from '@/utils/wrapPostPageInBlogPost';
import { setHomePageAndPersist } from '@/store/homePage';
import { dispatchDurableAction } from '@/store/durableDispatch';
import type { ScannedComponent } from '@/hooks/useComponentLibrary';
import * as storage from '../store';
import { deleteOneEntry } from '@/hooks/keyboardShortcutsHelpers';
import { cutSelection } from '@/clipboard/clipboardActions';
import * as clipboard from '@/clipboard/systemClipboard';
import * as copyHtml from '@/clipboard/fetchElementCopyHtml';
import { convertElementSvgs } from '@/utils/convertElementSvgs';
import { generateCommandTools } from '@/ai/tools/commandTools';
import { makeCtx, type ExecTool } from '@/ai/tools/__tests__/testCtx';

const component: ScannedComponent = {
  name: 'Card', path: 'src/components/Card.astro', source: 'built-in', html: '<div>Card</div>',
  category: 'Test', props: [], slots: [], dependencies: [],
};
function fixture() {
  const doc = createEditorDoc();
  doc.getMap('meta').set('projectId', 'owner-project');
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-a', name: 'Home', isHome: true, rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-b', name: 'About', rootElementIds: [], children: [] } });
  applyCommand(doc, { type: 'ADD_ELEMENT', element: {
    id: 'el-a', pageId: 'page-a', parentId: null, index: 0, type: 'slot', classes: emptyClassData(),
  } });
  return doc;
}
beforeEach(async () => { await db.delete(); await db.open(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('structural gesture owners', () => {
  it.each(['update_element_by_key', 'add_page_content'])('accepts compound AI %s as one revision', async tool => {
    const doc = fixture();
    const ctx = makeCtx({ doc, dispatch: action => dispatchDurableAction(doc, action).then(() => true) });
    const params = tool === 'update_element_by_key'
      ? { sourceKey: 'el-a:div-0', classes: 'p-4', textContent: 'Updated' }
      : { pageId: 'page-a', type: 'component', staticMarkup: '<div><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg></div>' };
    const result = await (generateCommandTools(ctx)[tool] as ExecTool).execute(params);
    expect(result.success).toBe(true);
    expect(await db.durableEdits.count()).toBe(1);
  });
  it('returns the one accepted detail page to concurrent creators without orphan elements', async () => {
    const doc = fixture();
    const beforeElements = doc.getMap('elements').size;
    const [first, second] = await Promise.all([
      createPostPage(doc, 'collection-race', 'Posts', 'page-a'),
      createPostPage(doc, 'collection-race', 'Posts', 'page-a'),
    ]);
    expect(second).toBe(first);
    expect(doc.getMap('pages').has(first)).toBe(true);
    expect(doc.getMap('elements').size).toBe(beforeElements + 2);
    for (const element of doc.getMap<Y.Map<unknown>>('elements').values()) {
      expect(doc.getMap('pages').has(element.get('pageId') as string)).toBe(true);
    }
  });

  it('rejects a refused post-page move without accepting partial page or element state', async () => {
    const doc = fixture();
    const before = Y.encodeStateAsUpdate(doc);
    await expect(createPostPage(doc, 'collection-a', 'Posts', 'missing-parent')).rejects.toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(await db.durableEdits.count()).toBe(0);
  });

  const owners: Array<[string, (doc: Y.Doc) => unknown]> = [
    ['ordered picker insert', doc => addRootAt(doc, { type: 'ADD_ELEMENT', element: {
      id: 'el-new', pageId: 'page-a', parentId: null, index: 0, type: 'frame', classes: emptyClassData(),
    } }, 'page-a', 'el-new', 0)],
    ['template insertion', doc => insertTemplateComponents({ doc, pageId: 'page-a', components: [component], generateId: () => 'el-new' })],
    ['drawn slot fill', doc => fillDrawnSlot(doc, 'el-a', 'el-new', component)],
    ['post page creation', doc => createPostPage(doc, 'collection-a', 'Posts', 'page-a')],
    ['post wrapper', doc => wrapPostPageInBlogPost(doc, 'page-a', '<article><slot /></article>')],
  ];
  it.each(owners)('does not publish %s when storage rejects', async (_name, run) => {
    const doc = fixture();
    const before = Y.encodeStateAsUpdate(doc);
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const pending = Promise.resolve(run(doc));
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    await expect(pending).rejects.toThrow('quota');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(await db.durableEdits.count()).toBe(0);
  });

  it('does not report home-page success before rejected acceptance', async () => {
    const doc = fixture();
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const pending = setHomePageAndPersist({ doc, pageId: 'page-b', takeSnapshot: () => {},
      dispatch: action => dispatchDurableAction(doc, action),
    });
    await expect(Promise.resolve(pending)).rejects.toThrow('quota');
    expect(doc.getMap<Y.Map<unknown>>('pages').get('page-a')?.get('isHome')).toBe(true);
  });

  it('publishes a complete template in one accepted revision with pre-generated IDs', async () => {
    const doc = fixture();
    let next = 0;
    const pending = insertTemplateComponents({ doc, pageId: 'page-a', components: [component, component], generateId: () => `el-new-${next++}` });
    expect(next).toBe(2);
    expect(doc.getMap('elements').has('el-new-0')).toBe(false);
    const result = await pending;
    expect(result.addedIds).toEqual(['el-new-0', 'el-new-1']);
    expect(await db.durableEdits.count()).toBe(1);
    expect((doc.getMap<Y.Map<unknown>>('pages').get('page-a')?.get('rootElementIds') as Y.Array<string>).toArray()).toEqual(['el-a', 'el-new-0', 'el-new-1']);
  });

  it('does not remove the preview element when single delete acceptance rejects', async () => {
    const doc = fixture();
    const messages = vi.spyOn(window, 'postMessage');
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const pending = deleteOneEntry({ key: 'el-a', elementId: 'el-a' }, {
      doc, dispatch: action => dispatchDurableAction(doc, action), scannedElements: [],
    });
    await expect(Promise.resolve(pending)).rejects.toThrow('quota');
    expect(doc.getMap('elements').has('el-a')).toBe(true);
    expect(messages.mock.calls.filter(([message]) => message.type === 'SYNC_REMOVE_ELEMENT_FROM_DOM')).toEqual([]);
  });

  it('accepts all cut members in one revision before clearing selection', async () => {
    const doc = fixture();
    applyCommand(doc, { type: 'ADD_ELEMENT', element: {
      id: 'el-b', pageId: 'page-a', parentId: null, index: 1, type: 'frame', classes: emptyClassData(),
    } });
    vi.spyOn(clipboard, 'writeClipboardHtml').mockResolvedValue(true);
    vi.spyOn(copyHtml, 'fetchElementCopyHtml').mockResolvedValue('<div>Copied</div>');
    let selected = true;
    await cutSelection({
      doc, entries: ['el-a', 'el-b'].map(key => ({ key, elementId: key })), scannedByKey: new Map(), scannedElements: [],
      pageId: 'page-a', projectId: 'owner-project', selectedElementId: 'el-a', selectedKey: 'el-a', pageFile: null,
      dispatch: action => dispatchDurableAction(doc, action), takeSnapshot: () => {},
      clearSelection: () => { expect(doc.getMap('elements').has('el-b')).toBe(false); selected = false; },
      pushStructuralUndo: () => {}, deleteLocalGroup: async () => {},
    });
    expect(selected).toBe(false);
    expect(doc.getMap('elements').has('el-a')).toBe(false);
    expect(await db.durableEdits.count()).toBe(1);
  });

  it('keeps original SVG and drawn elements unchanged when conversion acceptance rejects', async () => {
    const doc = fixture();
    applyCommand(doc, { type: 'UPDATE_STATIC_MARKUP', elementId: 'el-a', staticMarkup:
      '<div><svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg></div>' });
    const before = Y.encodeStateAsUpdate(doc);
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const pending = convertElementSvgs(doc, 'el-a', 'page-a');
    await expect(Promise.resolve(pending)).rejects.toThrow('quota');
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  });

  it.each([
    ['update_page', { pageId: 'page-b', name: 'Updated' }],
    ['remove_page', { pageId: 'page-b' }],
    ['delete_element', { elementId: 'el-a' }],
    ['detach_layout', { pageId: 'page-a' }],
  ])('does not let AI %s report success before rejected acceptance', async (tool, params) => {
    const doc = fixture();
    const ctx = makeCtx({ doc, dispatch: action => dispatchDurableAction(doc, action).then(() => true) });
    vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
    const result = await (generateCommandTools(ctx)[tool as string] as ExecTool).execute(params);
    expect(result.success).toBe(false);
    expect(await db.durableEdits.count()).toBe(0);
  });
});
