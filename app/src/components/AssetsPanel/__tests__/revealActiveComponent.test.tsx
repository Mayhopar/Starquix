/** Owner 2026-10-11: a selected element of an open component must be visible on
 * the left — opening it expands every folder on its path (guard).
 * (harness copied from collectionFolders.assets.test.tsx)
 * The Blog section: every card once, no folder per collection; moving a card
 * only reorganizes (folders are notes); Delete swaps the card in its lists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as Y from 'yjs';
import { DEFAULT_CARD } from '@/utils/cardFields';
import { IMPORTED_CARD } from '@/utils/__tests__/fixtures/cards';

const WORK = 'src/components/WorkCard.astro';
const NOTE = 'src/components/NoteCard.astro';
const BASIC = 'src/components/BlogCard.astro';
const h = vi.hoisted(() => ({
  onMove: null as null | ((id: string, parent: string | null, index: number) => void),
  dndDisabled: new Map<string, unknown>(),
  rewrite: vi.fn(),
  rewriteOne: vi.fn(),
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  saveManifest: vi.fn(),
  takeSnapshot: vi.fn(),
  snapshot: { commit: () => {} },
  files: {} as Record<string, string>,
  assignments: new Map<string, { card: boolean; collections: string[]; typed: string | null; conflict: string[] }>(),
}));

const comp = (name: string, path: string) => ({ name, path, source: 'user-project', html: '', category: 'Blog', props: [], slots: [], dependencies: [], pageTemplate: null });
vi.mock('@/hooks/useLocalProjectPath', () => ({ useLocalProjectPath: () => 'wc://browser_abc' }));
vi.mock('@/hooks/useComponentFileOps', () => ({ useComponentFileOps: () => ({ create: vi.fn(), rename: vi.fn(), remove: vi.fn(), promote: vi.fn() }) }));
vi.mock('@/hooks/useComponentLibrary', () => ({
  useComponentLibrary: () => ({ builtIn: [], userProject: [comp('Hero', 'src/components/Hero.astro')], isLoading: false, error: null, refresh: () => {} }),
}));
vi.mock('@/hooks/useLayoutLibrary', () => ({
  useLayoutLibrary: () => ({ layouts: [], isLoading: false, error: null, refresh: () => {} }),
  layoutToScannedComponent: (l: { name: string }) => ({ ...l, path: `layouts/${l.name}.astro` }),
}));
vi.mock('@/hooks/useContentCollections', () => ({ useContentCollections: () => ({ collections: [{ name: 'works' }, { name: 'blog', inferredFields: [{ name: 'title', type: 'text' }, { name: 'subtitle', type: 'text' }] }] }) }));
vi.mock('@/utils/cardTitleLock', () => ({ allCardAssignments: () => h.assignments, useCardTitleLockVersion: () => 0, projectSourcesSnapshot: () => h.files }));
vi.mock('@/utils/localElementSource', async (orig) => ({ presentFiles: (await orig<typeof import('@/utils/localElementSource')>()).presentFiles, rewriteLocalFiles: (...a: unknown[]) => h.rewrite(...a), rewriteLocalFile: (...a: unknown[]) => h.rewriteOne(...a) }));
vi.mock('react-hot-toast', () => ({ default: h.toast }));
vi.mock('@/store/hooks', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/store/hooks');
  return { ...actual, useYjsValue: () => [], useDispatch: () => vi.fn(), useEditorDoc: () => new Y.Doc() };
});
vi.mock('@/context/UndoContext', () => ({ useUndoContext: () => ({ takeSnapshot: h.takeSnapshot, claimSnapshot: () => h.snapshot }) }));
vi.mock('@/context/VariablesContext', () => ({ useVariables: () => ({ activeCollectionId: null, setActiveCollectionId: vi.fn() }) }));
vi.mock('@/context/SelectionContext', () => ({
  useScannedElements: () => ({ scannedByKey: new Map() }),
  useSelectionContext: () => ({ selectedKey: null }),
  useScannedElementsRef: () => ({ scannedElementsRef: { current: [] } }),
  useSelectedElement: () => ({}),
}));
vi.mock('@/components/LayersPanel/ElementsTree', () => ({ ElementsTree: () => <div data-testid="layers" /> }));
vi.mock('@/hooks/useFolderManifest', () => ({
  useFolderManifest: () => ({ manifest: { version: 1, roots: ['f_sections'], folders: { f_sections: { name: 'Sections', children: ['comp:src/components/Hero.astro'] } } }, loaded: true, save: h.saveManifest, reload: vi.fn() }),
}));
vi.mock('@/components/ui/SortableTree', () => ({
  SortableTreeProvider: ({ children, onMove }: { children: React.ReactNode; onMove: typeof h.onMove }) => { h.onMove = onMove; return children; },
  useTreeNodeDnd: (id: string, _t: string, disabled: unknown) => { h.dndDisabled.set(id, disabled); return { setNodeRef: () => {}, attributes: {}, listeners: {}, isDragging: false, dropZone: null }; },
  useTreePointerY: () => null,
  getDropZone: () => null,
  TreeDropIndicator: () => null,
  ROW_HEIGHT: 28,
}));
vi.mock('@/components/Editor/useLayersDrag', () => ({ useLayersDrag: () => ({ onDragStart() {}, onDragMove() {}, onDragEnd() {}, onDragCancel() {} }) }));
vi.mock('@/assets/icons', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.keys(actual).map((k) => [k, () => null]));
});

import { AssetsPanel } from '../AssetsPanel';

it('opening a component reveals its row and layer tree: every folder on its path expands', () => {
  Element.prototype.scrollIntoView = vi.fn();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() });
  const { rerender } = render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
  expect(screen.queryByTestId('layers')).toBeNull();
  expect(screen.queryByDisplayValue('Hero')).toBeNull(); // folder collapsed
  rerender(<AssetsPanel activeComponentPath="src/components/Hero.astro" onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);
  expect(screen.getByDisplayValue('Hero')).toBeTruthy();
  expect(screen.getByTestId('layers')).toBeTruthy();
  vi.unstubAllGlobals();
});
