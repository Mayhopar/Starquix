import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
// Pages-lifecycle parity (2026-08-12 sweep, gaps 23/24/26): PagesContext in
// the LOCAL (files-truth) runtime.
// - renamePage routes through renameLocalDocPage (REAL file rename, doc rekey
//   on success) instead of a cosmetic doc-only RENAME_PAGE.
// - setHomePage refuses honestly (the badge must not lie — the doc flag would
//   revert on reopen; home is whatever index.astro serves).
// - movePage reorders at root and the order persists on the project row
//   (the open-time seed sorts by it); a drop ONTO a page (nesting) is a no-op.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import * as Y from 'yjs';
import { PagesProvider, usePages } from '../PagesContext';
import { EditorProvider } from '@/store/EditorContext';
import { UndoProvider } from '../UndoContext';
import { useEditorDoc } from '@/store/hooks';
import { selectHomePageId } from '@/store/selectors';
import { markFilesTruth, filesTruthPath, PROJECT_NOT_READY } from '@/utils/localMode';
import { renameLocalDocPage, LOCAL_HOME_IS_INDEX } from '@/utils/localPageSync';
import { db } from '@/db';
import toast from 'react-hot-toast';

vi.mock('@/utils/localPageSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/localPageSync')>();
  return { ...actual, renameLocalDocPage: vi.fn(async () => 'renamed-id') };
});
vi.mock('@/store/useProjectSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/useProjectSync')>();
  return { ...actual, savePageNow: vi.fn(async () => {}), saveNewPage: vi.fn(async () => {}) };
});
vi.mock('react-hot-toast', () => {
  const t = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { default: t };
});

const mockRename = renameLocalDocPage as ReturnType<typeof vi.fn>;
const LOCAL_ID = 'browser_my-astro-site';
const LOCAL_PATH = filesTruthPath(LOCAL_ID);

// createPage / renamePage are durable acceptances (7932857b): seed a
// (non-local) project id so the pre-flip setup can accept its pages.
function ProjectSeed({ children }: { children: ReactNode }) {
  const doc = useEditorDoc();
  useLayoutEffect(() => { doc.getMap('meta').set('projectId', crypto.randomUUID()); }, [doc]);
  return children;
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <EditorProvider><ProjectSeed>
    <UndoProvider>
      <PagesProvider>{children}</PagesProvider>
    </UndoProvider>
  </ProjectSeed></EditorProvider>
);

async function renderHarness() {
  return await renderReadyEditorHook(() => ({ pages: usePages(), doc: useEditorDoc() }), { wrapper });
}

/** Two pages created BEFORE the project id flips local (createPage has its own
 *  local branch); then stamp the local project id. */
async function setupLocal(result: Awaited<ReturnType<typeof renderHarness>>['result']) {
  let homeId = '';
  let otherId = '';
  await act(async () => {
    homeId = await result.current.pages.createPage('Home');
    otherId = await result.current.pages.createPage('About');
  });
  act(() => {
    const doc = result.current.doc;
    (doc.getMap('pages').get(homeId) as Y.Map<unknown>).set('isHome', true);
    doc.getMap('meta').set('projectId', LOCAL_ID);
  });
  return { homeId, otherId };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  markFilesTruth(LOCAL_ID);
  mockRename.mockResolvedValue('renamed-id');
});

describe('PagesContext.renamePage (local)', () => {
  it('routes through renameLocalDocPage — never a doc-only RENAME_PAGE', async () => {
    const { result } = await renderHarness();
    const { otherId } = await setupLocal(result);
    await act(async () => {
      result.current.pages.renamePage(otherId, 'Team');
    });
    expect(mockRename).toHaveBeenCalledWith(result.current.doc, LOCAL_PATH, otherId, 'Team', expect.any(Function));
    // The doc name is untouched by the context — the helper owns the rekey.
    expect((result.current.doc.getMap('pages').get(otherId) as Y.Map<unknown>).get('name')).toBe('About');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('surfaces the endpoint refusal as a toast', async () => {
    mockRename.mockRejectedValue(new Error('A page for /team already exists'));
    const { result } = await renderHarness();
    const { otherId } = await setupLocal(result);
    await act(async () => {
      result.current.pages.renamePage(otherId, 'Team');
    });
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/^Couldn't rename the page/));
  });

  it('non-local pin: renamePage still edits the doc', async () => {
    const { result } = await renderHarness();
    let id = '';
    await act(async () => {
      id = await result.current.pages.createPage('Home');
    });
    act(() => {
      result.current.doc.getMap('meta').set('projectId', 'browser_xyz');
    });
    await act(async () => {
      await result.current.pages.renamePage(id, 'Landing');
    });
    expect((result.current.doc.getMap('pages').get(id) as Y.Map<unknown>).get('name')).toBe('Landing');
    expect(mockRename).not.toHaveBeenCalled();
  });
});

describe('PagesContext.setHomePage (local)', () => {
  it('refuses honestly — the Home badge never flips', async () => {
    const { result } = await renderHarness();
    const { homeId, otherId } = await setupLocal(result);
    act(() => {
      result.current.pages.setHomePage(otherId);
    });
    expect(toast.error).toHaveBeenCalledWith(LOCAL_HOME_IS_INDEX);
    expect(selectHomePageId(result.current.doc)).toBe(homeId);
    expect((result.current.doc.getMap('pages').get(otherId) as Y.Map<unknown>).get('isHome')).toBeUndefined();
  });
});

describe('PagesContext.movePage (local)', () => {
  it('reorders and persists the order — no session-only refusal (owner 2026-09-24)', async () => {
    await db.projects.put({ id: LOCAL_ID, name: 'site', pagesTree: [], createdAt: new Date(), updatedAt: new Date() } as never);
    const { result } = await renderHarness();
    const { homeId, otherId } = await setupLocal(result);
    await act(async () => { await result.current.pages.movePage(otherId, null, 0); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.doc.getArray('rootPages').toArray()).toEqual([otherId, homeId]);
    await vi.waitFor(async () => expect((await db.projects.get(LOCAL_ID))?.pageOrder).toEqual(['About', 'Home']));
  });

  it('a drop onto a page (nesting) does nothing — routes cannot nest', async () => {
    const { result } = await renderHarness();
    const { homeId, otherId } = await setupLocal(result);
    const before = result.current.doc.getArray('rootPages').toArray();
    await act(async () => { await result.current.pages.movePage(otherId, homeId, 0); });
    expect(toast.error).not.toHaveBeenCalled();
    expect(result.current.doc.getArray('rootPages').toArray()).toEqual(before);
    const homeChildren = (result.current.doc.getMap('pages').get(homeId) as Y.Map<unknown>).get('children') as Y.Array<string>;
    expect(homeChildren.toArray()).toEqual([]);
  });
});

it('does not announce an old page mutation failure in a new project', async () => {
  let fail!: (error: Error) => void;
  mockRename.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const { result } = await renderHarness();
  const { otherId } = await setupLocal(result);
  act(() => { result.current.pages.renamePage(otherId, 'Team'); });
  act(() => { result.current.doc.getMap('meta').set('projectId', 'browser_another'); });
  await act(async () => { fail(new Error('OLD_PRIVATE_PATH')); await Promise.resolve(); });
  expect(toast.error).not.toHaveBeenCalled();
});
