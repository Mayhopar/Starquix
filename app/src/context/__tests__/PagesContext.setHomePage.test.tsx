import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { PagesProvider, usePages } from '../PagesContext';
import { EditorProvider } from '@/store/EditorContext';
import { UndoProvider, useUndoContext } from '../UndoContext';
import { useEditorDoc } from '@/store/hooks';
import { selectHomePageId } from '@/store/selectors';
import * as Y from 'yjs';

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
  return await renderReadyEditorHook(
    () => ({ pages: usePages(), undoCtx: useUndoContext(), doc: useEditorDoc() }),
    { wrapper },
  );
}

/** Create an old-home + other page pair; returns their ids. */
async function setupTwoPages(result: Awaited<ReturnType<typeof renderHarness>>['result']) {
  let oldHomeId = '';
  let otherId = '';
  await act(async () => {
    oldHomeId = await result.current.pages.createPage('Home');
    otherId = await result.current.pages.createPage('About');
    const doc = result.current.doc;
    (doc.getMap('pages').get(oldHomeId) as Y.Map<unknown>).set('isHome', true);
    doc.getMap('meta').set('projectId', 'proj-1');
  });
  return { oldHomeId, otherId };
}

describe('PagesContext.setHomePage', () => {
  beforeEach(() => {
  });

  it('flips the flag in Yjs (old home cleared)', async () => {
    const { result } = await renderHarness();
    const { oldHomeId, otherId } = await setupTwoPages(result);

    expect(selectHomePageId(result.current.doc)).toBe(oldHomeId);
    await act(async () => {
      await result.current.pages.setHomePage(otherId);
    });
    expect(selectHomePageId(result.current.doc)).toBe(otherId);
    expect((result.current.doc.getMap('pages').get(oldHomeId) as Y.Map<unknown>).get('isHome')).toBeUndefined();
  });

  it('is undoable as one step', async () => {
    const { result } = await renderHarness();
    const { oldHomeId, otherId } = await setupTwoPages(result);

    await act(async () => {
      await result.current.pages.setHomePage(otherId);
    });
    expect(selectHomePageId(result.current.doc)).toBe(otherId);

    await act(async () => {
      await result.current.undoCtx.undo();
    });
    expect(selectHomePageId(result.current.doc)).toBe(oldHomeId);
  });

  it('no-ops when the page is already home (no snapshot)', async () => {
    const { result } = await renderHarness();
    const { oldHomeId } = await setupTwoPages(result);

    await act(async () => {
      await result.current.pages.setHomePage(oldHomeId);
    });
    expect(selectHomePageId(result.current.doc)).toBe(oldHomeId);
  });
});
