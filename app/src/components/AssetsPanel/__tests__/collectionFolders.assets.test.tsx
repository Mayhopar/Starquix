/**
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
  useComponentLibrary: () => ({ builtIn: [], userProject: [comp('WorkCard', 'src/components/WorkCard.astro'), comp('NoteCard', 'src/components/NoteCard.astro'), comp('BlogCard', 'src/components/BlogCard.astro')], isLoading: false, error: null, refresh: () => {} }),
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
vi.mock('@/components/LayersPanel/ElementsTree', () => ({ ElementsTree: () => null }));
vi.mock('@/hooks/useFolderManifest', () => ({
  useFolderManifest: () => ({ manifest: { version: 1, roots: [], folders: {} }, loaded: true, save: h.saveManifest, reload: vi.fn() }),
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

const open = (name: string) => fireEvent.click(screen.getByDisplayValue(name));
const renderPanel = () => render(<AssetsPanel activeComponentPath={null} onSelectComponent={vi.fn()} onClearComponent={vi.fn()} />);

beforeEach(() => {
  h.assignments.clear();
  h.assignments.set(WORK, { card: true, collections: ['works'], typed: 'works', conflict: [] });
  h.assignments.set(NOTE, { card: true, collections: [], typed: null, conflict: [] });
  h.rewrite.mockReset().mockResolvedValue({ created: false, changed: true });
  h.rewriteOne.mockReset().mockResolvedValue({ created: false, changed: true });
  h.toast.mockReset(); h.toast.error.mockReset();
  h.files = {};
  h.saveManifest.mockReset();
  h.takeSnapshot.mockReset();
  h.dndDisabled.clear();
  Element.prototype.scrollIntoView = vi.fn();
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  });
});

describe('Assets › Blog section (owner 2026-10-10: folders are notes; cards belong nowhere)', () => {
  it('every card sits in the section once — no folder per collection', () => {
    renderPanel();
    expect(screen.getByText('Blog')).toBeTruthy(); // the section header
    for (const name of ['WorkCard', 'NoteCard', 'BlogCard']) expect(screen.getAllByDisplayValue(name)).toHaveLength(1);
    expect(screen.queryByDisplayValue('works')).toBeNull();
    expect(screen.queryByDisplayValue('blog')).toBeNull();
  });

  it('moving a card only reorganizes — no file is written', async () => {
    renderPanel();
    h.onMove!(`comp:${WORK}`, null, 99);
    await Promise.resolve();
    expect(h.rewrite).not.toHaveBeenCalled();
    expect(h.rewriteOne).not.toHaveBeenCalled();
  });

  it('no Mismatch badge, no "Remove from <collection>"', () => {
    h.assignments.set(WORK, { card: true, collections: ['works'], typed: 'works', conflict: ['blog'] });
    renderPanel();
    expect(screen.queryByText('Mismatch')).toBeNull();
    fireEvent.contextMenu(screen.getByDisplayValue('WorkCard'));
    expect(screen.queryByText(/Remove from/)).toBeNull();
    expect(screen.getByText('Delete')).toBeTruthy();
  });

  it('Delete on a card a Blog list renders → ONE batch: the card file deleted, the list switched to the basic BlogCard', async () => {
    h.files = {
      [WORK]: IMPORTED_CARD,
      'src/pages/works.astro': `---\nimport { getCollection } from 'astro:content';\nimport BlogSlot from '../components/BlogSlot.astro';\nimport WorkCard from '../components/WorkCard.astro';\nconst posts = (await getCollection('works'));\n---\n<BlogSlot>\n  <Fragment slot="posts">\n    {posts.map((post) => <div data-sq-post-slug={post.slug}><WorkCard work={post} /></div>)}\n  </Fragment>\n</BlogSlot>\n`,
    };
    renderPanel();
    fireEvent.contextMenu(screen.getByDisplayValue('WorkCard'));
    fireEvent.click(screen.getByText('Delete'));
    await vi.waitFor(() => expect(h.rewrite).toHaveBeenCalledTimes(1));
    const [files, compute] = h.rewrite.mock.calls[0] as [string[], (b: Record<string, string | null>) => Record<string, string | null>];
    expect(files.sort()).toEqual(['src/components/BlogCard.astro', WORK, 'src/pages/works.astro']);
    const out = compute({ ...h.files, 'src/components/BlogCard.astro': null });
    expect(out[WORK]).toBeNull();
    expect(out['src/pages/works.astro']).toContain('<BlogCard post={post} />');
  });

  it('the basic BlogCard offers no Delete', () => {
    h.assignments.set(BASIC, { card: true, collections: ['blog'], typed: null, conflict: [] });
    renderPanel();
    fireEvent.contextMenu(screen.getByDisplayValue('BlogCard'));
    expect(screen.queryByText('Delete')).toBeNull();
  });

});
