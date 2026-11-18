import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { UndoProvider, useUndoContext } from './UndoContext';
import { applyCommand } from '@/store/commands';
import { pushInstanceToSource } from '@/store/instanceLifecycle';
import { BLOG_SLOT_DEFAULTS_KEY, BLOG_SLOT_COMPONENT_TYPE } from '@/core/collections/types';
import {
  readBlogSettingsRaw,
  readMasterSettingsRev,
  readInstanceSettingsBaseRev,
} from '@/core/collections/yjsAccessors';

const mockDoc = new Y.Doc();
// Undo is a durable acceptance (7932857b): needs a project id + IndexedDB.
// takeSnapshot is a pending checkpoint committed by the next user-origin
// transaction (c8535b79), so the test mutations run under origin 'user'.
mockDoc.getMap('meta').set('projectId', 'proj-blog-bindings');
const user = (fn: () => void) => mockDoc.transact(fn, 'user');
vi.mock('@/store/EditorContext', () => ({
  useEditorDoc: () => mockDoc,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <UndoProvider>{children}</UndoProvider>
);

function seedBinding(slotKey: string, collectionId: string) {
  const blogBindings = mockDoc.getMap('blogSlotBindings');
  const ySlot = new Y.Map<unknown>();
  ySlot.set('collectionId', collectionId);
  const ySettings = new Y.Map<unknown>();
  ySettings.set('postsPerPage', 7);
  ySlot.set('settings', ySettings);
  const yB = new Y.Map<unknown>();
  yB.set('slot:h3-0', 'title');
  ySlot.set('bindings', yB);
  blogBindings.set(slotKey, ySlot);
}

describe('UndoSnapshot covers blogSlotBindings (task-037/038 AC4)', () => {
  beforeEach(() => {
    mockDoc.getMap('blogSlotBindings').clear();
  });

  it('createSnapshot captures collectionId, settings and field bindings', () => {
    seedBinding('el-1', 'col-blog');
    const { result } = renderHook(() => useUndoContext(), { wrapper });
    const snap = result.current.createSnapshot();
    expect(snap.blogSlotBindings['el-1'].collectionId).toBe('col-blog');
    expect(snap.blogSlotBindings['el-1'].settings.postsPerPage).toBe(7);
    expect(snap.blogSlotBindings['el-1'].bindings['slot:h3-0']).toBe('title');
  });

  it('undo restores a rebind (collectionId flips back)', async () => {
    seedBinding('el-1', 'col-blog');
    const { result } = renderHook(() => useUndoContext(), { wrapper });
    act(() => { result.current.takeSnapshot(); });
    act(() => { user(() => (mockDoc.getMap('blogSlotBindings').get('el-1') as Y.Map<unknown>).set('collectionId', 'col-news')); });
    await act(async () => { await result.current.undo(); });
    expect((mockDoc.getMap('blogSlotBindings').get('el-1') as Y.Map<unknown>).get('collectionId')).toBe('col-blog');
  });

  it('undo restores a fully deleted binding entry', async () => {
    seedBinding('el-1', 'col-blog');
    const { result } = renderHook(() => useUndoContext(), { wrapper });
    act(() => { result.current.takeSnapshot(); });
    act(() => { user(() => mockDoc.getMap('blogSlotBindings').delete('el-1')); });
    await act(async () => { await result.current.undo(); });
    const restored = mockDoc.getMap('blogSlotBindings').get('el-1') as Y.Map<unknown> | undefined;
    expect(restored).toBeDefined();
    expect(restored!.get('collectionId')).toBe('col-blog');
    expect((restored!.get('settings') as Y.Map<unknown>).get('postsPerPage')).toBe(7);
    expect((restored!.get('bindings') as Y.Map<unknown>).get('slot:h3-0')).toBe('title');
  });
});

describe('UndoSnapshot carries settingsRev/settingsBaseRev (task-102)', () => {
  beforeEach(() => {
    mockDoc.getMap('blogSlotBindings').clear();
    mockDoc.getMap('elements').clear();
  });

  it('undo restores sparse settings AND both rev fields after a push', async () => {
    // Pre-push state: master rev 1, instance override with baseRev 1.
    applyCommand(mockDoc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: BLOG_SLOT_DEFAULTS_KEY, settings: { sortBy: 'title-asc' } }); // rev 1
    const el = new Y.Map<unknown>();
    el.set('id', 'el-1'); el.set('pageId', 'page-1');
    el.set('astroSource', 'BlogSlot.astro');
    el.set('staticMarkup', '<div/>');
    el.set('componentType', BLOG_SLOT_COMPONENT_TYPE);
    mockDoc.getMap<Y.Map<unknown>>('elements').set('el-1', el);
    applyCommand(mockDoc, { type: 'UPDATE_BLOG_SLOT_SETTINGS', slotKey: 'el-1', settings: { postsPerPage: 6 } }); // baseRev 1

    const { result } = renderHook(() => useUndoContext(), { wrapper });
    // pushInstanceToSource is an async durable acceptance; it requests a
    // DEFERRED checkpoint (takeSnapshot(..., true)) and commits it on success.
    let pushed: { ok: boolean; reason?: string } | undefined;
    await act(async () => {
      pushed = await pushInstanceToSource({
        doc: mockDoc,
        dispatch: (c) => applyCommand(mockDoc, c),
        takeSnapshot: result.current.takeSnapshot,
        instanceId: 'el-1', astroSource: 'BlogSlot.astro', currentPageId: 'page-1',
      });
    });
    expect(pushed).toEqual({ ok: true });
    // Post-push: master rev 2, instance cleared with baseRev 2.
    expect(readMasterSettingsRev(mockDoc)).toBe(2);
    expect(readBlogSettingsRaw(mockDoc, 'el-1')).toEqual({});
    expect(readInstanceSettingsBaseRev(mockDoc, 'el-1')).toBe(2);

    await act(async () => { await result.current.undo(); });

    // Pre-push state restored EXACTLY: sparse override + both revs.
    expect(readMasterSettingsRev(mockDoc)).toBe(1);
    expect(readBlogSettingsRaw(mockDoc, 'el-1')).toEqual({ postsPerPage: 6 });
    expect(readInstanceSettingsBaseRev(mockDoc, 'el-1')).toBe(1);
    expect(readBlogSettingsRaw(mockDoc, BLOG_SLOT_DEFAULTS_KEY)).toEqual({ sortBy: 'title-asc' });
  });
});
