import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import toast from 'react-hot-toast';
import { db } from '@/db';
import { createEditorDoc } from '@/store/createEditorDoc';
import { applyCommand } from '@/store/commands';
import { createDefaultCollection } from '@/core/collections/types';
import * as storage from '@/services/durableEdits/store';
import { useGoToPost } from '../useGoToPost';

let doc: Y.Doc;
let activePage = 'page-a';
let preview: string | null = null;
vi.mock('@/store/hooks', () => ({ useEditorDoc: () => doc }));
vi.mock('@/context/PagesContext', () => ({ usePages: () => ({ setActivePage: (id: string) => { activePage = id; }, expandPages: () => {} }) }));
vi.mock('@/context/PostEditorContext', () => ({ usePostEditor: () => ({ setPreviewPost: (_collection: string, slug: string) => { preview = slug; } }) }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn() } }));
beforeEach(async () => {
  await db.delete(); await db.open();
  doc = createEditorDoc(); doc.getMap('meta').set('projectId', 'go-to-post');
  applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'page-a', name: 'Home', rootElementIds: [], children: [] } });
  activePage = 'page-a'; preview = null;
});
afterEach(() => vi.restoreAllMocks());

it('owns rejected detail-page acceptance without navigating or selecting a preview', async () => {
  const collection = createDefaultCollection('blog');
  applyCommand(doc, { type: 'ADD_CONTENT_COLLECTION', collection });
  const before = Y.encodeStateAsUpdate(doc);
  vi.spyOn(storage, 'acceptStoredEdit').mockRejectedValueOnce(new Error('quota'));
  const { result } = renderHook(() => useGoToPost());
  await expect(result.current(collection.id, 'first-post', 'page-a')).resolves.toBeUndefined();
  expect(activePage).toBe('page-a');
  expect(preview).toBeNull();
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/post.*quota/i));
});
