import 'fake-indexeddb/auto';
import { renderReadyEditorHook } from '@/test/renderReadyEditorHook';
/**
 * AI-origin transactions vs the DEV fold-detector (2026-07-23).
 *
 * AI runs intentionally take ONE snapshot per run (snapshotOnceAndDispatch in
 * useAIAgent) — every later mutation in the run folds into that step so one
 * Cmd+Z reverts the whole run. The detector at UndoContext warned
 * "user mutation without takeSnapshot" on each of those folds — noise.
 *
 * Fix: AI dispatches ride origin 'ai' (useDispatch's optional origin param).
 * 'ai' transactions are exempt from the warning but still disarm the
 * snapshot-armed flag, so an unarmed USER mutation right after an AI run is
 * still caught.
 *
 * Contract migration (c8535b79): every dispatch is a durable acceptance applied
 * under a `durable-edit:*` origin (useDispatch's origin arg is now ignored), so
 * dispatched edits never reach the detector; it only sees raw user/ai
 * transactions from legacy direct owners. Undo is async and needs a project id.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { UndoProvider, useUndoContext } from '../UndoContext';
// EditorProvider creates its OWN internal doc (ignores props) — read it back
// via useEditorDoc in the harness; never assert against an outside doc.
import { EditorProvider, useEditorDoc } from '@/store/EditorContext';
import { useDispatch } from '@/store';
import { emptyClassData } from '@/store/types';

const foldWarnings = (spy: ReturnType<typeof vi.spyOn>) =>
  spy.mock.calls.filter((c) => String(c[0]).includes('without takeSnapshot'));

describe('AI-origin mutations and the undo fold-detector', () => {
  let wrapper: React.FC<{ children: React.ReactNode }>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    const ProjectSeed = ({ children }: { children: React.ReactNode }) => {
      const doc = useEditorDoc();
      React.useLayoutEffect(() => { doc.getMap('meta').set('projectId', crypto.randomUUID()); }, [doc]);
      return <>{children}</>;
    };
    wrapper = ({ children }: { children: React.ReactNode }) => (
      <EditorProvider>
        <ProjectSeed><UndoProvider>{children}</UndoProvider></ProjectSeed>
      </EditorProvider>
    );
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const useHarness = () => ({ undoCtx: useUndoContext(), dispatch: useDispatch(), doc: useEditorDoc() });

  type Harness = { current: ReturnType<typeof useHarness> };
  const seedElement = async (result: Harness) => {
    // Properly snapshotted user actions, so seeding never trips the detector.
    act(() => result.current.undoCtx.takeSnapshot());
    await act(async () => { await result.current.dispatch({
      type: 'ADD_PAGE',
      page: { id: 'page-1', name: 'Test', rootElementIds: [], children: [] },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any); });
    act(() => result.current.undoCtx.takeSnapshot());
    await act(async () => { await result.current.dispatch({
      type: 'ADD_ELEMENT',
      element: { id: 'el-img', pageId: 'page-1', parentId: null, index: 0, type: 'image', classes: emptyClassData() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any); });
  };

  const imgAttr = (attribute: 'src' | 'alt', value: string) =>
    ({ type: 'UPDATE_IMAGE_ATTRIBUTE', elementId: 'el-img', attribute, value }) as const;

  it('AI run folds silently and ONE undo reverts it all — including the image src', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });

    await seedElement(result);
    // The AI run: snapshotOnceAndDispatch takes ONE snapshot, then every
    // dispatch rides origin 'ai'.
    act(() => result.current.undoCtx.takeSnapshot());
    await act(async () => {
      await result.current.dispatch(imgAttr('src', 'sq-asset:gen-1'), 'ai');
      await result.current.dispatch(imgAttr('alt', 'Generated hero'), 'ai');
    });

    expect(foldWarnings(warn)).toHaveLength(0);

    const attrs = () =>
      ((result.current.doc.getMap('elements').get('el-img') as Y.Map<unknown>)?.get('imageAttributes') as
        Y.Map<string> | undefined);
    expect(attrs()?.get('src')).toBe('sq-asset:gen-1');
    expect(attrs()?.get('alt')).toBe('Generated hero');

    await act(async () => { await result.current.undoCtx.undo(); });

    // The folded run reverts as ONE step — src AND alt both gone.
    expect(attrs()?.get('src')).toBeUndefined();
    expect(attrs()?.get('alt')).toBeUndefined();
  });

  it('detector still fires for an unarmed USER mutation — even right after an AI run', async () => {
    const { result } = await renderReadyEditorHook(useHarness, { wrapper });

    await seedElement(result);
    act(() => result.current.undoCtx.takeSnapshot());
    await act(async () => { await result.current.dispatch(imgAttr('src', 'sq-asset:gen-1'), 'ai'); });
    // User mutation with NO takeSnapshot: folds into the AI step unasked —
    // exactly what the detector exists to surface. Dispatches are invisible to
    // the detector (durable-edit origin), so this is a raw user transaction.
    act(() => {
      const doc = result.current.doc;
      doc.transact(() => {
        const yEl = doc.getMap('elements').get('el-img') as Y.Map<unknown>;
        (yEl.get('imageAttributes') as Y.Map<string>).set('alt', 'user edit');
      }, 'user');
    });

    expect(foldWarnings(warn)).toHaveLength(1);
  });
});
