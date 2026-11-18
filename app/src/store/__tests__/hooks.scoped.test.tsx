import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UndoProvider, useUndoContext } from '@/context/UndoContext';
import { applyCommand } from '../commands';
import { useScopedYjsValue, useYjsValue } from '../hooks';
import type { YjsScope } from '../scopedYjsSubscription';

const provider = vi.hoisted(() => ({ doc: null as Y.Doc | null }));
vi.mock('../EditorContext', () => ({ useEditorDoc: () => provider.doc }));
let doc: Y.Doc;
beforeEach(() => { doc = new Y.Doc(); provider.doc = doc; });
afterEach(() => { cleanup(); provider.doc?.destroy(); if (provider.doc !== doc) doc.destroy(); });

describe('useScopedYjsValue', () => {
  it('skips unrelated updates while the existing broad hook remains available', () => {
    doc.getMap('meta').set('currentPageId', 'home');
    const scoped = vi.fn((d: Y.Doc) => d.getMap('meta').get('currentPageId'));
    const broad = vi.fn(scoped.getMockImplementation()!);
    const { result } = renderHook(() => [
      useScopedYjsValue(scoped, [{ map: 'meta', keys: ['currentPageId'] }]), useYjsValue(broad),
    ]);
    scoped.mockClear(); broad.mockClear();
    act(() => { doc.getMap('sourceClasses').set('a', 'p-4'); });
    expect(scoped).not.toHaveBeenCalled(); expect(broad).toHaveBeenCalled();
    act(() => { doc.getMap('meta').set('currentPageId', 'about'); });
    expect(result.current).toEqual(['about', 'about']);
  });

  it('updates selection closure inputs without any document transaction or scope change', () => {
    doc.getMap('elements').set('a', 'first'); doc.getMap('elements').set('b', 'second');
    const { result, rerender } = renderHook(({ key }) => useScopedYjsValue(
      d => d.getMap('elements').get(key), [{ map: 'elements' }],
    ), { initialProps: { key: 'a' } });
    expect(result.current).toBe('first'); rerender({ key: 'b' }); expect(result.current).toBe('second');
  });

  it('switches key dependencies and stops observing the old key', () => {
    doc.getMap('elements').set('a', 'first'); doc.getMap('elements').set('b', 'second');
    const select = vi.fn((d: Y.Doc, key: string) => d.getMap('elements').get(key));
    const { result, rerender } = renderHook(({ key }) => useScopedYjsValue(
      d => select(d, key), [{ map: 'elements', keys: [key] }],
    ), { initialProps: { key: 'a' } });
    rerender({ key: 'b' }); expect(result.current).toBe('second'); select.mockClear();
    act(() => { doc.getMap('elements').set('a', 'ignored'); }); expect(select).not.toHaveBeenCalled();
    act(() => { doc.getMap('elements').set('b', 'updated'); }); expect(result.current).toBe('updated');
  });

  it('resets cached snapshot identity on provider document replacement even for equal values', () => {
    doc.getMap('elements').set('a', 'same');
    const select = (d: Y.Doc) => ({ value: d.getMap('elements').get('a') });
    const { result, rerender } = renderHook(() => useScopedYjsValue(select, [{ map: 'elements' }]));
    const previous = result.current;
    provider.doc = new Y.Doc(); provider.doc.getMap('elements').set('a', 'same');
    rerender(); expect(result.current).toEqual(previous); expect(result.current).not.toBe(previous);
    act(() => { doc.getMap('elements').set('a', 'old doc'); }); expect(result.current.value).toBe('same');
    act(() => { provider.doc!.getMap('elements').set('a', 'new doc'); }); expect(result.current.value).toBe('new doc');
  });

  it('keeps semantically equal map/key membership subscribed across new array identities', () => {
    const elements = doc.getMap('elements'); const observe = vi.spyOn(elements, 'observeDeep');
    const unobserve = vi.spyOn(elements, 'unobserveDeep');
    const { rerender } = renderHook(({ scopes }: { scopes: readonly YjsScope[] }) => useScopedYjsValue(
      d => d.getMap('elements').get('a'), scopes,
    ), { initialProps: { scopes: [{ map: 'elements', keys: ['b', 'a', 'a'] }] } });
    rerender({ scopes: [{ map: 'elements', keys: ['a'] }, { map: 'elements', keys: ['b'] }] });
    expect(observe).toHaveBeenCalledTimes(1); expect(unobserve).not.toHaveBeenCalled();
  });

  it('retains default deep equality and refreshes a changed equality function', () => {
    doc.getMap('elements').set('a', 1);
    const select = (d: Y.Doc) => ({ value: d.getMap('elements').get('a'), nested: ['stable'] });
    const { result, rerender } = renderHook(({ equal }) => useScopedYjsValue(select, [{ map: 'elements' }], equal), {
      initialProps: { equal: undefined as ((a: ReturnType<typeof select>, b: ReturnType<typeof select>) => boolean) | undefined },
    });
    const first = result.current;
    act(() => { doc.getMap('elements').set('other', 2); }); expect(result.current).toBe(first);
    rerender({ equal: () => true });
    act(() => { doc.getMap('elements').set('a', 3); }); expect(result.current).toBe(first);
    rerender({ equal: undefined }); expect(result.current.value).toBe(3);
  });

  it('observes snapshot undo/redo restoration through the actual UndoProvider', async () => {
    vi.stubGlobal('crypto', webcrypto);
    doc.getMap('meta').set('projectId', 'browser_scoped_undo');
    act(() => {
      applyCommand(doc, { type: 'ADD_PAGE', page: { id: 'home', name: 'Home', rootElementIds: [], children: [] } });
    });
    const { result } = renderHook(() => ({
      undo: useUndoContext(),
      name: useScopedYjsValue(d => (d.getMap('pages').get('home') as Y.Map<unknown>)?.get('name'), [{ map: 'pages', keys: ['home'] }]),
    }), { wrapper: UndoProvider });
    act(() => { result.current.undo.takeSnapshot(); });
    act(() => {
      doc.transact(() => { (doc.getMap('pages').get('home') as Y.Map<unknown>).set('name', 'Edited'); }, 'user');
    });
    expect(result.current.name).toBe('Edited');
    // Undo/redo are accepted durably before they publish, so they settle asynchronously.
    await act(async () => { await result.current.undo.undo(); }); expect(result.current.name).toBe('Home');
    await act(async () => { await result.current.undo.redo(); }); expect(result.current.name).toBe('Edited');
  });


  it('does not add snapshot executions when only the parent rerenders', () => {
    const scoped = vi.fn((d: Y.Doc) => d.getMap('meta').get('currentPageId'));
    const broad = vi.fn(scoped.getMockImplementation()!);
    const { rerender } = renderHook(() => {
      useScopedYjsValue(d => scoped(d), [{ map: 'meta', keys: ['currentPageId'] }]);
      useYjsValue(d => broad(d));
    });
    scoped.mockClear(); broad.mockClear();
    rerender();
    expect(scoped.mock.calls.length).toBe(broad.mock.calls.length);
  });

});
