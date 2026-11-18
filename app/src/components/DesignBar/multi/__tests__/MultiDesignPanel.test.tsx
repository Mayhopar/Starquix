/** The Design Bar while ≥2 elements are selected (design C1, C3, C4): "N elements", only the
 *  sections every block of which reads "Mixed" and declares what it owns (MULTI_READY). */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { multiWrapper } from './renderInMulti';

const h = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  scanned: new Map<string, { key: string; tagName: string; classes: string }>(),
  setClassesMany: vi.fn(async () => true),
}));
vi.mock('@/context/ClassStoreContext', () => ({
  useClassStore: () => ({ getStoredClasses: (k: string) => h.stored.get(k) ?? null, setClassesMany: h.setClassesMany }),
}));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElements: () => ({ scannedByKey: h.scanned }),
  useSelectedElement: () => ({ sourceLocation: null, boundAssetPath: null }),
}));
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => null }));
vi.mock('@/assets/icons', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const mocked: Record<string, unknown> = {};
  for (const key of Object.keys(actual)) mocked[key] = () => null;
  return mocked;
});
vi.mock('@/store/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/store/hooks')>();
  const Y = await import('yjs');
  const doc = new Y.Doc();
  return { ...actual, useEditorDoc: () => doc, useYjsValue: <T,>(selector: (d: import('yjs').Doc) => T) => selector(doc), useDispatch: () => () => true };
});
vi.mock('../../blocks/LayoutAppearanceBlock', () => ({ LayoutAppearanceBlock: () => <div data-testid="layout-block" /> }));
vi.mock('../../BlockOverridePills', async orig => ({
  ...await orig<typeof import('../../BlockOverridePills')>(),
  BlockOverridePills: () => <span data-testid="override-pills" />,
}));
import { MultiDesignPanel } from '../MultiDesignPanel';

const base = { breakpoint: 'xs', theme: 'light', state: 'default' } as const;
const seed = (rows: Array<[key: string, tag: string, classes: string]>) => {
  h.stored.clear(); h.scanned.clear();
  for (const [key, tagName, classes] of rows) { h.scanned.set(key, { key, tagName, classes }); h.stored.set(key, classes); }
};
const renderPanel = (keys: string[]) => render(<MultiDesignPanel memberKeys={keys} slot={base} />, { wrapper: multiWrapper(null) });

describe('MultiDesignPanel', () => {
  beforeEach(() => seed([['a', 'div', 'p-4 bg-red-500'], ['b', 'p', 'p-2 bg-blue-500']]));

  it('header reads "N elements"; only ready sections render; no override pills (C1, C3, C4)', () => {
    renderPanel(['a', 'b']);
    expect(screen.getByTestId('design-bar-heading').textContent).toBe('2 elements');
    expect(screen.getByText('Fill')).toBeTruthy();
    // Layout row carries Layout + Spacing
    expect(screen.getByLabelText('Padding Y')).toBeTruthy();
    expect(screen.getByTestId('layout-block')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Stroke')).toBeTruthy();
    expect(screen.getByText('Effects')).toBeTruthy();
    expect(screen.getByText('Position')).toBeTruthy();
    for (const title of ['Typography', 'Link', 'Data', 'Video', 'Path']) {
      expect(screen.queryByText(title)).toBeNull();
    }
    expect(screen.queryByTestId('override-pills')).toBeNull();
  });

  it('Typography shows only when EVERY member is text (C3)', () => {
    seed([['a', 'p', 'text-lg'], ['b', 'h2', 'text-sm']]);
    renderPanel(['a', 'b']);
    expect(screen.getByText('Typography')).toBeTruthy();
  });

  it('a member that vanished from the scan drops out of the count (C11)', () => {
    h.scanned.delete('b');
    renderPanel(['a', 'b']);
    expect(screen.getByTestId('design-bar-heading').textContent).toBe('1 element');
  });
});
