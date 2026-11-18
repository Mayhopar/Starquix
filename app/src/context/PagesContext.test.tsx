import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, waitFor } from '@testing-library/react';
import { PagesProvider, usePages } from './PagesContext';
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { UndoProvider, useUndoContext } from './UndoContext';
import { markFilesTruth, unmarkFilesTruth, filesTruthPath } from '@/utils/localMode';
import { applyCommand } from '@/store/commands';
import { projectFsRuntime } from '@/test/projectFsRuntime';
import { flushDurableSourceWrites } from '@/services/durableEdits/sourceMaterialization';
import { useLayoutEffect, type ReactNode } from 'react';
import { contentOps } from '@/core/collections/content-ops';

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

describe('PagesContext', () => {
  it('provides activePageId as null initially', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });
    expect(result.current.activePageId).toBe(null);
  });

  it('createPage creates a new page and returns its ID', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    let pageId: string;
    await act(async () => {
      pageId = await result.current.createPage('Test Page');
    });

    expect(pageId!).toMatch(/^page-/);
    expect(result.current.pages.some(p => p.id === pageId)).toBe(true);
    expect(result.current.pages.find(p => p.id === pageId)?.name).toBe('Test Page');
  });

  it('setActivePage updates the active page', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    let pageId: string;
    await act(async () => {
      pageId = await result.current.createPage('Test Page');
    });

    await act(async () => {
      result.current.setActivePage(pageId!);
    });

    expect(result.current.activePageId).toBe(pageId!);
  });

  it('toggleExpanded manages expanded state', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    expect(result.current.expandedIds.has('page-1')).toBe(false);

    await act(async () => {
      result.current.toggleExpanded('page-1');
    });
    expect(result.current.expandedIds.has('page-1')).toBe(true);

    await act(async () => {
      result.current.toggleExpanded('page-1');
    });
    expect(result.current.expandedIds.has('page-1')).toBe(false);
  });

  it('expandPages adds multiple pages to expanded set', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    await act(async () => {
      result.current.expandPages(['page-1', 'page-2']);
    });

    expect(result.current.expandedIds.has('page-1')).toBe(true);
    expect(result.current.expandedIds.has('page-2')).toBe(true);
  });

  it('renamePage updates page name', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    let pageId: string;
    await act(async () => {
      pageId = await result.current.createPage('Original Name');
    });

    await act(async () => {
      await result.current.renamePage(pageId!, 'New Name');
    });

    expect(result.current.pages.find(p => p.id === pageId)?.name).toBe('New Name');
  });

  it('deletePage removes the page', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    let pageId: string;
    let otherPageId: string;
    await act(async () => {
      otherPageId = await result.current.createPage('Other Page');
      pageId = await result.current.createPage('Test Page');
    });

    expect(result.current.pages.some(p => p.id === pageId)).toBe(true);

    await act(async () => {
      await result.current.deletePage(pageId!);
    });

    expect(result.current.pages.some(p => p.id === pageId)).toBe(false);
    expect(result.current.pages.some(p => p.id === otherPageId)).toBe(true);
  });

  it('deletePage does not delete the last page', async () => {
    const { result } = await renderReadyEditorHook(() => usePages(), { wrapper });

    let pageId: string;
    await act(async () => {
      pageId = await result.current.createPage('Only Page');
    });

    expect(result.current.pages.length).toBe(1);

    await act(async () => {
      await result.current.deletePage(pageId!);
    });

    expect(result.current.pages.some(p => p.id === pageId)).toBe(true);
    expect(result.current.pages.length).toBe(1);
  });
});

// task-148: in LOCAL mode the page row is backed by a REAL src/pages file, so
// deletePage routes through the file-first helper and pushes a STRUCTURAL undo
// entry (bytes + route) instead of a doc snapshot — ⌘Z writes the file back.
describe('PagesContext deletePage — local mode (task-148)', () => {
  const LOCAL_ID = 'browser_site';
  const LOCAL_PATH = filesTruthPath(LOCAL_ID);

  const localHook = () => ({ pages: usePages(), doc: useEditorDoc(), undo: useUndoContext() });

  beforeEach(() => {
    localStorage.clear();
    markFilesTruth(LOCAL_ID);
  });
  afterEach(() => { vi.restoreAllMocks(); unmarkFilesTruth(LOCAL_ID); localStorage.clear(); });

  // Pages are seeded with the raw command (not createPage) so the undo stack
  // starts EMPTY — that is what makes the "no snapshot" assertion meaningful.
  const setup = async (localId = LOCAL_ID) => {
    const { result } = await renderReadyEditorHook(localHook, { wrapper });
    await act(async () => {
      applyCommand(result.current.doc, { type: 'ADD_PAGE', page: { id: 'index', name: '/', rootElementIds: [], children: [] } });
      applyCommand(result.current.doc, { type: 'ADD_PAGE', page: { id: 'about', name: '/about', rootElementIds: [], children: [] } });
      result.current.doc.getMap('meta').set('projectId', localId);
    });
    return result;
  };

  // Contract migration (files-truth durable acceptance, fdd2d12f/87a0781c):
  // the delete is planned through the in-instance route table
  // (/__sq/local/page-plan via localFetch, never a direct fetch) and accepted
  // as ONE file edit; its undo replays the page-restore as ONE acceptance. So
  // the endpoint is a real project-fs runtime and the evidence is the bytes.
  it('calls the file-first delete endpoint and drops the doc page only on success', async () => {
    const localId = `browser_site_${crypto.randomUUID()}`;
    markFilesTruth(localId);
    const ABOUT = 'src/pages/about.astro';
    const runtime = projectFsRuntime(localId, { 'src/pages/index.astro': '<html>home</html>', [ABOUT]: '<html>about</html>' });
    try {
      const result = await setup(localId);
      const pageId = 'about';

      await act(async () => { await result.current.pages.deletePage(pageId); });

      await waitFor(() => expect(result.current.pages.pages.some(p => p.id === pageId)).toBe(false));
      await flushDurableSourceWrites(localId);
      expect(() => runtime.read(ABOUT)).toThrow(); // the REAL file is gone
      // ONE undoable step, and it restores the FILE: ⌘Z writes the bytes back
      // and the row returns. (No doc snapshot stacked on top — that would make
      // ⌘Z take two presses, the second restoring nothing.)
      await waitFor(() => expect(result.current.undo.canUndo).toBe(true));
      await act(async () => { await result.current.undo.undo(); });
      await flushDurableSourceWrites(localId);
      expect(runtime.read(ABOUT)).toBe('<html>about</html>');
      expect(result.current.pages.pages.some(p => p.id === pageId)).toBe(true);
      expect(result.current.undo.canUndo).toBe(false); // exactly one step
    } finally { runtime.close(); unmarkFilesTruth(localId); }
  });

  // Owner 2026-11-10: delete anything AND undo — a post page deletes its POST file at once, one ⌘Z brings it back.
  it('a post page: deleted at once (no question), ONE ⌘Z brings the post file and the row back', async () => {
    const localId = `browser_site_${crypto.randomUUID()}`;
    markFilesTruth(localId);
    const POST = 'src/content/works/Timepad.mdx', bytes = '---\ntitle: T\n---\nbody\n';
    const runtime = projectFsRuntime(localId, {
      'src/pages/index.astro': '<html>home</html>', 'src/pages/works/[slug].astro': '<html>post</html>', [POST]: bytes,
    });
    vi.spyOn(contentOps, 'fetchCollections').mockResolvedValue([
      { name: 'works', posts: [{ slug: 'Timepad', frontmatter: {}, body: '' }], inferredFields: [] },
    ] as never);
    try {
      const result = await setup(localId);
      await act(async () => {
        applyCommand(result.current.doc, { type: 'ADD_PAGE', page: { id: 'works-timepad', name: '/works/timepad', rootElementIds: [], children: [] } });
      });
      await act(async () => { await result.current.pages.deletePage('works-timepad'); });
      await flushDurableSourceWrites(localId);
      expect(() => runtime.read(POST)).toThrow();
      expect(result.current.pages.pages.some(p => p.id === 'works-timepad')).toBe(false);
      await waitFor(() => expect(result.current.undo.canUndo).toBe(true));
      await act(async () => { await result.current.undo.undo(); });
      await flushDurableSourceWrites(localId);
      expect(runtime.read(POST)).toBe(bytes);
      expect(result.current.pages.pages.some(p => p.id === 'works-timepad')).toBe(true);
      expect(result.current.undo.canUndo).toBe(false); // exactly one step
    } finally { runtime.close(); unmarkFilesTruth(localId); }
  });

  it('endpoint refusal leaves the page row in place (no ghost delete)', async () => {
    const result = await setup();
    const pageId = 'about';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'nope' }), { status: 400 }),
    );

    await act(async () => { await result.current.pages.deletePage(pageId); });

    await waitFor(() => expect(vi.mocked(globalThis.fetch)).toHaveBeenCalled());
    expect(result.current.pages.pages.some(p => p.id === pageId)).toBe(true);
    expect(result.current.undo.canUndo).toBe(false); // nothing happened, nothing to undo
  });

  it('non-local projects are byte-identical: doc-only delete, snapshot taken, no fetch', async () => {
    const { result } = await renderReadyEditorHook(localHook, { wrapper });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    let pageId = '';
    await act(async () => {
      await result.current.pages.createPage('Home');
      pageId = await result.current.pages.createPage('About');
      result.current.doc.getMap('meta').set('projectId', 'browser_x');
    });

    await act(async () => { await result.current.pages.deletePage(pageId); });

    expect(result.current.pages.pages.some(p => p.id === pageId)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.undo.canUndo).toBe(true);
  });
});
