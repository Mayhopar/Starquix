import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { applyCommand } from '@/store/commands';
import { emptyClassData, type EditorCommand } from '@/store/types';
import { COMPONENT_EDITOR_PAGE_ID } from '@/store/constants';
import { ensureLayoutElement, pageLayoutElementId } from '@/store/layoutElement';
import { acceptEditorCommands } from '@/store/commandGesture';
import { collectOrderCommands } from '@/utils/masterOrderWrite';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { flushDurableSourceWrites, registerSourceMaterializers } from '../sourceMaterialization';
import { startMaterializer } from '../materializer';
import { flushLayoutAppends, pendingLayoutAppendCount } from '@/services/pendingLayoutAppends';
import { setActiveSaveProjectId } from '@/services/pendingProjectMutations';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc }));
vi.mock('@/store/EditorContext', () => ({ useEditorDoc: () => h.doc }));
const file = 'src/layouts/Host.astro';
const before = '<header>Header</header>\n<footer>Footer</footer>\n';
const after = '<footer>Footer</footer>\n<header>Header</header>\n';
let projectId: string;
let runtime: ReturnType<typeof projectFsRuntime>;
let stop: (() => void) | undefined;
beforeEach(async () => {
  await db.delete(); await db.open(); projectId = `reorder-source-${crypto.randomUUID()}`;
  h.doc = new Y.Doc(); h.doc.getMap('meta').set('projectId', projectId);
  setActiveSaveProjectId(projectId); runtime = projectFsRuntime(projectId, { [file]: before });
});
afterEach(async () => { stop?.(); stop = undefined; cleanup(); await flushLayoutAppends(); runtime.close(); h.doc.destroy(); setActiveSaveProjectId(null); vi.restoreAllMocks(); });

it('undo uses receipt bytes when reordered same-tag siblings receive new positional selectors', async () => {
  const original = '<div>A</div>\n<div>B</div>\n'; writeFileSync(join(runtime.root, file), original);
  const { result } = renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
  await act(async () => {
    result.current.takeSnapshot();
    await acceptEditorCommands(h.doc, [], result.current.claimSnapshot(), [{ kind: 'source-batch', payload: {
      payloads: [{ astroSource: 'layouts/Host.astro', overrides: { orderOverrides: ['div-1', 'div-0'] } }], skipped: [],
    } }]);
  });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe('<div>B</div>\n<div>A</div>\n');
  await act(async () => { await result.current.undo(); }); await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(original);
});

it.each(['master', 'chrome'] as const)('%s reorder remains accepted and undoable through source materialization and reopen', async kind => {
  const pageId = kind === 'master' ? COMPONENT_EDITOR_PAGE_ID : 'page';
  applyCommand(h.doc, { type: 'ADD_PAGE', page: { id: pageId, name: 'Page', children: [], rootElementIds: [] } });
  applyCommand(h.doc, { type: 'SET_CURRENT_PAGE', pageId });
  let previous: string[]; let action: EditorCommand;
  if (kind === 'master') {
    for (const [id, markup] of [['el-header', '<header>Header</header>'], ['el-footer', '<footer>Footer</footer>']]) {
      applyCommand(h.doc, { type: 'ADD_THEME_INSTANCE', element: { id, pageId, parentId: null, index: 0,
        type: 'instance', themeId: id, componentPath: 'Host.astro', staticMarkup: markup, classes: emptyClassData() } });
    }
    previous = ['el-header:header-0', 'el-footer:footer-0'];
    action = { type: 'REORDER_PAGE_ELEMENTS', pageId, elementIds: ['el-footer', 'el-header'] };
  } else {
    ensureLayoutElement(h.doc, pageId, 'Host', before);
    const id = pageLayoutElementId(pageId);
    previous = [`${id}:header-0`, `${id}:footer-0`];
    action = { type: 'SET_CHILD_ORDER', pageId, parentKey: `${id}:root`, childKeys: [...previous].reverse() };
  }
  const { result } = renderHook(() => useUndoContext(), { wrapper: ({ children }) => <UndoProvider>{children}</UndoProvider> });
  registerSourceMaterializers(); stop = startMaterializer(projectId);
  await act(async () => {
    result.current.takeSnapshot();
    await acceptEditorCommands(h.doc, [action], result.current.claimSnapshot(),
      collectOrderCommands(h.doc, pageId, [...previous].reverse(), previous, { rootLevel: kind === 'master', viewedComponentFile: 'layouts/Host.astro' }));
  });
  expect(result.current.canUndo).toBe(true);
  if (kind === 'master') {
    expect(runtime.read(file)).toBe(before);
    expect(pendingLayoutAppendCount()).toBe(0);
    await flushLayoutAppends();
  } else await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(after);
  await act(async () => { await result.current.undo(); });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(before);
  await act(async () => { await result.current.redo(); });
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(after);
  runtime.restart(); db.close(); await db.open();
  await flushDurableSourceWrites(projectId);
  expect(runtime.read(file)).toBe(after);
  expect(await db.durableEdits.count()).toBe(3);
});
