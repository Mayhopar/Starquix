/**
 * `useElementClasses` must distinguish ABSENCE from EMPTINESS (task-149 review
 * fix).
 *
 * It used to answer '' for both "no entry in the sourceClasses tier" and "the
 * entry exists and holds no classes". DesignBar's class-merge base then fell
 * through on '' — the falsy value — to the scan payload and the ELEMENT_CLICK
 * payload, so an element the user had deliberately stripped bare got its old
 * classes RESURRECTED by the next colour click (and, in server/local mode,
 * written back into the real .astro).
 *
 * The user-visible half is pinned in
 * `components/DesignBar/__tests__/DesignBar.classMergeBase.test.tsx`; this is
 * the hook contract that half depends on.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';

const KEY = 'src/components/Header.astro:12:3';

const h = vi.hoisted(() => ({ doc: null as unknown as Y.Doc, dispatch: vi.fn() }));

vi.mock('@/store/hooks', () => ({
  useEditorDoc: () => h.doc,
  useDispatch: () => h.dispatch,
  useYjsValue: (sel: (doc: unknown) => unknown) => sel(h.doc),
}));
const hoistedUndo = vi.hoisted(() => ({
  ctx: { takeSnapshot: vi.fn(), isUndoingRef: { current: false } },
}));
vi.mock('@/context/UndoContext', () => ({
  // isUndoingRef is the authoritative undo signal the provider reads (task-150).
  // ONE stable object: the real UndoContext hands back the same ref every
  // render, and a fresh one per call re-subscribes the observers forever.
  useUndoContext: () => hoistedUndo.ctx,
}));

import { ClassStoreProvider, useClassStore, useElementClasses } from '../ClassStoreContext';

function Harness({ classes }: { classes: string }) {
  const value = useElementClasses(KEY);
  const { registerElement } = useClassStore();
  return (
    <>
      <span data-testid="value">{value === null ? 'ABSENT' : `[${value}]`}</span>
      <button data-testid="register" onClick={() => registerElement(KEY, classes)} />
    </>
  );
}

function mount(classes: string) {
  h.doc = new Y.Doc();
  render(
    <ClassStoreProvider>
      <Harness classes={classes} />
    </ClassStoreProvider>,
  );
}

describe('useElementClasses — absence vs emptiness', () => {
  it('returns null when the tier has NO entry for the key', () => {
    mount('whatever');
    expect(screen.getByTestId('value').textContent).toBe('ABSENT');
  });

  it('returns "" — not null — for an entry that exists and holds no classes', () => {
    mount('');
    fireEvent.click(screen.getByTestId('register'));
    expect(screen.getByTestId('value').textContent).toBe('[]');
  });

  it('returns the classes for a populated entry', () => {
    mount('text-2xl font-bold');
    fireEvent.click(screen.getByTestId('register'));
    expect(screen.getByTestId('value').textContent).toBe('[text-2xl font-bold]');
  });
});
