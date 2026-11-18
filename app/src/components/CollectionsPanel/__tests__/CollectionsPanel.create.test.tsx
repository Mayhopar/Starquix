/**
 * Owner, 2026-09-12: "I click Create collection, native pop-up appears and
 * disappears immediately. So I cannot create anything." — the name came from
 * a native `prompt()`, which any attached automation client or extension
 * dismisses (and which freezes the browser extension's own tabs). The name is
 * an inline row now: `+` shows an input, Enter creates, Escape cancels.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { db } from '@/db';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { dispatchDurableAction } from '@/store/durableDispatch';
import * as storage from '@/services/durableEdits/store';
import { createCollectionOnDisk } from '@/core/collections/api';

let localPath: string | null = '/Users/me/site';
let doc: Y.Doc;
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));

const mockCreatePost = vi.fn().mockResolvedValue(undefined);
vi.mock('@/core/collections/content-ops', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  contentOps: { createPost: (...a: unknown[]) => mockCreatePost(...a), deletePost: vi.fn(), deleteCollection: vi.fn() },
}));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [], isLoading: false }) }));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => localPath }));
vi.mock('@/store/hooks', () => ({ useYjsValue: (selector: (doc: Y.Doc) => unknown) => selector(doc), useDispatch: () => (action: Parameters<typeof dispatchDurableAction>[1]) => dispatchDurableAction(doc, action), useEditorDoc: () => doc }));
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: vi.fn() }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ openPost: vi.fn(), closePost: vi.fn(), editingPost: null }) }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ setActiveCollectionId: vi.fn() }) }));
vi.mock('@/core/collections/api', () => ({ createCollectionOnDisk: vi.fn() }));
const createLocal = vi.fn().mockResolvedValue('untitled-1');
vi.mock('@/components/Editor/localBlogScaffold', () => ({ createLocalCollection: (...a: unknown[]) => createLocal(...a) }));

import { CollectionsPanel } from '../CollectionsPanel';

beforeEach(async () => {
  vi.clearAllMocks(); window.prompt = vi.fn(); localPath = '/Users/me/site';
  await db.delete(); await db.open();
  doc = createEditorDoc(); doc.getMap('meta').set('projectId', 'collection-storage');
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-a', name: 'Home', rootElementIds: [], children: [] } });
});
afterEach(() => vi.restoreAllMocks());

describe('CollectionsPanel — new collection', () => {
  it('accepts the collection and its detail page as one revision', async () => {
    localPath = null;
    render(<CollectionsPanel />);
    fireEvent.click(screen.getByTitle('New collection'));
    fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'blog' } });
    fireEvent.keyDown(screen.getByLabelText('Collection name'), { key: 'Enter' });
    await waitFor(() => expect(createCollectionOnDisk).toHaveBeenCalled());
    expect(await db.durableEdits.count()).toBe(1);
    expect(doc.getMap('pages').size).toBe(2);
  });
  it('owns rejected nonlocal collection and detail-page storage before follow-up writes', async () => {
    localPath = null;
    const storageSpy = vi.spyOn(storage, 'acceptStoredEdit');
    storageSpy.mockRejectedValueOnce(new Error('quota'));
    const events: string[] = [];
    const capture = () => { events.push('expand'); };
    window.addEventListener('sq:expand-page', capture);
    try {
      render(<CollectionsPanel />);
      fireEvent.click(screen.getByTitle('New collection'));
      fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'blog' } });
      fireEvent.keyDown(screen.getByLabelText('Collection name'), { key: 'Enter' });
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/collection.*quota/i)));
      expect(events).toEqual([]);
      expect(createCollectionOnDisk).not.toHaveBeenCalled();
      expect(doc.getMap('pages').size).toBe(1);
      expect(doc.getMap('contentCollections').size).toBe(0);
    } finally { window.removeEventListener('sq:expand-page', capture); }
  });

  it('+ shows an inline name input (no native prompt); Enter creates the collection through the shared files-truth create', async () => {
    render(<CollectionsPanel />);
    fireEvent.click(screen.getByTitle('New collection'));
    const input = screen.getByLabelText('Collection name') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  blog ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.prompt).not.toHaveBeenCalled();
    // Seed post + post route (owner report 2026-09-28) live in createLocalCollection — see localBlogScaffold.test.
    await waitFor(() => expect(createLocal).toHaveBeenCalledWith('blog', '/Users/me/site'));
    expect(screen.queryByLabelText('Collection name')).toBeNull();
  });

  it('Escape or an empty name cancels without creating', () => {
    render(<CollectionsPanel />);
    fireEvent.click(screen.getByTitle('New collection'));
    fireEvent.keyDown(screen.getByLabelText('Collection name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Collection name')).toBeNull();
    fireEvent.click(screen.getByTitle('New collection'));
    fireEvent.keyDown(screen.getByLabelText('Collection name'), { key: 'Enter' });
    expect(createLocal).not.toHaveBeenCalled();
  });
});
